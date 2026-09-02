@echo off
setlocal
cd /d "%~dp0"
echo Sauvegarde Pinokio Demeter...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pinokio-backup-demeter.ps1" %*
if errorlevel 1 (
    echo.
    echo Echec. Code: %errorlevel%
    pause
    exit /b %errorlevel%
)
echo.
pause
