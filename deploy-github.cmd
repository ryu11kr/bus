@echo off
title PWA - push to GitHub
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
  echo ERROR: run gh-login.cmd first.
  pause
  exit /b 1
)

"%GH%" auth setup-git >nul 2>&1
for /f "delims=" %%i in ('"%GH%" api user -q .login') do set "GH_USER=%%i"
for /f "delims=" %%i in ('"%GH%" api user -q .id') do set "GH_ID=%%i"
set "GIT_AUTHOR_NAME=%GH_USER%"
set "GIT_COMMITTER_NAME=%GH_USER%"
set "GIT_AUTHOR_EMAIL=%GH_ID%+%GH_USER%@users.noreply.github.com"
set "GIT_COMMITTER_EMAIL=%GH_ID%+%GH_USER%@users.noreply.github.com"
git add -A
git status --short
set /p MSG=Commit message - Enter for default: 
if "%MSG%"=="" set MSG=update
git commit -m "%MSG%"
if errorlevel 1 (
  echo Commit failed - no changes, or see message above.
  pause
  exit /b 1
)
git push origin main
if errorlevel 1 (
  echo ERROR: push failed.
  pause
  exit /b 1
)
echo.
echo Push OK.
pause