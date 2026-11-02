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
if not exist .env copy /y .env.example .env >nul
call npm ci || goto :fail
call npm run check || goto :fail
start "TCMPL Server" /b cmd /c "npm run preview > server.log 2>&1"
for /l %%I in (1,1,10) do (powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing '%LOCAL_URL%' -TimeoutSec 3;if($r.StatusCode -eq 200){exit 0}}catch{};exit 1" && goto :ok&timeout /t 3 /nobreak >nul)
:fail
echo [FAIL] Validation stopped. Server/browser not opened.&pause&exit /b 1
:ok
echo [PASS] install, lint, typecheck, tests, build, startup
start "" "%LOCAL_URL%"
pause
