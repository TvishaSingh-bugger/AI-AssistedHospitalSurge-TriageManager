@echo off
cd /d "%~dp0"
if exist ml-service\models\next_emergency.joblib (
  where py >nul 2>nul && start "MedNexus ML Forecast" cmd /k "cd /d ""%~dp0ml-service"" && py -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
) else (
  echo ML models are missing. Run setup.bat once to install Python packages and train them from MySQL.
)
start "MedNexus API" cmd /k "cd backend && npm start"
timeout /t 3 >nul
start "MedNexus Web" cmd /k "cd frontend && npm run dev -- --open"
echo ML forecast: http://localhost:8000   Backend: http://localhost:5000   Frontend: http://localhost:5173
