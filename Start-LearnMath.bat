@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\manage.ps1" -Action start
if errorlevel 1 pause
endlocal

