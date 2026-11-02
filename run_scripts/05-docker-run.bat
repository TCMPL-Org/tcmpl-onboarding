@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%" || (
  echo [FAIL] Project root nahi mila: %PROJECT_ROOT%
  pause
  exit /b 1
)
if not exist "%SCRIPT_DIR%_common.bat" (
  echo [FAIL] Missing helper: %SCRIPT_DIR%_common.bat
  pause
  exit /b 1
)
call "%SCRIPT_DIR%_common.bat"
if errorlevel 1 exit /b 1
where docker >nul 2>nul || (echo [FAIL] Docker required.&exit /b 1)
docker info >nul 2>nul || (echo [FAIL] Docker engine not running.&exit /b 1)
docker compose up --build -d || exit /b 1
for /l %%I in (1,1,10) do (powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/health';if($r.StatusCode -eq 200){exit 0}}catch{};exit 1" && goto :ok&timeout /t 3 /nobreak >nul)
echo [FAIL] Docker health failed.&exit /b 1
:ok
echo [PASS] Docker build, start and health.&start "" "http://localhost:3000"&pause
