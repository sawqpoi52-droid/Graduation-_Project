@echo off
echo Starting SecureCheck...
if exist "SecureCheck_Project2" cd SecureCheck_Project2
if exist "SecureCheck_Project" cd SecureCheck_Project

:: Start Backend Minimized (This also serves the built frontend)
start /min "SecureCheck Backend" cmd /c "cd backend && node server.js"

:: Wait for backend to initialize
timeout /t 5 /nobreak >nul

:: Open Browser to the production server port (5000)
start http://localhost:5000
exit
