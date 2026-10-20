@echo off
cd /d "%~dp0"
call BUILD-VENDOR-WEB.bat
if errorlevel 1 exit /b 1
echo Starting Scholaxia Vendor Web App at http://localhost:8081
start "Scholaxia Vendor Web" cmd /c ".venv\Scripts\python.exe -m http.server 8081 --directory build\vendor-web"