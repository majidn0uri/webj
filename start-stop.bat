@echo off
chcp 65001 >nul 2>&1
title SetShop - Stop
echo.
echo Stopping SetShop...
taskkill /F /FI "WINDOWTITLE eq SetShop*" >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
echo [OK] Stopped
pause