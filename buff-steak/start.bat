@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 八斧牛排官網 — 請勿關閉此視窗

where node >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js，請先安裝：https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo 第一次啟動，正在安裝套件...
  call npm install
  if errorlevel 1 (
    echo [錯誤] npm install 失敗
    pause
    exit /b 1
  )
)

set PORT=3001
set BASE_URL=http://127.0.0.1:3001

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  echo.
  echo [警告]  port 3001 已被占用
  echo         請雙擊「一鍵啟動.bat」即可（會自動關舊網站）
  echo.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   八斧牛排 BUFF STEAK 官網
echo   網址: http://127.0.0.1:3001
echo.
echo   瀏覽器會自動開啟
echo   請勿關閉此黑色視窗（關了網站就停）
echo ========================================
echo.

REM 3 秒後自動開瀏覽器（等伺服器啟動）
start "" cmd /c "ping 127.0.0.1 -n 4 >nul && start http://127.0.0.1:3001/"

node server.js
if errorlevel 1 (
  echo.
  echo [錯誤] 網站啟動失敗，請把此畫面截圖給技術人員
  pause
)
