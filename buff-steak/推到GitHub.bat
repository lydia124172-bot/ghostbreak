@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo.
echo ========================================
echo   Upload to GitHub (buff-steak updates)
echo ========================================
echo.
git status -sb
echo.
for /f %%i in ('git rev-list --count origin/main..HEAD 2^>nul') do set AHEAD=%%i
if "%AHEAD%"=="" set AHEAD=0
echo Pending commits to upload: %AHEAD%
echo.
if "%AHEAD%"=="0" (
  echo Nothing new to upload. Already synced with GitHub.
  goto done
)
echo Pushing... If browser opens, login GitHub and allow.
echo.
git push origin main
echo.
if errorlevel 1 (
  echo [FAILED] Push did not work.
  echo.
  echo Try in Cursor: left branch icon - Sync Changes
  echo Or run: git push origin main
) else (
  echo [OK] Upload success!
  echo Wait 3 min for Render to redeploy, then test:
  echo   https://steak.bafuholdings.com/robots.txt
  echo   https://steak.bafuholdings.com/sitemap.xml
)
:done
echo.
pause
