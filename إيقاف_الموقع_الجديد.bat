@echo off
echo Stopping SecureCheck Project 2...

:: Kill node.exe which runs the backend server
taskkill /F /IM node.exe /T

echo Server stopped successfully.
timeout /t 3
exit
