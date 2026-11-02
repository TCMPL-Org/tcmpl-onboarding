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
call npm ci || goto :fail
call npm run check || goto :fail
git check-ignore .env >nul 2>nul || (if exist .git echo [FAIL] .env not ignored.&goto :fail)
echo [PASS] dependencies, lint, typecheck, tests, build.&pause&exit /b 0
:fail
echo [FAIL] Complete validation failed.&pause&exit /b 1
