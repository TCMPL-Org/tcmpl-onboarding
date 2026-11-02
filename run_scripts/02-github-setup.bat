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
where git >nul 2>nul || (echo [FAIL] Git required.&exit /b 1)
where gh >nul 2>nul || (echo [FAIL] GitHub CLI required.&exit /b 1)
call npm ci && call npm run check || exit /b 1
gh auth status >nul 2>nul || gh auth login || exit /b 1
set /p "REPO_NAME=Repository name: "
choice /c PN /n /m "Public or private? [P/N]: "
if errorlevel 2 (set "VIS=private") else set "VIS=public"
if not exist .git git init || exit /b 1
git check-ignore .env >nul 2>nul || (echo [FAIL] .env is not ignored.&exit /b 1)
git add -A && git commit -m "Initial React enterprise release" 2>nul
git branch -M main
gh repo create "%REPO_NAME%" --%VIS% --source=. --remote=origin --push || exit /b 1
if not exist .github\workflows\ci-cd.yml (echo [FAIL] CI/CD missing.&exit /b 1)
set "REPO_URL="
for /f "delims=" %%U in ('gh repo view --json url -q ".url" 2^>nul') do set "REPO_URL=%%U"
if not defined REPO_URL (echo [FAIL] Verified repository URL unavailable.&exit /b 1)
start "" "%REPO_URL%"
echo [PASS] GitHub repository opened: %REPO_URL%&pause
