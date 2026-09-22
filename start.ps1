# ╔══════════════════════════════════════════════════════════════════════╗
# ║  SetShop - Auto Install & Run (Windows)                            ║
# ║                                                                    ║
# ║  Right-click → Run with PowerShell                                 ║
# ║  Or: powershell -ExecutionPolicy Bypass -File start.ps1            ║
# ╚══════════════════════════════════════════════════════════════════════╝

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

$ROOT        = Split-Path -Parent $MyInvocation.MyCommand.Path
$STATE_DIR   = Join-Path $env:USERPROFILE ".setshop"
$PGPORT      = 5433
$API_PORT    = 3000
$WEB_PORT    = 3100
$DOWNLOAD_DIR = Join-Path $STATE_DIR "downloads"
$LOG_DIR     = Join-Path $STATE_DIR "logs"

# Create directories
foreach ($d in @($STATE_DIR, $DOWNLOAD_DIR, $LOG_DIR, (Join-Path $STATE_DIR "pgrun"))) {
    if (!(Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  SetShop - Auto Install & Run" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# ── Helper functions ──────────────────────────────────────────────
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [X]  $msg" -ForegroundColor Red }
function Write-Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Step($msg) { Write-Host ""; Write-Host "-- $msg --" -ForegroundColor White }

function Test-Command($cmd) {
    $null = Get-Command $cmd -ErrorAction SilentlyContinue
    return $?
}

# ═══════════════════════════════════════════════════════════════════
#  Step 1: Check prerequisites
# ═══════════════════════════════════════════════════════════════════
Write-Step "Checking prerequisites"

$MISSING = @()
$NEED_GIT = $false
$NEED_NODE = $false
$NEED_PG = $false

# Git
if (Test-Command "git") {
    $gitVer = (git --version 2>$null) -replace '.*?([\d.]+).*','$1'
    Write-Ok "Git $gitVer"
} else {
    Write-Fail "Git - not installed"
    $NEED_GIT = $true
    $MISSING += "git"
}

# Node.js
if (Test-Command "node") {
    $nodeVer = node -v 2>$null
    Write-Ok "Node.js $nodeVer"
    $major = [int]($nodeVer -replace '^v','' -split '\.')[0]
    if ($major -lt 20) {
        Write-Warn "Version too old - need v20+"
        $NEED_NODE = $true
        $MISSING += "node"
    }
} else {
    Write-Fail "Node.js - not installed"
    $NEED_NODE = $true
    $MISSING += "node"
}

# npm
if (Test-Command "npm") {
    Write-Ok "npm $(npm -v 2>$null)"
} else {
    Write-Warn "npm - not installed (will come with Node)"
}

# PostgreSQL
$PGBIN = $null
$PG_FOUND = $false
$PGDATA_INSTALLED = $null

# Check standard install locations
foreach ($ver in @("17","16","15")) {
    $candidate = "$env:ProgramFiles\PostgreSQL\$ver\bin"
    if (Test-Path "$candidate\initdb.exe") {
        $PGBIN = $candidate
        $PGDATA_INSTALLED = "$env:ProgramFiles\PostgreSQL\$ver\data"
        $PG_FOUND = $true
        break
    }
    $candidate = "${env:ProgramFiles(x86)}\PostgreSQL\$ver\bin"
    if (Test-Path "$candidate\initdb.exe") {
        $PGBIN = $candidate
        $PGDATA_INSTALLED = "${env:ProgramFiles(x86)}\PostgreSQL\$ver\data"
        $PG_FOUND = $true
        break
    }
}

# Check if psql is in PATH
if (!$PG_FOUND -and (Test-Command "psql")) {
    $psqlPath = (Get-Command psql).Source
    $PGBIN = Split-Path $psqlPath
    $PG_FOUND = $true
}

# Check our own extracted copy
if (!$PG_FOUND) {
    $ourPg = Join-Path $STATE_DIR "pgsql\pgsql\bin"
    if (Test-Path "$ourPg\initdb.exe") {
        $PGBIN = $ourPg
        $PG_FOUND = $true
    }
}

if ($PG_FOUND) {
    Write-Ok "PostgreSQL - $PGBIN"
} else {
    Write-Fail "PostgreSQL - not installed"
    $NEED_PG = $true
    $MISSING += "postgresql"
}

Write-Host ""
if ($MISSING.Count -gt 0) {
    Write-Host "  $($MISSING.Count) missing: $($MISSING -join ', ')" -ForegroundColor Yellow
} else {
    Write-Ok "All prerequisites ready!"
}

# ═══════════════════════════════════════════════════════════════════
#  Step 2: Install missing prerequisites
# ═══════════════════════════════════════════════════════════════════

if ($MISSING.Count -gt 0) {
    Write-Step "Installing prerequisites"

    # Try winget first
    $HAS_WINGET = Test-Command "winget"
    if ($HAS_WINGET) {
        Write-Host "  winget found - using it for installation"
    } else {
        Write-Host "  winget not available - direct download"
    }

    # Install Git
    if ($NEED_GIT) {
        Write-Host ""
        Write-Host "  Installing Git..."
        if ($HAS_WINGET) {
            winget install --id Git.Git --accept-package-agreements --accept-source-agreements -e 2>$null
            if ($LASTEXITCODE -eq 0) { Write-Ok "Git installed" }
            else {
                $gitExe = Join-Path $DOWNLOAD_DIR "Git-installer.exe"
                if (!(Test-Path $gitExe)) {
                    Write-Host "    Downloading..."
                    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe" -OutFile $gitExe
                }
                Start-Process $gitExe "/VERYSILENT /NORESTART /SP-" -Wait
                Write-Ok "Git installed"
            }
        } else {
            $gitExe = Join-Path $DOWNLOAD_DIR "Git-installer.exe"
            if (!(Test-Path $gitExe)) {
                Write-Host "    Downloading Git..."
                Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe" -OutFile $gitExe
            }
            Write-Host "    Installing (silent)..."
            Start-Process $gitExe "/VERYSILENT /NORESTART /SP-" -Wait
            Write-Ok "Git installed"
        }
        $env:PATH = "$env:ProgramFiles\Git\cmd;$env:PATH"
    }

    # Install Node.js
    if ($NEED_NODE) {
        Write-Host ""
        Write-Host "  Installing Node.js LTS..."
        if ($HAS_WINGET) {
            winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements -e 2>$null
            if ($LASTEXITCODE -eq 0) { Write-Ok "Node.js installed" }
            else {
                $nodeMsi = Join-Path $DOWNLOAD_DIR "node-x64.msi"
                if (!(Test-Path $nodeMsi)) {
                    Write-Host "    Downloading..."
                    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi" -OutFile $nodeMsi
                }
                Start-Process "msiexec" "/i `"$nodeMsi`" /qn /norestart" -Wait
                Write-Ok "Node.js installed"
            }
        } else {
            $nodeMsi = Join-Path $DOWNLOAD_DIR "node-x64.msi"
            if (!(Test-Path $nodeMsi)) {
                Write-Host "    Downloading Node.js..."
                Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi" -OutFile $nodeMsi
            }
            Write-Host "    Installing (silent)..."
            Start-Process "msiexec" "/i `"$nodeMsi`" /qn /norestart" -Wait
            Write-Ok "Node.js installed"
        }
        # Refresh PATH from registry
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    }

    # Install PostgreSQL
    if ($NEED_PG) {
        Write-Host ""
        Write-Host "  Installing PostgreSQL 17..."
        if ($HAS_WINGET) {
            winget install --id PostgreSQL.PostgreSQL.17 --accept-package-agreements --accept-source-agreements -e 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "PostgreSQL installed"
                $PGBIN = "$env:ProgramFiles\PostgreSQL\17\bin"
                $PGDATA_INSTALLED = "$env:ProgramFiles\PostgreSQL\17\data"
                $PG_FOUND = $true
            }
        }
        if (!$PG_FOUND) {
            $pgZip = Join-Path $DOWNLOAD_DIR "pg17.zip"
            if (!(Test-Path $pgZip)) {
                Write-Host "    Downloading PostgreSQL 17 binaries..."
                Invoke-WebRequest -UseBasicParsing -Uri "https://get.enterprisedb.com/postgresql/postgresql-17.2-1-windows-x64-binaries.zip" -OutFile $pgZip
            }
            Write-Host "    Extracting..."
            $pgExtract = Join-Path $STATE_DIR "pgsql"
            Expand-Archive -Path $pgZip -DestinationPath $pgExtract -Force
            foreach ($sub in @("$pgExtract\pgsql\bin", "$pgExtract\bin")) {
                if (Test-Path "$sub\initdb.exe") { $PGBIN = $sub; $PG_FOUND = $true; break }
            }
            if ($PG_FOUND) { Write-Ok "PostgreSQL extracted to $PGBIN" }
            else { Write-Fail "PostgreSQL extraction failed" }
        }
    }

    # Verify
    Write-Host ""
    Write-Host "  Verify:" -ForegroundColor White
    if (Test-Command "git")  { Write-Ok "Git ready" } else { Write-Fail "Git missing" }
    if (Test-Command "node") { Write-Ok "Node ready" } else { Write-Fail "Node missing" }
    if ($PG_FOUND -and (Test-Path "$PGBIN\initdb.exe")) { Write-Ok "PostgreSQL ready" }
    else {
        Write-Fail "PostgreSQL missing"
        Write-Host ""
        Write-Host "  Please install PostgreSQL manually:" -ForegroundColor Yellow
        Write-Host "  https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
        Write-Host "  Use port 5432 during install" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ═══════════════════════════════════════════════════════════════════
#  Step 3: npm install
# ═══════════════════════════════════════════════════════════════════
Write-Step "npm dependencies"

Set-Location $ROOT

if (Test-Path "$ROOT\node_modules\next") {
    Write-Ok "node_modules already installed"
} else {
    Write-Host "  Running npm install... (may take 1-2 minutes)"
    & npm install 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Dependencies installed"
    } else {
        Write-Fail "npm install failed - run manually: npm install"
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ═══════════════════════════════════════════════════════════════════
#  Step 4: Database setup
# ═══════════════════════════════════════════════════════════════════
Write-Step "Database"

# Find PGBIN if not set
if (!$PGBIN) {
    foreach ($ver in @("17","16","15")) {
        $candidate = "$env:ProgramFiles\PostgreSQL\$ver\bin"
        if (Test-Path "$candidate\initdb.exe") { $PGBIN = $candidate; break }
    }
}
if (!$PGBIN) {
    $ourPg = Join-Path $STATE_DIR "pgsql\pgsql\bin"
    if (Test-Path "$ourPg\initdb.exe") { $PGBIN = $ourPg }
}

if (!$PGBIN) {
    Write-Fail "PostgreSQL not found!"
    Read-Host "Press Enter to exit"
    exit 1
}

$PGDATA = Join-Path $STATE_DIR "pgdata"

# ── If PG was installed via official installer → try using it ──
$PG_PASSWORD = ""
$USE_INSTALLER_PG = $false

if ($PGDATA_INSTALLED -and (Test-Path "$PGDATA_INSTALLED\PG_VERSION")) {
    # Official installer has its own data directory
    # Check if it's running on port 5432
    $ready5432 = & "$PGBIN\pg_isready" -h localhost -p 5432 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  PostgreSQL is running on port 5432"

        # Ask for password
        $pwFile = Join-Path $STATE_DIR "pg-password"
        if (Test-Path $pwFile) {
            $PG_PASSWORD = Get-Content $pwFile -Raw
            $PG_PASSWORD = $PG_PASSWORD.Trim()
        } else {
            Write-Host ""
            Write-Host "  PostgreSQL was installed with a password." -ForegroundColor Yellow
            Write-Host "  Enter the password you set during install" -ForegroundColor Yellow
            Write-Host "  (press Enter if you set no password)" -ForegroundColor Yellow
            $PG_PASSWORD = Read-Host "  postgres password"
            $PG_PASSWORD | Out-File $pwFile -NoNewline -Encoding utf8
        }

        if ($PG_PASSWORD) { $env:PGPASSWORD = $PG_PASSWORD }

        # Test connection
        $testResult = & "$PGBIN\psql" -h localhost -p 5432 -U postgres -tc "SELECT 1" 2>$null
        if ($testResult -match "1") {
            Write-Ok "Connected to PostgreSQL"
            $PGPORT = 5432
            $USE_INSTALLER_PG = $true
        } else {
            Write-Host "  Password failed - resetting pg_hba.conf to trust..." -ForegroundColor Yellow
            # Reset pg_hba.conf
            @"
# Reset by SetShop installer
local all all trust
host  all all 127.0.0.1/32 trust
host  all all ::1/128 trust
"@ | Out-File "$PGDATA_INSTALLED\pg_hba.conf" -Encoding ascii

            & "$PGBIN\pg_ctl" reload -D $PGDATA_INSTALLED 2>$null
            Start-Sleep -Seconds 2

            $env:PGPASSWORD = $null
            $testResult = & "$PGBIN\psql" -h localhost -p 5432 -U postgres -tc "SELECT 1" 2>$null
            if ($testResult -match "1") {
                Write-Ok "Reset successful - connected without password"
                $PGPORT = 5432
                $USE_INSTALLER_PG = $true
            } else {
                Write-Host "  Could not connect - will create separate cluster" -ForegroundColor Yellow
            }
        }
    }
}

# ── Create separate cluster if needed ──
if (!$USE_INSTALLER_PG) {
    if (!(Test-Path "$PGDATA\PG_VERSION")) {
        Write-Host "  Creating database cluster..."
        & "$PGBIN\initdb" -D $PGDATA -U postgres --encoding=UTF8 --locale=C 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "initdb failed"
            Read-Host "Press Enter to exit"
            exit 1
        }

        # Set port and listen
        Add-Content "$PGDATA\postgresql.conf" "port = $PGPORT"
        Add-Content "$PGDATA\postgresql.conf" "listen_addresses = 'localhost'"
        @"
local all all trust
host  all all 127.0.0.1/32 trust
host  all all ::1/128 trust
"@ | Out-File "$PGDATA\pg_hba.conf" -Encoding ascii

        Write-Ok "Cluster created"
    }

    # Start if not running
    $ready = & "$PGBIN\pg_isready" -h localhost -p $PGPORT 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Starting PostgreSQL..."
        & "$PGBIN\pg_ctl" -D $PGDATA -l (Join-Path $LOG_DIR "pg.log") -o "-p $PGPORT" start 2>$null
        Start-Sleep -Seconds 5

        $ready = & "$PGBIN\pg_isready" -h localhost -p $PGPORT 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "PostgreSQL started (port $PGPORT)"
        } else {
            Write-Fail "PostgreSQL failed to start - log: $LOG_DIR\pg.log"
            Read-Host "Press Enter to exit"
            exit 1
        }
    } else {
        Write-Ok "PostgreSQL already running (port $PGPORT)"
    }
}

# ── Create user and database ──
Write-Host "  Setting up database..."

$checkRole = & "$PGBIN\psql" -h localhost -p $PGPORT -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='setshop'" 2>$null
if ($checkRole -notmatch "1") {
    & "$PGBIN\psql" -h localhost -p $PGPORT -U postgres -c "CREATE USER setshop WITH SUPERUSER;" 2>$null
}

$checkDb = & "$PGBIN\psql" -h localhost -p $PGPORT -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='setshop'" 2>$null
if ($checkDb -notmatch "1") {
    & "$PGBIN\createdb" -h localhost -p $PGPORT -U postgres setshop 2>$null
}

& "$PGBIN\psql" -h localhost -p $PGPORT -U postgres -c "GRANT ALL ON DATABASE setshop TO setshop;" 2>$null

# Run migrations
Write-Host "  Running migrations..."
if ($PG_PASSWORD) { $env:PGPASSWORD = $PG_PASSWORD }
if (Test-Command "bash") {
    $env:DB_URL = "postgres://setshop"
    if ($PG_PASSWORD) { $env:DB_URL += ":$PG_PASSWORD" }
    $env:DB_URL += "@/setshop?host=localhost&port=$PGPORT"
    bash "$ROOT\setup.sh" db -y 2>$null
} else {
    # Direct SQL migration
    $migDir = Join-Path $ROOT "packages\db\migrations"
    Get-ChildItem "$migDir\*.sql" | Sort-Object Name | ForEach-Object {
        & "$PGBIN\psql" -h localhost -p $PGPORT -U setshop -d setshop -f $_.FullName 2>$null | Out-Null
    }
    # Seed
    if (Test-Command "npx") {
        npx tsx "$ROOT\scripts\seed-showcase.ts" 2>$null
    }
}

Write-Ok "Database ready"

# ═══════════════════════════════════════════════════════════════════
#  Step 5: Start servers
# ═══════════════════════════════════════════════════════════════════
Write-Step "Starting servers"

Set-Location $ROOT

# Internal API token
$tokenFile = Join-Path $STATE_DIR "internal-api-token"
if (!(Test-Path $tokenFile)) {
    -join (1..64 | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) }) | Out-File $tokenFile -NoNewline
}
$INTERNAL_API_TOKEN = (Get-Content $tokenFile -Raw).Trim()

# Build DB_URL — include password if we have one
$DB_URL = "postgres://setshop"
if ($PG_PASSWORD) { $DB_URL += ":$PG_PASSWORD" }
$DB_URL += "@/setshop?host=localhost&port=$PGPORT"

# Also set PGPASSWORD for any psql/node calls
if ($PG_PASSWORD) { $env:PGPASSWORD = $PG_PASSWORD }

# API
$apiReady = $false
try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$API_PORT/health" -TimeoutSec 2 -ErrorAction Stop
    Write-Ok "API already running (port $API_PORT)"
    $apiReady = $true
} catch {}

if (!$apiReady) {
    Write-Host "  Starting API..."
    $pgPw = if ($PG_PASSWORD) { "`$env:PGPASSWORD='$PG_PASSWORD';" } else { "" }
    $apiExe = Join-Path $ROOT "node_modules\.bin\tsx.cmd"
    $apiArgs = @(
        "-NoProfile", "-Command",
        "`$env:DB_URL='$DB_URL'; $pgPw `$env:INTERNAL_API_TOKEN='$INTERNAL_API_TOKEN'; `$env:NODE_OPTIONS='--max-old-space-size=768'; Set-Location '$ROOT'; & npx tsx apps\api\src\main.ts 2>&1 | Tee-Object -FilePath '$LOG_DIR\api.log'"
    )
    Start-Process powershell -ArgumentList $apiArgs -WindowStyle Minimized

    Write-Host "  Waiting for API..."
    for ($i = 0; $i -lt 30; $i += 3) {
        Start-Sleep -Seconds 3
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$API_PORT/health" -TimeoutSec 2 -ErrorAction Stop
            Write-Ok "API started (port $API_PORT)"
            $apiReady = $true
            break
        } catch {}
    }
    if (!$apiReady) { Write-Host "  API still starting - check $LOG_DIR\api.log" -ForegroundColor Yellow }
}

# Web
$webReady = $false
try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$WEB_PORT/" -TimeoutSec 3 -ErrorAction Stop
    Write-Ok "Web already running (port $WEB_PORT)"
    $webReady = $true
} catch {}

if (!$webReady) {
    Write-Host "  Starting web (first time: 10-30 seconds)..."
    $webDir = Join-Path $ROOT "apps\web"
    $pgPwW = if ($PG_PASSWORD) { "`$env:PGPASSWORD='$PG_PASSWORD';" } else { "" }
    $webExe = Join-Path $ROOT "node_modules\.bin\next.cmd"
    $webArgs = @(
        "-NoProfile", "-Command",
        "`$env:DB_URL='$DB_URL'; $pgPwW `$env:INTERNAL_API_TOKEN='$INTERNAL_API_TOKEN'; `$env:NODE_OPTIONS='--max-old-space-size=768'; Set-Location '$webDir'; & npx next dev -H 0.0.0.0 -p $WEB_PORT 2>&1 | Tee-Object -FilePath '$LOG_DIR\web.log'"
    )
    Start-Process powershell -ArgumentList $webArgs -WindowStyle Minimized

    Write-Host "  Waiting for web..."
    for ($i = 0; $i -lt 60; $i += 5) {
        Start-Sleep -Seconds 5
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$WEB_PORT/" -TimeoutSec 3 -ErrorAction Stop
            Write-Ok "Web started (port $WEB_PORT)"
            $webReady = $true
            break
        } catch {}
    }
    if (!$webReady) { Write-Host "  Web still starting - check $LOG_DIR\web.log" -ForegroundColor Yellow }
}

# ═══════════════════════════════════════════════════════════════════
#  Done!
# ═══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  SetShop is ready!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Shop:     http://localhost:$WEB_PORT" -ForegroundColor White
Write-Host "  API:      http://localhost:$API_PORT" -ForegroundColor White
Write-Host "  Database: port $PGPORT" -ForegroundColor White
Write-Host ""
Write-Host "  Admin:    http://localhost:$WEB_PORT/admin/login" -ForegroundColor Cyan
Write-Host "  Password: SetShop@1404" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Stop:     start-stop.ps1" -ForegroundColor Gray
Write-Host "  Status:   start-status.ps1" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Open browser
Start-Process "http://localhost:$WEB_PORT"

Write-Host "Press Enter to close this window..."
Read-Host