@echo off
chcp 65001 >nul
title DevCord - servidor
rem Sobe o DevCord como servidor publicado na internet (HTTPS via Cloudflare).
rem Para desenvolver localmente, use o iniciar.bat.
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servidor.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servidor.ps1"
)
