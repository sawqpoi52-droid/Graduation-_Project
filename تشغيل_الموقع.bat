@echo off
echo Starting SecureCheck Server...
cd /d "%~dp0backend"
start /min "SecureCheck Backend" cmd /c "node server.js"
timeout /t 3 /nobreak >nul
start http://localhost:5000
exit
