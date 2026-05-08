@echo off
REM Quezon City kiosk launcher — silent printing enabled.
REM Closes existing Edge windows then relaunches with --kiosk-printing flag.

echo Closing existing Edge windows...
taskkill /F /IM msedge.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Launching Quezon City kiosk with silent printing...
start "" msedge.exe --kiosk-printing --no-first-run --disable-features=msEdgeStickyNotesAppFeature "http://localhost:3000/kiosk?client=quezon_city"

exit
