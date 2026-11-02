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
for %%F in (01-local-run.bat 02-github-setup.bat 03-push-changes.bat 04-supabase-setup.bat 05-docker-run.bat 06-azure-deploy.bat 07-complete-validation.bat _common.bat) do if not exist "%SCRIPT_DIR%%%F" (echo [FAIL] Missing script: %%F& pause& exit /b 1)
:menu
cls
echo 1. Validate and Run Locally
echo 2. Setup GitHub Repository and CI
echo 3. Validate and Push Changes
echo 4. Setup Supabase
echo 5. Build and Run Docker
echo 6. Deploy to Azure
echo 7. Run Complete Validation
echo 8. Exit
choice /c 12345678 /n /m "Choose: "
if errorlevel 8 exit /b 0
if errorlevel 7 call "%SCRIPT_DIR%07-complete-validation.bat"&goto menu
if errorlevel 6 call "%SCRIPT_DIR%06-azure-deploy.bat"&goto menu
if errorlevel 5 call "%SCRIPT_DIR%05-docker-run.bat"&goto menu
if errorlevel 4 call "%SCRIPT_DIR%04-supabase-setup.bat"&goto menu
if errorlevel 3 call "%SCRIPT_DIR%03-push-changes.bat"&goto menu
if errorlevel 2 call "%SCRIPT_DIR%02-github-setup.bat"&goto menu
if errorlevel 1 call "%SCRIPT_DIR%01-local-run.bat"&goto menu
