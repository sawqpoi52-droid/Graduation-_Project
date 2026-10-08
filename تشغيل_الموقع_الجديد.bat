@echo off
echo Starting SecureCheck Project 2...
cd SecureCheck_Project2

:: Start Backend Minimized (This also serves the built frontend)
start /min "SecureCheck Backend" cmd /c "cd backend && node server.js"

:: Wait for backend to initialize
timeout /t 5 /nobreak >nul

:: Open Browser to the production server port (5000)
start http://localhost:5000
exit
