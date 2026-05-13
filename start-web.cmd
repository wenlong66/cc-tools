@echo off
title cc-tools-web
start "cc-tools-server" cmd /k "title cc-tools-server && cd /d ""%~dp0cc-tools"" && set SERVER_PORT=3456 && bun run src/server/index.ts"
cd /d "%~dp0cc-tools\web" || exit /b 1
bun run dev
