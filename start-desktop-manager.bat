@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "APP=%~dp0desktop-app\release-node-fix\DSBot 桌面端-win32-x64\DSBotDesktop.exe"
if not exist "%APP%" (
  echo DSBot Desktop was not found. Rebuild it from desktop-app with npm run package.
  pause
  exit /b 1
)
start "" "%APP%"
