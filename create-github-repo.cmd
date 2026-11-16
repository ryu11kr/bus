@echo off
title PWA - create repo on GitHub
cd /d "%~dp0"
set "PATH=%ProgramFiles%\GitHub CLI;%ProgramFiles%\Git\cmd;%PATH%"
set "GH=%ProgramFiles%\GitHub CLI\gh.exe"

if not exist "%GH%" (
  echo ERROR: GitHub CLI not found. Run: winget install GitHub.cli
  pause
  exit /b 1
)

"%GH%" auth status >nul 2>&1
if errorlevel 1 (
  echo ERROR: not logged in. Run gh-login.cmd first.
  pause
  exit /b 1
)

set /p REPO=GitHub 저장소 이름 (예: my-pwa-app): 
if "%REPO%"=="" (
  echo 취소됨.
  pause
  exit /b 1
)

"%GH%" auth setup-git >nul 2>&1
echo.
echo === Creating repo %REPO% and pushing ===
echo.
"%GH%" repo create %REPO% --public --source=. --push
if not errorlevel 1 goto ok

echo.
echo Retry: create repo then push...
"%GH%" repo create %REPO% --public
if errorlevel 1 (
  echo Repo may already exist. Try deploy-github.cmd
  pause
  exit /b 1
)
git push -u origin main
if errorlevel 1 (
  echo ERROR: push failed.
  pause
  exit /b 1
)

:ok
echo.
echo DONE. Check: gh repo view %REPO%
pause