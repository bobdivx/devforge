@echo off
setlocal
cd /d "%~dp0"
echo Installation LiteLLM Cursor Proxy dans Pinokio...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pinokio-litellm-install.ps1" %*
if errorlevel 1 (
    echo.
    echo Echec. Code: %errorlevel%
    pause
    exit /b %errorlevel%
)
echo.
echo OK. Ouvrez Pinokio - LiteLLM Cursor Proxy - Install puis Start.
pause
