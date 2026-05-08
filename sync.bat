@echo off
echo ===================================================
echo   DASHBOARD SYNC TOOL (CLEAN VERSION)
echo ===================================================
echo.
echo 1. Cleaning up large files...
git rm -r --cached . >nul 2>&1
echo 2. Staging only dashboard code...
git add .
echo 3. Committing changes...
git commit -m "Update dashboard: Strength rebrand and Weapon display"
echo 4. Pushing to GitHub...
echo (If a popup appears, please sign in to your GitHub account)
git push origin main --force
echo.
echo ===================================================
echo   SUCCESS! Your dashboard is now up to date.
echo ===================================================
pause
