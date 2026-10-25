@echo off
chcp 65001 >nul
title DevCord
cd /d "%~dp0"

rem Remove aspas soltas do PATH (ex.: ...\cloudflared") que impedem o npm de achar o node.
set "PATH=%PATH:"=%"

where node >nul 2>nul
if errorlevel 1 (
  echo [DevCord] Node.js nao encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [DevCord] Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo [DevCord] Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)

echo [DevCord] Iniciando servidor (porta 3001) e app web (porta 5173)...
echo [DevCord] Para parar, feche esta janela ou aperte Ctrl+C.
echo.

rem Abre o navegador assim que o app web responder.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:5173 | Out-Null; Start-Process http://localhost:5173; break } catch { Start-Sleep -Milliseconds 500 } }"

call npm run dev
pause
