@echo off
cd /d "%~dp0"
start "MedNexus API" cmd /k "cd backend && npm start"
timeout /t 3 >nul
start "MedNexus Web" cmd /k "cd frontend && npm run dev -- --open"
echo Backend: http://localhost:5000   Frontend: http://localhost:5173
