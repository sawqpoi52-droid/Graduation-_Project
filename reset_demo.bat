@echo off
echo Resetting SecureCheck Demo Scenario...
cd /d "%~dp0backend"
node reset_demo.js
pause
