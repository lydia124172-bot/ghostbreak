@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 麋鹿網 MooseWeb — 請勿關閉此視窗
echo.
echo   麋鹿網 MooseWeb
echo   http://127.0.0.1:3002
echo   後台  http://127.0.0.1:3002/admin
echo.
if not exist node_modules (
  echo   正在安裝套件...
  call npm install
)
node server.js
echo.
echo   網站已停止。關閉視窗即可。
pause
