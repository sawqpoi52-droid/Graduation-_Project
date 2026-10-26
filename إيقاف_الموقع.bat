@echo off
echo Stopping SecureCheck Server...
taskkill /F /IM node.exe /T 2>nul
echo Server stopped.
timeout /t 2 /nobreak >nul
exit
