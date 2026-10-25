# DevCord em modo servidor: app compilado + API + tempo real numa porta só,
# publicado na internet por HTTPS com um túnel Cloudflare.
#
# Variáveis opcionais:
#   PORT                   porta local do servidor (padrão 3001)
#   DEVCORD_TUNNEL_TOKEN   token de um túnel Cloudflare nomeado (endereço fixo no seu domínio)
#   DEVCORD_PUBLIC_URL     endereço público desse túnel (só para exibir)
#   DEVCORD_TURN_URL/USER/PASS  servidor TURN para voz/tela entre redes difíceis

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:Path = $env:Path -replace '"', ''   # aspas soltas no PATH impedem o npm de achar o node
$port = if ($env:PORT) { $env:PORT } else { '3001' }
$env:PORT = $port
$env:NODE_ENV = 'production'

function Step($text) { Write-Host "`n[DevCord] $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n[DevCord] $text" -ForegroundColor Red; Read-Host 'Enter para sair'; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js não encontrado. Instale em https://nodejs.org' }
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { Fail 'cloudflared não encontrado. Instale com: winget install Cloudflare.cloudflared' }

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Fail "A porta $port já está em uso (o iniciar.bat ou outro servidor DevCord está aberto?). Feche e tente de novo."
}

if (-not (Test-Path node_modules)) {
  Step 'Instalando dependências (primeira vez)...'
  npm install
  if ($LASTEXITCODE) { Fail 'Falha ao instalar as dependências.' }
}

Step 'Compilando o app web...'
npm run build -w web | Out-Null
if ($LASTEXITCODE) { Fail 'Falha ao compilar o app web.' }

Step "Iniciando o servidor na porta $port..."
$server = Start-Process node -ArgumentList 'src/index.js' -WorkingDirectory (Join-Path $root 'server') -NoNewWindow -PassThru
$tunnel = $null
try {
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://localhost:$port/api/rtc" | Out-Null; $up = $true } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $up) { Fail 'O servidor não respondeu.' }

  # ---- Chave SSH do DevCord: o terminal pela internet depende dela ----
  $key = Join-Path $root 'server\data\ssh\devcord_ed25519'
  $user = if ($env:DEVCORD_SSH_USER) { $env:DEVCORD_SSH_USER } else { $env:USERNAME }
  $sshHost = if ($env:DEVCORD_SSH_HOST) { $env:DEVCORD_SSH_HOST } else { '127.0.0.1' }
  $sshPort = if ($env:DEVCORD_SSH_PORT) { $env:DEVCORD_SSH_PORT } else { '22' }
  function Test-Key {
    if (-not (Test-Path $key)) { return $false }
    ssh -i $key -p $sshPort -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$user@$sshHost" exit 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  }
  Step 'Verificando o acesso SSH do DevCord (terminal)...'
  if (Test-Key) {
    Write-Host '  OK: o DevCord entra por SSH sem senha.' -ForegroundColor Green
  } elseif (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
    Write-Host '  O servidor SSH do Windows não está instalado: o terminal ficará indisponível.' -ForegroundColor Yellow
    Write-Host '  Instale em Configurações > Sistema > Recursos opcionais > Servidor OpenSSH.' -ForegroundColor Yellow
  } else {
    Write-Host '  A chave do DevCord ainda não está autorizada. Vou pedir permissão de administrador (uma vez só)...' -ForegroundColor Yellow
    try {
      Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$root\scripts\autorizar-chave-ssh.ps1`""
    } catch {
      Write-Host '  Permissão negada.' -ForegroundColor Yellow
    }
    if (Test-Key) { Write-Host '  OK: chave autorizada, terminal liberado.' -ForegroundColor Green }
    else { Write-Host '  O terminal ficará indisponível até a chave ser autorizada (rode scripts\autorizar-chave-ssh.ps1 como admin).' -ForegroundColor Yellow }
  }

  # ---- Túnel HTTPS ----
  $log = Join-Path $env:TEMP "devcord-tunnel-$PID.log"
  if ($env:DEVCORD_TUNNEL_TOKEN) {
    Step 'Abrindo o túnel Cloudflare nomeado...'
    $tunnel = Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', 'run', '--token', $env:DEVCORD_TUNNEL_TOKEN -RedirectStandardError $log -WindowStyle Hidden -PassThru
    $url = $env:DEVCORD_PUBLIC_URL
  } else {
    Step 'Abrindo o túnel HTTPS (Cloudflare)...'
    $tunnel = Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://localhost:$port" -RedirectStandardError $log -WindowStyle Hidden -PassThru
    $url = $null
    for ($i = 0; $i -lt 60 -and -not $url; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-Path $log) { $url = ([regex]::Match((Get-Content $log -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')).Value }
    }
    if (-not $url) { Fail "O túnel não informou o endereço. Veja o log: $log" }
  }

  Write-Host ''
  Write-Host '  ================================================================' -ForegroundColor Green
  Write-Host '   DevCord no ar pela internet:' -ForegroundColor Green
  Write-Host "   $url" -ForegroundColor White
  Write-Host '  ================================================================' -ForegroundColor Green
  Write-Host '   - Envie esse endereço (ou um convite gerado nele) para a equipe.'
  Write-Host '   - No VS Code, o botão "Abrir no VS Code" já configura a extensão.'
  if (-not $env:DEVCORD_TUNNEL_TOKEN) {
    Write-Host '   - Endereço temporário: muda a cada vez que o servidor é iniciado.' -ForegroundColor Yellow
    Write-Host '     Para um fixo no seu domínio, use DEVCORD_TUNNEL_TOKEN (veja o README).' -ForegroundColor Yellow
  }
  Write-Host '   - Para desligar: feche esta janela ou aperte Ctrl+C.'
  Write-Host ''
  if ($url) {
    Set-Clipboard $url
    Write-Host '   (endereço copiado para a área de transferência)' -ForegroundColor DarkGray
    Start-Process $url
  }

  # Mantém no ar; se o servidor ou o túnel cair, avisa e encerra o outro.
  while (-not $server.HasExited -and -not $tunnel.HasExited) { Start-Sleep -Seconds 2 }
  if ($server.HasExited) { Write-Host '[DevCord] O servidor parou.' -ForegroundColor Red }
  if ($tunnel.HasExited) { Write-Host "[DevCord] O túnel caiu. Log: $log" -ForegroundColor Red }
} finally {
  foreach ($p in @($tunnel, $server)) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
Read-Host 'Enter para sair'
