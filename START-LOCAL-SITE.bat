@echo off
title Scholaxia Local Site
cd /d "%~dp0"

echo ============================================
echo  Scholaxia Local Site - starting up...
echo ============================================

REM ── 1. Create the Python virtual environment (first run only) ──
if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment (first run, takes a minute)...
    python -m venv .venv
    if errorlevel 1 (
        echo.
        echo ERROR: Python was not found. Please install Python 3.11+ from
        echo        https://www.python.org/downloads/ and tick "Add to PATH".
        pause
        exit /b 1
    )
)

REM ── 2. Install dependencies (first run only) ──
if not exist ".venv\Scripts\.installed" (
    echo Installing dependencies (first run, takes a few minutes)...
    .venv\Scripts\python.exe -m pip install --upgrade pip
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: dependency install failed - see messages above.
        pause
        exit /b 1
    )
    type nul > ".venv\Scripts\.installed"
)

REM ── 3. Start the server and open the site ──
set PORT=8000
set SEED_SAMPLE_CBT=1
echo.
echo  Site will open at:  http://127.0.0.1:8000/
echo  Student app:        http://127.0.0.1:8000/app/auth.html
echo  Admin panel:        http://127.0.0.1:8000/admin/
echo  Stop the server:    close this window (or press Ctrl+C)
echo.
start "" http://127.0.0.1:8000/
.venv\Scripts\python.exe scripts\run_local.py
pause
