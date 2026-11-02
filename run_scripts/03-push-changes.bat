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
git rev-parse --is-inside-work-tree >nul 2>nul || (echo [FAIL] Not a Git repository.&exit /b 1)
git remote get-url origin >nul 2>nul || (echo [FAIL] origin missing.&exit /b 1)
call npm ci && call npm run check || (echo [FAIL] Validation failed. No push.&exit /b 1)
git status --short
set /p "COMMIT_MSG=Commit message: "
git add -A && git commit -m "%COMMIT_MSG%" && git push || exit /b 1
set "REPO_URL="
for /f "delims=" %%U in ('gh repo view --json url -q ".url" 2^>nul') do set "REPO_URL=%%U"
if not defined REPO_URL (echo [FAIL] Verified repository URL unavailable.&exit /b 1)
start "" "%REPO_URL%"
where gh >nul 2>nul && gh run list --limit 5
echo [PASS] Changes pushed: %REPO_URL%&pause
