@echo off
setlocal
cd /d "%~dp0"
echo ===== MedNexus setup =====
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
echo Installing backend packages...
cd backend
call npm install || (pause & exit /b 1)
if not exist .env (
  copy .env.example .env >nul
  echo.
  echo A file backend\.env was created. Notepad will open: type your MySQL password after DB_PASSWORD= , save and close it.
  pause
  notepad .env
)
echo.
echo Creating the database (first run takes 1-3 minutes)...
call npm run setup-db || (echo Database setup failed - check backend\.env and that MySQL is running. & pause & exit /b 1)
cd ..
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher not found. The app will use its built-in seasonal forecast until Python is installed.
) else (
  echo Installing ML service packages...
  py -m pip install -r ml-service\requirements.txt || (echo ML dependencies could not be installed. Continuing without ML forecasts.)
  py -c "import fastapi, mysql.connector, sklearn" >nul 2>nul
  if not errorlevel 1 (
    echo Training ML models from the MySQL case history...
    py ml-service\training\train.py || (echo Model training failed. Forecasts will use the built-in seasonal method.)
  )
)
cd frontend
echo Installing frontend packages...
call npm install || (pause & exit /b 1)
cd ..
echo.
echo Setup finished. Now double-click start.bat
pause
