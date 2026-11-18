@echo off
title Scoreboard server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
start "" http://localhost:8765/admin
node server.js
pause
