@echo off
rem Stops Meeting Intelligence started by start-app.cmd or start-app-hidden.vbs (including its auto-restart loop).
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name = 'cmd.exe'\" | Where-Object { $_.CommandLine -like '*start-app.cmd*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null; 'Stopped (pid ' + $_.ProcessId + ')' }"
echo Meeting Intelligence is stopped.
timeout /t 3 >nul
