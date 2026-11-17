@echo off
title Launch Chrome with Surepass DL Extension
set EXTENSION_DIR=%~dp0extension

echo ========================================================
echo  Launching Google Chrome with Surepass DL Extension...
echo  Extension Path: %EXTENSION_DIR%
echo ========================================================

:: Check common Chrome install locations
set CHROME_EXE=""
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set CHROME_EXE="C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set CHROME_EXE="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set CHROME_EXE="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if %CHROME_EXE%=="" (
    echo [!] Google Chrome not found in standard paths. Attempting 'start chrome'...
    start chrome --load-extension="%EXTENSION_DIR%" "https://console.surepass.app/services/driving-license"
) else (
    echo [*] Starting Chrome via %CHROME_EXE%...
    start "" %CHROME_EXE% --load-extension="%EXTENSION_DIR%" "https://console.surepass.app/services/driving-license"
)

echo.
echo [OK] Chrome launched! 
echo Look for the Surepass DL Extension icon in your Chrome toolbar.
timeout /t 5

