[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "-- SetShop Status --" -ForegroundColor Cyan
Write-Host ""

# API
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000/health" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  [OK] API  :3000  Running" -ForegroundColor Green
} catch {
    Write-Host "  [X]  API  :3000  Not running" -ForegroundColor Red
}

# Web
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3100/" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "  [OK] Web  :3100  Running" -ForegroundColor Green
} catch {
    Write-Host "  [X]  Web  :3100  Not running" -ForegroundColor Red
}

# PostgreSQL
foreach ($ver in @("17","16","15")) {
    $pgReady = "$env:ProgramFiles\PostgreSQL\$ver\bin\pg_isready.exe"
    if (Test-Path $pgReady) {
        & $pgReady -h localhost -p 5432 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] DB   :5432  Running" -ForegroundColor Green
        } else {
            Write-Host "  [X]  DB   :5432  Not running" -ForegroundColor Red
        }
        break
    }
}

Write-Host ""
Read-Host "Press Enter"