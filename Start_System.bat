@echo off
title Surepass Automation Server + Cloudflare Tunnel
cd /d "%~dp0"

echo ============================================================
echo   SUREPASS DRIVING LICENCE AUTOMATION LAUNCHER
echo ============================================================
echo.
echo [*] Starting Backend Server on port 8002...
start "Surepass Backend (Port 8002)" cmd /k "python server.py --port 8002"

echo [*] Waiting 3 seconds for server to initialize...
timeout /t 3 /nobreak >nul

echo [*] Launching Cloudflare Tunnel...
echo [!] IMPORTANT: The Cloudflare Tunnel window will display your new live link:
echo     https://<random-words>.trycloudflare.com
echo     Share that exact link with your colleagues!
echo.
start "Cloudflare Tunnel" cmd /k "cloudflared.exe tunnel --url http://localhost:8002"

echo ============================================================
echo  All systems running! Keep these windows open while working.
echo ============================================================
pause

