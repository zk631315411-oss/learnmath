@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\install.ps1"
if errorlevel 1 (
  echo.
  echo [LearnMath] Installation failed. Review the message above.
  pause
)
endlocal

