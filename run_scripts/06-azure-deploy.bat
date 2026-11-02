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
where az >nul 2>nul || (echo [FAIL] Azure CLI required.&exit /b 1)
az account show >nul 2>nul || az login || exit /b 1
az account list --output table
set /p "SUBSCRIPTION=Subscription id or name: "
az account set --subscription "%SUBSCRIPTION%" || exit /b 1
set /p "RESOURCE_GROUP=Resource group [tcmpl-onboarding-rg]: "&if not defined RESOURCE_GROUP set "RESOURCE_GROUP=tcmpl-onboarding-rg"
set /p "APP_NAME=Globally unique app name: "
set /p "LOCATION=Location [centralindia]: "&if not defined LOCATION set "LOCATION=centralindia"
set "ACR_NAME=%APP_NAME:-=%acr"
az group create -n "%RESOURCE_GROUP%" -l "%LOCATION%" || exit /b 1
az acr create -g "%RESOURCE_GROUP%" -n "%ACR_NAME%" --sku Basic || exit /b 1
az acr build -r "%ACR_NAME%" -t tcmpl-onboarding:latest . || exit /b 1
az appservice plan create -g "%RESOURCE_GROUP%" -n "%APP_NAME%-plan" --is-linux --sku P1v3 || exit /b 1
for /f "delims=" %%U in ('az acr show -n "%ACR_NAME%" --query loginServer -o tsv') do set "ACR_SERVER=%%U"
az webapp create -g "%RESOURCE_GROUP%" -p "%APP_NAME%-plan" -n "%APP_NAME%" --deployment-container-image-name "%ACR_SERVER%/tcmpl-onboarding:latest" || exit /b 1
az webapp config appsettings set -g "%RESOURCE_GROUP%" -n "%APP_NAME%" --settings WEBSITES_PORT=8080 || exit /b 1
az webapp config set -g "%RESOURCE_GROUP%" -n "%APP_NAME%" --always-on true || exit /b 1
set "LIVE_URL=https://%APP_NAME%.azurewebsites.net"
for /l %%I in (1,1,10) do (powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing '%LIVE_URL%/health' -TimeoutSec 5;if($r.StatusCode -eq 200){exit 0}}catch{};exit 1" && goto :ok&timeout /t 3 /nobreak >nul)
echo [FAIL] Azure health verification failed.&exit /b 1
:ok
echo [PASS] Azure resources, container deployment and health.&start "" "%LIVE_URL%"&pause
