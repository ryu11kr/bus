@echo off
title se - GitHub login
cd /d "%~dp0"
set "PATH=%ProgramFiles%\GitHub CLI;%ProgramFiles%\Git\cmd;%PATH%"
set "GH=%ProgramFiles%\GitHub CLI\gh.exe"

if not exist "%GH%" (
  echo ERROR: GitHub CLI not found. Run: winget install GitHub.cli
  pause
  exit /b 1
)

echo.
echo === GitHub login ===
echo Browser will open. Finish login there.
echo.
"%GH%" auth login -h github.com -p https -w
if errorlevel 1 (
  echo ERROR: login failed.
  pause
  exit /b 1
)
"%GH%" auth setup-git
"%GH%" auth status
echo.
echo OK. Next: double-click create-github-repo.cmd
pause