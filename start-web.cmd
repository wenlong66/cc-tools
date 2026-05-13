@echo off
title cc-tools-web
start "cc-tools-server" cmd /k "title cc-tools-server && set SERVER_PORT=3456 && bun run src/server/index.ts"
cd /d "%~dp0web" || exit /b 1
bun run dev
