@echo off
cd /d "%~dp0"

echo Starting Invoice Analyzer...
echo.
echo Backend  ->  http://localhost:8000
echo Frontend ->  http://localhost:5173
echo.

start "Invoice Analyzer - Backend" cmd /k %~dp0start_backend.bat
timeout /t 3 /nobreak >nul
start "Invoice Analyzer - Frontend" cmd /k "cd /d %~dp0app && npm run dev"

echo Both services starting in separate windows.
echo Close those windows to stop them.
