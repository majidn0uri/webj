@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

title SetShop - Starting...
color 0B

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "PGPASSWORD=1"

echo.
echo ================================================================
echo   SetShop - Auto Start
echo ================================================================
echo.

:: ── Find PostgreSQL ──
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
pause
exit /b 1

:pg_ok
echo [OK] PostgreSQL found

:: ── Create user + database ──
echo.
echo -- Database setup --
set "PGPASSWORD=1"

"!PGBIN!\psql" -h localhost -p 5432 -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='setshop'" 2>nul | findstr "1" >nul
if !ERRORLEVEL! NEQ 0 (
    echo Creating user setshop...
    "!PGBIN!\psql" -h localhost -p 5432 -U postgres -c "CREATE USER setshop WITH SUPERUSER PASSWORD '1';" 2>nul
    echo [OK] User created
) else (
    echo [OK] User setshop exists
    "!PGBIN!\psql" -h localhost -p 5432 -U postgres -c "ALTER USER setshop PASSWORD '1';" 2>nul
)

"!PGBIN!\psql" -h localhost -p 5432 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='setshop'" 2>nul | findstr "1" >nul
if !ERRORLEVEL! NEQ 0 (
    echo Creating database setshop...
    "!PGBIN!\createdb" -h localhost -p 5432 -U postgres setshop 2>nul
    "!PGBIN!\psql" -h localhost -p 5432 -U postgres -c "GRANT ALL ON DATABASE setshop TO setshop;" 2>nul
    echo [OK] Database created
) else (
    echo [OK] Database setshop exists
)

:: ── npm install ──
echo.
echo -- npm install --
cd /d "%ROOT%"
call npm install 2>nul
echo [OK] Dependencies ready

:: ── Set env vars (child processes inherit these) ──
set "DB_URL=postgres://setshop:1@/setshop?host=localhost&port=5432"
set "TSX_TSCONFIG_PATH=%ROOT%\tsconfig.json"
set "NODE_OPTIONS=--max-old-space-size=2048"
set "ADMIN_PASSWORD=SetShop@1404"
cd /d "%ROOT%"

:: ── Run migrations ──
echo.
echo -- Database migrations --
call npx tsx packages\db\src\migrate-cli.ts
echo [OK] Migrations done

:: ── Create admin ──
echo.
echo -- Admin user --
call npx tsx scripts\create-admin.ts
echo [OK] Admin ready

:: ── Start API ──
echo.
echo -- Starting API --
echo Starting API on port 3000...

curl -s -o nul --max-time 2 http://127.0.0.1:3000/health 2>nul
if !ERRORLEVEL!==0 (
    echo [OK] API already running
    goto :api_done
)

:: Env vars are already set in parent — child inherits them
start "SetShop API" /min cmd /c "cd /d "%ROOT%" && call npx tsx apps\api\src\main.ts"

echo Waiting for API...
:wait_api
timeout /t 3 /nobreak >nul
curl -s -o nul --max-time 2 http://127.0.0.1:3000/health 2>nul
if !ERRORLEVEL!==0 (
    echo [OK] API started on port 3000
    goto :api_done
)
goto :wait_api

:api_done

:: ── Start Web ──
echo.
echo -- Starting Web --
echo Starting Web on port 3100...

curl -s -o nul --max-time 3 http://127.0.0.1:3100/ 2>nul
if !ERRORLEVEL!==0 (
    echo [OK] Web already running
    goto :web_done
)

start "SetShop Web" /min cmd /c "cd /d "%ROOT%\apps\web" && ..\..\node_modules\.bin\next.cmd dev -H 0.0.0.0 -p 3100"

echo Waiting for Web...
:wait_web
timeout /t 5 /nobreak >nul
curl -s -o nul --max-time 3 http://127.0.0.1:3100/ 2>nul
if !ERRORLEVEL!==0 (
    echo [OK] Web started on port 3100
    goto :web_done
)
goto :wait_web

:web_done

echo.
echo.
echo ================================================================
echo   SetShop is ready!
echo ================================================================
echo.
echo   Shop:     http://localhost:3100
echo   API:      http://localhost:3000
echo.
echo   Admin:    http://localhost:3100/admin/login
echo   Phone:    09120000000
echo   Password: SetShop@1404
echo.
echo ================================================================
echo.

start "" "http://localhost:3100"

echo Press any key to close this window...
pause >nul