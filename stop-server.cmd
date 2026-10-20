@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'run_local' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output ('killed ' + $_.ProcessId) }"
exit /b 0
