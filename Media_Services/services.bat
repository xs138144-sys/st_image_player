@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title SillyTavern Media Services - Background Launcher

echo ====================================================
echo   SillyTavern Media Services - Background Launcher
echo ====================================================
echo.

REM Check Python environment
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found! Please install Python first.
    pause
    exit /b 1
)

echo [INFO] Checking Python environment...
for /f "tokens=*" %%i in ('python --version 2^>^&1') do set python_version=%%i
echo [INFO] Python version: !python_version!

REM Check dependencies
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing dependencies...
    pip install -r requirements.txt >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed!
        pause
        exit /b 1
    )
    echo [SUCCESS] Dependencies installed
)

echo.
echo [INFO] Service configuration:
echo [INFO] Media Player: http://127.0.0.1:9000
echo [INFO] File Delete API: http://127.0.0.1:8001
echo [INFO] System Tray Monitor: Bottom-right system tray
echo.

REM Check port usage
echo [INFO] Checking port availability...
netstat -ano | findstr ":9000" >nul
if not errorlevel 1 (
    echo [WARNING] Port 9000 is occupied, closing existing service
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":9000"') do (
        echo [INFO] Closing process PID: %%p
        taskkill /f /pid %%p >nul 2>&1
    )
)

netstat -ano | findstr ":8001" >nul
if not errorlevel 1 (
    echo [WARNING] Port 8001 is occupied, closing existing service
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8001"') do (
        echo [INFO] Closing process PID: %%p
        taskkill /f /pid %%p >nul 2>&1
    )
)

echo.
echo [INFO] Starting services in background mode...

REM Create VBS script to run Python services in completely hidden windows
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\start_services_hidden.vbs"
echo WshShell.CurrentDirectory = "%~dp0" >> "%temp%\start_services_hidden.vbs"
echo WshShell.Run "python run_optimized.py", 0, False >> "%temp%\start_services_hidden.vbs"
echo WScript.Sleep 5000 >> "%temp%\start_services_hidden.vbs"
echo WshShell.Run "python media_server.py", 0, False >> "%temp%\start_services_hidden.vbs"
echo WScript.Sleep 3000 >> "%temp%\start_services_hidden.vbs"
echo WshShell.Run "python tray_monitor.py", 0, False >> "%temp%\start_services_hidden.vbs"

REM Start services using VBS script (completely hidden)
start "" /min wscript "%temp%\start_services_hidden.vbs"

echo [INFO] Services starting in completely hidden mode...
timeout /t 10 /nobreak >nul

REM Check if services started successfully
echo [INFO] Verifying service status...
netstat -ano | findstr ":9000" >nul
if errorlevel 1 (
    echo [ERROR] Media player service failed to start!
    goto :cleanup
)
echo [SUCCESS] Media player service started

netstat -ano | findstr ":8001" >nul
if errorlevel 1 (
    echo [ERROR] File delete API service failed to start!
    goto :cleanup
)
echo [SUCCESS] File delete API service started

echo.
echo ====================================================
echo [SUCCESS] All services started successfully in background!
echo ====================================================
echo.
echo [OPERATION GUIDE]
echo 1. Check system tray (bottom-right) for "SillyTavern Service Monitor" icon
echo 2. Right-click tray icon to view service status

echo 3. Select "Exit and Close All Services" to safely exit
echo 4. All services are running in background, no windows visible
echo.
echo [SERVICE ADDRESSES]
echo Media Player: http://127.0.0.1:9000
echo File Management: http://127.0.0.1:8001
echo.
echo [INFO] This window will close automatically in 3 seconds...
timeout /t 3 /nobreak >nul

exit /b 0

:cleanup
echo.
echo [ERROR] Service startup failed, cleaning up...
REM Close any services that may have started
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im wscript.exe >nul 2>&1
del "%temp%\start_services.vbs" >nul 2>&1
echo [INFO] Cleanup completed
echo Press any key to exit...
pause >nul
exit /b 1