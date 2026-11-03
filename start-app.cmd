@echo off
rem Runs Meeting Intelligence at http://localhost:3000, independent of any editor or terminal.
rem Double-click to start; close this window (or press Ctrl+C) to stop.
rem If the server ever crashes, it restarts automatically after 5 seconds.

cd /d "%~dp0"
title Meeting Intelligence - http://localhost:3000

if not exist ".next-app\BUILD_ID" (
  echo Building the app for the first time...
  call npm run app:build || goto :eof
)

:loop
echo [%date% %time%] Starting Meeting Intelligence on http://localhost:3000
call npm run app:start
echo [%date% %time%] The server stopped. Restarting in 5 seconds... (close this window to stop for good)
timeout /t 5 /nobreak >nul
goto loop
