@echo off
taskkill /FI "WINDOWTITLE eq cc-tools-web" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq cc-tools-server" /T /F >nul 2>&1
