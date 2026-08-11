@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 八斧牛排官網 — 測試模式（簡訊只發總部）

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
set SMS_TEST_MODE=true

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  echo.
  echo [警告]  port 3001 已被占用，請先關閉舊的黑色視窗
  echo.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   八斧牛排 — 測試模式啟動
echo   簡訊只發給總部 0970205800
echo   不會打擾店長手機
echo.
echo   網址: http://127.0.0.1:3001
echo   表單手機請填「假顧客」號碼測試
echo ========================================
echo.

start "" cmd /c "ping 127.0.0.1 -n 4 >nul && start http://127.0.0.1:3001/"

node server.js
if errorlevel 1 (
  echo.
  echo [錯誤] 網站啟動失敗
  pause
)
