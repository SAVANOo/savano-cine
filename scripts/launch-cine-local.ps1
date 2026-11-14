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

if (-not (Test-LocalPort 4174)) {
  Start-Process -FilePath 'node' -ArgumentList 'scripts/api-server.mjs' -WorkingDirectory $projectRoot -WindowStyle Minimized
}

if (-not (Test-LocalPort 5173)) {
  Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173' -WorkingDirectory $projectRoot -WindowStyle Minimized
}

for ($i = 0; $i -lt 30; $i++) {
  if ((Test-LocalPort 4174) -and (Test-LocalPort 5173)) { break }
  Start-Sleep -Milliseconds 500
}

Start-Process 'http://127.0.0.1:5173'
