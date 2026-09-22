[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "-- Stopping SetShop --" -ForegroundColor Red
Write-Host ""

# Kill Node processes
Write-Host "  Stopping Node.js processes..."
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match "SetShop" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Stop PostgreSQL
$STATE_DIR = Join-Path $env:USERPROFILE ".setshop"
$PGDATA = Join-Path $STATE_DIR "pgdata"

foreach ($ver in @("17","16","15")) {
    $pgctl = "$env:ProgramFiles\PostgreSQL\$ver\bin\pg_ctl.exe"
    if (Test-Path $pgctl) {
        & $pgctl -D $PGDATA stop 2>$null
        Write-Host "  [OK] PostgreSQL stopped" -ForegroundColor Green
        break
    }
}

$ourPgctl = Join-Path $STATE_DIR "pgsql\pgsql\bin\pg_ctl.exe"
if (Test-Path $ourPgctl) {
    & $ourPgctl -D $PGDATA stop 2>$null
    Write-Host "  [OK] PostgreSQL stopped" -ForegroundColor Green
}

Write-Host ""
Write-Host "  All services stopped." -ForegroundColor Green
Read-Host "Press Enter"