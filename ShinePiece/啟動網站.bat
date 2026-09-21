@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Shine Piece — 請勿關閉此視窗
echo.
echo   Shine Piece 日韓中泰跨境選品
echo   http://127.0.0.1:3003
echo   後台  http://127.0.0.1:3003/admin
echo.
if not exist node_modules (
  echo   正在安裝套件...
  call npm install
)
node server.js
echo.
echo   網站已停止。關閉視窗即可。
pause
