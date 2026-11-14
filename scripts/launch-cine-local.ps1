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
Start-Sleep -Milliseconds 400

Start-Process -FilePath 'node' -ArgumentList 'scripts/api-server.mjs' -WorkingDirectory $projectRoot -WindowStyle Minimized
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173' -WorkingDirectory $projectRoot -WindowStyle Minimized

for ($i = 0; $i -lt 30; $i++) {
  if ((Test-LocalPort 4174) -and (Test-LocalPort 5173)) { break }
  Start-Sleep -Milliseconds 500
}

Start-Process 'http://127.0.0.1:5173'
