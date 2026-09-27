@echo off
cd /d "%~dp0"
if exist "%~dp0dist\Murmur\Murmur.exe" (
  start "" "%~dp0dist\Murmur\Murmur.exe"
  exit /b
)
node scripts\launch.cjs
if errorlevel 1 pause
