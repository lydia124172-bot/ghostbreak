@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 八斧牛排網站

echo.
echo 正在啟動八斧牛排網站...
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  echo 關閉舊網站...
  taskkill /F /PID %%a >nul 2>&1
)

ping 127.0.0.1 -n 3 >nul

where node >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js，請安裝 https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo 第一次使用，正在安裝...
  call npm install
)

set PORT=3001
set BASE_URL=http://127.0.0.1:3001

echo ========================================
echo   八斧牛排網站已啟動
echo   網址: http://127.0.0.1:3001
echo.
echo   請保持此視窗開啟（關掉網站就停）
echo ========================================
echo.

start http://127.0.0.1:3001/

node server.js
echo.
echo 網站已停止
pause
