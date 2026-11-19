@echo off
setlocal DisableDelayedExpansion
set "appNode=%~dp0runtime\node.exe"
if not exist "%appNode%" set "appNode=node"
"%appNode%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo This source copy needs Node.js 20 or newer. Use the Windows x64 download with the included runtime, or install Node.js from https://nodejs.org/
  pause
  exit /b 1
)
"%appNode%" "%~dp0scripts\open-mine.cjs" %*
if errorlevel 1 (
  pause
  exit /b 1
)
