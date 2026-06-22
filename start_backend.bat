@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Invoice Analyzer - Backend (Extraction Service)
echo ============================================================

if not exist ".venv\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found at .venv\
    echo Run these commands first:
    echo   python -m venv .venv
    echo   .venv\Scripts\activate
    echo   pip install -r requirements.txt
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat

echo Starting extraction service on http://localhost:8000
echo Keep this window open while using the app.
echo Press Ctrl+C to stop.
echo.
uvicorn api.main:app --port 8000
pause
