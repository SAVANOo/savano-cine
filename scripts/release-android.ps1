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
$Tag = "v$VersionName"
$ApkName = "savano-cine-$Tag-$Abi.apk"
$DestApk = Join-Path $ReleaseDir $ApkName
$ManifestPath = Join-Path $ReleaseDir "release-manifest.json"

if (-not $SkipBuild) {
  if (-not (Test-Path $GradleBin)) {
    throw "Gradle não encontrado em: $GradleBin"
  }
  Write-Host "Compilando APK Release ($VersionName / code $VersionCode)..." -ForegroundColor Cyan
  $env:JAVA_TOOL_OPTIONS = "-Dfile.encoding=UTF-8"
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
$SignerSha256 = ""

$apksignerCmd = Get-Command apksigner -ErrorAction SilentlyContinue
if (-not $apksignerCmd -and $env:ANDROID_HOME) {
  $foundSigner = Get-ChildItem (Join-Path $env:ANDROID_HOME "build-tools") -Recurse -Filter "apksigner.bat" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($foundSigner) { $apksignerCmd = $foundSigner.FullName }
}
if ($apksignerCmd) {
  $verifyOut = & $apksignerCmd verify --verbose --print-certs $DestApk 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "Falha na verificação criptográfica (apksigner): $verifyOut" }
  if ($verifyOut -match 'Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]{64})') {
    $SignerSha256 = $Matches[1].ToLower()
  }
}

$ReleaseBaseUrl = "https://github.com/SAVANOo/savano-cine/releases/download/$Tag"

$Manifest = [ordered]@{
  packageId   = "com.savanocine.app"
  name        = "Savano Cine"
  tagline     = "Streaming local e catálogo pessoal"
  versionName = $VersionName
  versionCode = $VersionCode
  abi         = $Abi
  apkFileName = $ApkName
  apkUrl      = "$ReleaseBaseUrl/$ApkName"
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
if ($SignerSha256) { $Manifest.signerSha256 = $SignerSha256 }

[System.IO.File]::WriteAllText(
  $ManifestPath,
  ($Manifest | ConvertTo-Json -Depth 4),
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Manifesto gerado em: $ManifestPath" -ForegroundColor Green
Write-Host "APK: $DestApk ($SizeBytes bytes | SHA-256: $Sha256)" -ForegroundColor Green

if ($PublishGitHub) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh -and (Test-Path "C:\Program Files\GitHub CLI\gh.exe")) {
    $env:Path += ";C:\Program Files\GitHub CLI"
    $gh = Get-Command gh -ErrorAction SilentlyContinue
  }
  if (-not $gh) {
    throw "GitHub CLI (gh) não encontrado. Instale com: winget install --id GitHub.cli -e"
  }
  $releaseExists = $false
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & gh release view $Tag --repo SAVANOo/savano-cine 2>$null 1>$null
  $viewExit = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($viewExit -eq 0) { $releaseExists = $true }

  if ($releaseExists) {
    Write-Host "Atualizando APK e manifesto na release $Tag via gh release upload --clobber..." -ForegroundColor Cyan
    & gh release upload $Tag $DestApk $ManifestPath --repo SAVANOo/savano-cine --clobber
  } else {
    Write-Host "Criando release $Tag no GitHub com APK e manifesto..." -ForegroundColor Cyan
    & gh release create $Tag $DestApk $ManifestPath --repo SAVANOo/savano-cine --title "Savano Cine $Tag" --notes "Release $Tag ($Abi) - SHA-256: $Sha256"
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
