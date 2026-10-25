# Autoriza a chave do DevCord no SSH do Windows.
# Assim o servidor DevCord consegue abrir os terminais dos ambientes por SSH, sem senha
# (nem a da conta Microsoft). Se não estiver como administrador, pede a permissão sozinho.
param([switch]$Elevated)

$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevatedNow = ([Security.Principal.WindowsPrincipal]$me).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $elevatedNow) {
  Write-Host 'Pedindo permissão de administrador: confirme com "Sim" ou com o seu PIN...'
  $exe = (Get-Process -Id $PID).Path
  try {
    Start-Process $exe -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated'
  } catch {
    Write-Host 'Permissão cancelada. Nada foi alterado.' -ForegroundColor Yellow
  }
  exit
}

try {
  $pub = Join-Path $PSScriptRoot '..\server\data\ssh\devcord_ed25519.pub'
  if (-not (Test-Path $pub)) { throw "Chave não encontrada em $pub. Inicie o servidor DevCord uma vez para gerá-la." }

  # "restrict,pty": a chave só abre terminal (sem túneis/encaminhamentos).
  $line = 'restrict,pty ' + (Get-Content $pub -Raw).Trim()

  # Compara pelo SID: funciona também com conta Microsoft (MicrosoftAccount\email).
  $isAdminUser = $null -ne (Get-LocalGroupMember -SID S-1-5-32-544 | Where-Object { $_.SID -eq $me.User })
  if ($isAdminUser) {
    # Usuários administradores: o sshd do Windows só lê este arquivo.
    $file = 'C:\ProgramData\ssh\administrators_authorized_keys'
  } else {
    $file = Join-Path $HOME '.ssh\authorized_keys'
    New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
  }

  $existing = if (Test-Path $file) { Get-Content $file } else { @() }
  if ($existing -contains $line) {
    Write-Host "A chave do DevCord já estava autorizada em $file" -ForegroundColor Green
  } else {
    Add-Content -Path $file -Value $line -Encoding ascii
    Write-Host "Chave do DevCord autorizada em $file" -ForegroundColor Green
  }

  if ($isAdminUser) {
    # O sshd exige que só Administradores e SYSTEM tenham acesso a este arquivo.
    # SIDs em vez de nomes: funciona em Windows de qualquer idioma.
    icacls $file /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null
  }
  Write-Host 'Pronto! O terminal do DevCord já pode entrar sem senha.' -ForegroundColor Green
} catch {
  Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
}
if ($Elevated) { Read-Host 'Enter para fechar' }
