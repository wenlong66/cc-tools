@echo off
setlocal

cd /d "%~dp0" || exit /b 1
where bun >nul 2>&1
if errorlevel 1 (
  echo [error] bun was not found in PATH.
  pause
  exit /b 1
)

bun run dev:launcher %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
