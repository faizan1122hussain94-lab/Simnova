@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo        SimNova Pro - First Setup
echo ========================================
where node >nul 2>nul || (echo Node.js is not installed. Install Node.js 22 LTS first.& pause & exit /b 1)
node -v
call npm.cmd install || (echo npm install failed.& pause & exit /b 1)
if not exist .env copy .env.example .env >nul
if not exist db\simnova.db (
  echo.
  echo IMPORTANT: Open .env and set ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET.
  echo Then run SETUP-WINDOWS.bat again.
  start notepad .env
  pause
  exit /b 0
)
echo Setup appears complete.
pause
