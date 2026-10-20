@echo off
cd /d "%~dp0"
set PORT=8000
set SEED_SAMPLE_CBT=1
set PYTHONUNBUFFERED=1
start "scholaxia-local" /min cmd /c ".venv\Scripts\python.exe scripts\run_local.py > server-boot.log 2>&1"
exit /b 0
