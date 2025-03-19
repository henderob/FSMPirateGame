@echo off
echo Checking for Python...

REM Try different Python commands
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Found Python
    goto :start_server
)

where python3 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Found Python3
    set PYTHON_CMD=python3
    goto :start_server
)

where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Found Python Launcher
    set PYTHON_CMD=py
    goto :start_server
)

REM Check common Python installation paths
if exist "C:\Python39\python.exe" (
    echo Found Python in C:\Python39
    set PYTHON_CMD=C:\Python39\python.exe
    goto :start_server
)

if exist "C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python39\python.exe" (
    echo Found Python in AppData
    set PYTHON_CMD=C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python39\python.exe
    goto :start_server
)

echo Python not found in PATH or common locations.
echo Please ensure Python is installed and added to your PATH
echo or try running one of these commands in a new command prompt:
echo python -m http.server 3000
echo python3 -m http.server 3000
echo py -m http.server 3000
pause
exit /b 1

:start_server
echo Starting local server...
echo Server will be available at http://localhost:3000
start http://localhost:3000
%PYTHON_CMD% -m http.server 3000
pause 