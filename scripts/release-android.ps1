param(
  [string]$VersionName = "1.0.0",
  [int]$VersionCode = 10000,
  [string]$Abi = "arm64-v8a",
  [switch]$SkipBuild,
  [switch]$PublishGitHub,
  [string]$StoreRepoPath = "",
  [string]$GradleBin = "C:\Users\savio\.gradle\wrapper\dists\gradle-9.2.1-bin\2t0n5ozlw9xmuyvbp7dnzaxug\gradle-9.2.1\bin\gradle.bat"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AndroidDir = Join-Path $RepoRoot "android"
$ReleaseDir = Join-Path $AndroidDir "release"
$ApkName = "savano-cine-$VersionName-$Abi.apk"
$DestApk = Join-Path $ReleaseDir $ApkName
$ManifestPath = Join-Path $ReleaseDir "release-manifest.json"
$Tag = "v$VersionName"

if (-not $SkipBuild) {
  if (-not (Test-Path $GradleBin)) {
    throw "Gradle não encontrado em: $GradleBin"
  }
  Write-Host "Compilando APK Release ($VersionName / code $VersionCode)..." -ForegroundColor Cyan
  Push-Location $AndroidDir
  try {
    & $GradleBin :app:assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Falha no :app:assembleRelease" }
  } finally {
    Pop-Location
  }
}

$SignedApk = Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $SignedApk)) {
  throw "APK assinado não encontrado em $SignedApk. Verifique android/keystore.properties (UTF-8 sem BOM)."
}

New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
Copy-Item $SignedApk $DestApk -Force

$Sha256 = (Get-FileHash $DestApk -Algorithm SHA256).Hash.ToLower()
$SizeBytes = (Get-Item $DestApk).Length

$Manifest = [ordered]@{
  packageId   = "com.savanocine.app"
  name        = "Savano Cine"
  versionName = $VersionName
  versionCode = $VersionCode
  abi         = $Abi
  apkFileName = $ApkName
  sizeBytes   = $SizeBytes
  sha256      = $Sha256
  iconUrl     = "https://raw.githubusercontent.com/SAVANOo/savano-cine/main/public/icon-512.png"
  releasedAt  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  changelog   = @(
    "Release v$VersionName ($Abi) assinada com keystore externa e R8/ProGuard",
    "Streaming local e addons Stremio com Dual-Audio e legendas em camada GPU",
    "Download sequencial por bandas em torrents, recuperacao de peer e seek estavel",
    "Telemetria end-to-end de fluxos, player e APIs no painel Admin"
  )
}

[System.IO.File]::WriteAllText(
  $ManifestPath,
  ($Manifest | ConvertTo-Json -Depth 4),
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Manifesto gerado em: $ManifestPath" -ForegroundColor Green
Write-Host "APK: $DestApk ($SizeBytes bytes | SHA-256: $Sha256)" -ForegroundColor Green

if ($PublishGitHub) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) {
    throw "GitHub CLI (gh) não encontrado. Instale com: winget install --id GitHub.cli -e"
  }
  $releaseExists = $false
  & gh release view $Tag --repo SAVANOo/savano-cine *> $null
  if ($LASTEXITCODE -eq 0) { $releaseExists = $true }

  if ($releaseExists) {
    Write-Host "Atualizando APK na release $Tag via gh release upload --clobber..." -ForegroundColor Cyan
    & gh release upload $Tag $DestApk --repo SAVANOo/savano-cine --clobber
  } else {
    Write-Host "Criando release $Tag no GitHub com APK..." -ForegroundColor Cyan
    & gh release create $Tag $DestApk --repo SAVANOo/savano-cine --title "Savano Cine $Tag" --notes "Release $Tag ($Abi) - SHA-256: $Sha256"
  }
  if ($LASTEXITCODE -ne 0) { throw "Falha ao publicar release no GitHub via gh" }
}

if ($StoreRepoPath) {
  $StoreAbs = (Resolve-Path $StoreRepoPath).Path
  $PublishScript = Join-Path $StoreAbs "scripts\publish-release.mjs"
  if (-not (Test-Path $PublishScript)) {
    throw "Script publish-release.mjs não encontrado em $PublishScript"
  }
  $BaseUrl = "https://github.com/SAVANOo/savano-cine/releases/download/$Tag"
  Write-Host "Atualizando catalog/catalog.json da Savano Store em $StoreAbs..." -ForegroundColor Cyan
  & node $PublishScript --manifest $ManifestPath --release-base-url $BaseUrl --apk $DestApk --catalog (Join-Path $StoreAbs "catalog\catalog.json")
  if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar catalog.json na Savano Store" }
}
