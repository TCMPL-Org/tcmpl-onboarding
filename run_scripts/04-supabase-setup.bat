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
where supabase >nul 2>nul || (echo [FAIL] Supabase CLI required.&exit /b 1)
supabase projects list >nul 2>nul || supabase login || exit /b 1
choice /c EN /n /m "Existing project or New? [E/N]: "
if errorlevel 2 goto :new
set /p "PROJECT_REF=Existing project ref: "&goto :link
:new
set /p "PROJECT_NAME=New project name: "
set /p "ORG_ID=Organization id: "
set /p "DB_PASSWORD=Database password (visible input): "
supabase projects create "%PROJECT_NAME%" --org-id "%ORG_ID%" --db-password "%DB_PASSWORD%" || exit /b 1
set "DB_PASSWORD="
set /p "PROJECT_REF=Created project ref: "
:link
supabase link --project-ref "%PROJECT_REF%" || exit /b 1
supabase db push || exit /b 1
if not exist .env copy /y .env.example .env >nul
set /p "SUPABASE_URL=Supabase URL: "
set /p "SUPABASE_ANON_KEY=Supabase anon key: "
powershell -NoProfile -Command "$p='.env';$c=Get-Content $p;$c=$c-replace '^VITE_SUPABASE_URL=.*$','VITE_SUPABASE_URL=%SUPABASE_URL%'-replace '^VITE_SUPABASE_ANON_KEY=.*$','VITE_SUPABASE_ANON_KEY=%SUPABASE_ANON_KEY%';Set-Content -Encoding UTF8 $p $c"
echo [PASS] Supabase linked and migrations applied.&pause
