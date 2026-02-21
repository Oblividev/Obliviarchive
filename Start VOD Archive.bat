@echo off
title VOD Archive
cd /d "%~dp0"

echo.
echo  Starting VOD Archive...
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  Node.js is not installed.
    echo.
    echo  Please install it once from: https://nodejs.org
    echo  Choose the "LTS" version - it's free and takes 2 minutes.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  First run: Installing dependencies...
    call npm install
    echo.
)

start "" cmd /k "npm start"
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo  Your browser should open automatically.
echo  If not, go to: http://localhost:3000
echo.
pause
