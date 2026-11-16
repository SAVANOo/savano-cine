$ErrorActionPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Test-LocalPort($port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(350)
    if ($ok) { $client.EndConnect($async); return $true }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Stop-PortProcess($port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $conns) {
    if ($conn.OwningProcess -and $conn.OwningProcess -gt 0) {
      Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

Stop-PortProcess 4174
Stop-PortProcess 5173
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

Start-Process -FilePath 'node' -ArgumentList 'scripts/api-server.mjs' -WorkingDirectory $projectRoot -WindowStyle Minimized
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173' -WorkingDirectory $projectRoot -WindowStyle Minimized

$cloudflaredExe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (Test-Path $cloudflaredExe) {
  $tunnelLog = Join-Path $projectRoot 'data\cloudflared.log'
  $tunnelFile = Join-Path $projectRoot 'data\tunnel-url.txt'
  Remove-Item $tunnelLog, $tunnelFile -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $cloudflaredExe -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:4174', '--logfile', $tunnelLog -WorkingDirectory $projectRoot -WindowStyle Hidden
}

for ($i = 0; $i -lt 30; $i++) {
  if ((Test-LocalPort 4174) -and (Test-LocalPort 5173)) { break }
  Start-Sleep -Milliseconds 500
}

$tunnelUrl = ''
if (Test-Path (Join-Path $projectRoot 'data\cloudflared.log')) {
  for ($j = 0; $j -lt 12; $j++) {
    $rawLog = Get-Content (Join-Path $projectRoot 'data\cloudflared.log') -Raw -ErrorAction SilentlyContinue
    if ($rawLog -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
      $tunnelUrl = $matches[0]
      Set-Content -Path (Join-Path $projectRoot 'data\tunnel-url.txt') -Value $tunnelUrl -Encoding UTF8
      break
    }
    Start-Sleep -Milliseconds 500
  }
}

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
$pinState = if ($env:CINE_ACCESS_PIN) { 'Ativo (CINE_ACCESS_PIN)' } else { 'Desativado (apenas selecao/senha por perfil)' }

Clear-Host
Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Magenta
Write-Host '                    SAVANO CINE - SERVIDOR ATIVO              ' -ForegroundColor White
Write-Host '  ============================================================' -ForegroundColor Magenta
Write-Host ('  PC Local       : http://127.0.0.1:5173') -ForegroundColor Cyan
if ($lanIp) {
  Write-Host ("  Wi-Fi / Celular: http://$lanIp:4174") -ForegroundColor Green
  Write-Host ("  APK (Wi-Fi)    : http://$lanIp:4174/api/android/apk") -ForegroundColor Green
}
if ($tunnelUrl) {
  Write-Host ("  Internet (4G)  : $tunnelUrl") -ForegroundColor Yellow
  Write-Host ("  APK (Internet) : $tunnelUrl/api/android/apk") -ForegroundColor Yellow
} else {
  Write-Host '  Internet (4G)  : Tunel nao iniciado' -ForegroundColor DarkGray
}
Write-Host ("  PIN Global     : $pinState") -ForegroundColor Gray
Write-Host '  ============================================================' -ForegroundColor Magenta
Write-Host ''

Start-Process 'http://127.0.0.1:5173'
Read-Host '  Pressione Enter para fechar esta janela (o servidor continua rodando)'
