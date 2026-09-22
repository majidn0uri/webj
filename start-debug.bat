@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

title SetShop - Debug Start
color 0B

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "LOG=%ROOT%\startup.log"

:: Clear old log
echo ================================================================ > "%LOG%"
echo   SetShop Startup Log - %date% %time% >> "%LOG%"
echo ================================================================ >> "%LOG%"

echo.
echo ================================================================
echo   SetShop - Debug Start (with log)
echo ================================================================
echo.
echo Log file: %LOG%
echo.

:: ── Node check ──
echo [%time%] Checking Node.js... >> "%LOG%"
node --version >> "%LOG%" 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo [X] Node.js not found!
    echo [%time%] ERROR: Node.js not found >> "%LOG%"
    pause
    exit /b 1
)
echo [OK] Node.js found
echo [%time%] Node.js OK >> "%LOG%"

:: ── Find PostgreSQL ──
echo [%time%] Checking PostgreSQL... >> "%LOG%"
set "PGBIN="
for %%d in (
    "%ProgramFiles%\PostgreSQL\17\bin"
    "%ProgramFiles%\PostgreSQL\16\bin"
    "%ProgramFiles%\PostgreSQL\15\bin"
) do (
    if exist "%%~d\psql.exe" (
        set "PGBIN=%%~d"
        goto :pg_ok
    )
)
echo [X] PostgreSQL not found!
echo [%time%] ERROR: PostgreSQL not found >> "%LOG%"
pause
exit /b 1

:pg_ok
echo [OK] PostgreSQL found at !PGBIN!
echo [%time%] PostgreSQL found at !PGBIN! >> "%LOG%"

:: ── Create user + database ──
echo.
echo -- Database setup --
echo [%time%] Database setup... >> "%LOG%"
set "PGPASSWORD=1"

"!PGBIN!\psql" -h localhost -p 5432 -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='setshop'" 2>>"%LOG%" | findstr "1" >nul
if !ERRORLEVEL! NEQ 0 (
    echo Creating user setshop...
    "!PGBIN!\psql" -h localhost -p 5432 -U postgres -c "CREATE USER setshop WITH SUPERUSER PASSWORD '1';" 2>>"%LOG%"
    echo [%time%] User created >> "%LOG%"
) else (
    echo [OK] User setshop exists
    "!PGBIN!\psql" -h localhost -p 5432 -U postgres -c "ALTER USER setshop PASSWORD '1';" 2>>"%LOG%"
)

"!PGBIN!\psql" -h localhost -p 5432 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='setshop'" 2>>"%LOG%" | findstr "1" >nul
if !ERRORLEVEL! NEQ 0 (
    echo Creating database setshop...
    "!PGBIN!\createdb" -h localhost -p 5432 -U postgres setshop 2>>"%LOG%"
    "!PGBIN!\psql" -h localhost -p 5432 -U postgres -c "GRANT ALL ON DATABASE setshop TO setshop;" 2>>"%LOG%"
    echo [%time%] Database created >> "%LOG%"
) else (
    echo [OK] Database setshop exists
)

:: ── npm install ──
echo.
echo -- npm install --
echo [%time%] npm install... >> "%LOG%"
cd /d "%ROOT%"
call npm install >> "%LOG%" 2>&1
echo [%time%] npm install done (code: !ERRORLEVEL!) >> "%LOG%"
echo [OK] Dependencies ready

:: ── Set env vars ONCE ──
set "DB_URL=postgres://setshop:1@/setshop?host=localhost&port=5432"
set "TSX_TSCONFIG_PATH=%ROOT%\tsconfig.json"
set "NODE_OPTIONS=--max-old-space-size=2048"
set "ADMIN_PASSWORD=SetShop@1404"
cd /d "%ROOT%"

:: ── Run migrations ──
echo.
echo -- Database migrations --
echo [%time%] Running migrations... >> "%LOG%"
echo [%time%] DB_URL=%DB_URL% >> "%LOG%"
echo [%time%] TSX_TSCONFIG_PATH=%TSX_TSCONFIG_PATH% >> "%LOG%"
call npx tsx packages\db\src\migrate-cli.ts >> "%LOG%" 2>&1
echo [%time%] Migration exit code: !ERRORLEVEL! >> "%LOG%"
echo [OK] Migrations done

:: ── Create admin user ──
echo.
echo -- Admin user --
echo [%time%] Creating admin (ADMIN_PASSWORD=%ADMIN_PASSWORD%)... >> "%LOG%"
call npx tsx scripts\create-admin.ts >> "%LOG%" 2>&1
echo [%time%] Admin exit code: !ERRORLEVEL! >> "%LOG%"
echo [OK] Admin user ready

:: ── Start API ──
echo.
echo -- Starting API --
echo [%time%] Starting API on port 3000... >> "%LOG%"

curl -s -o nul --max-time 2 http://127.0.0.1:3000/health 2>nul
if !ERRORLEVEL!==0 (
    echo [OK] API already running
    goto :api_done
)

echo [%time%] Launching API process... >> "%LOG%"
start "SetShop API" /min cmd /c "cd /d "%ROOT%" && call npx tsx apps\api\src\main.ts >> "%LOG%" 2>&1"

echo Waiting for API (max 120 seconds)...
set /a "api_wait=0"
:wait_api
timeout /t 3 /nobreak >nul
set /a "api_wait+=3"
curl -s -o nul --max-time 2 http://127.0.0.1:3000/health 2>nul
if !ERRORLEVEL!==0 (
    echo [OK] API started on port 3000 (!api_wait!s)
    echo [%time%] API started in !api_wait!s >> "%LOG%"
    goto :api_done
)
if !api_wait! GEQ 120 (
    echo [X] API failed after 120s! Check %LOG%
    echo [%time%] ERROR: API timeout >> "%LOG%"
    powershell -Command "Get-Content '%LOG%' | Select-Object -Last 40"
    pause
    exit /b 1
)
echo   ...waiting !api_wait!s
goto :wait_api

:api_done

:: ── Start Web ──
echo.
echo -- Starting Web --
echo [%time%] Starting Web on port 3100... >> "%LOG%"

curl -s -o nul --max-time 3 http://127.0.0.1:3100/ 2>nul
if !ERRORLEVEL!==0 (
    echo [OK] Web already running
    goto :web_done
)

start "SetShop Web" /min cmd /c "cd /d "%ROOT%\apps\web" && ..\..\node_modules\.bin\next.cmd dev -H 0.0.0.0 -p 3100 >> "%LOG%" 2>&1"

echo Waiting for Web (max 120 seconds)...
set /a "web_wait=0"
:wait_web
timeout /t 5 /nobreak >nul
set /a "web_wait+=5"
curl -s -o nul --max-time 3 http://127.0.0.1:3100/ 2>nul
if !ERRORLEVEL!==0 (
    echo [OK] Web started on port 3100 (!web_wait!s)
    echo [%time%] Web started in !web_wait!s >> "%LOG%"
    goto :web_done
)
if !web_wait! GEQ 120 (
    echo [X] Web failed after 120s! Check %LOG%
    echo [%time%] ERROR: Web timeout >> "%LOG%"
    powershell -Command "Get-Content '%LOG%' | Select-Object -Last 40"
    pause
    exit /b 1
)
echo   ...waiting !web_wait!s
goto :wait_web

:web_done

echo [%time%] === STARTUP COMPLETE === >> "%LOG%"
echo.
echo ================================================================
echo   SetShop is ready!
echo ================================================================
echo.
echo   Shop:     http://localhost:3100
echo   API:      http://localhost:3000
echo   Admin:    http://localhost:3100/admin/login
echo   Phone:    09120000000
echo   Password: SetShop@1404
echo   Log:      %LOG%
echo ================================================================
echo.
start "" "http://localhost:3100"
echo Press any key to close this window...
pause >nul