@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 八斧牛排 — 簡訊設定檢查

where node >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js
  pause
  exit /b 1
)

node scripts/check-sms-config.js
pause
