@echo off
where node >nul 2>nul || (echo [FAIL] Node.js 20+ required.& exit /b 1)
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do if %%V LSS 20 (echo [FAIL] Node.js 20+ required.& exit /b 1)
if not defined LOCAL_URL set "LOCAL_URL=http://localhost:3000"
exit /b 0
