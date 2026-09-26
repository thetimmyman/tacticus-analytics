@echo off
title Tacticus GW Defense Parser
cd /d "%~dp0"

REM Check Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Python is not installed or not on PATH.
    echo.
    echo  Please install Python 3 from https://www.python.org/downloads/
    echo  During install, tick "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

python tacticus_gw.py
echo.
echo Press any key to close...
pause >nul
