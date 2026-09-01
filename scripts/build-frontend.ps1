# MultiTerm - フロントエンドのビルド
#
# なぜ ASCII パスへ退避するか:
#   Vite 8 / rolldown は非ASCII文字を含むパス（このプロジェクトは OneDrive 配下で
#   日本語・全角中黒を含む）で node_modules の bare import を解決できず、
#   全依存が external 化された壊れたバンドルを出力する（import 文が残ったまま）。
#   Preact 構成でのみ再現し、ASCII パスへコピーすれば同じコードで正常にビルドできる。
#
# 使い方:
#   .\build-frontend.ps1          # 差分ビルド（node_modules は再利用）
#   .\build-frontend.ps1 -Force   # npm ci からやり直す
#
# 出力: <project>\frontend\dist （rust-embed がこれをバイナリへ焼き込む）

param([switch]$Force)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root 'frontend'
# 退避先は ASCII パス固定。$env:TEMP はユーザー名に日本語を含むため使えない
$BuildDir = 'C:\Temp\multiterm-frontend-build'

Write-Host '=== frontend build (ASCIIパスへ退避) ===' -ForegroundColor Cyan
Write-Host "  source: $Frontend" -ForegroundColor Gray
Write-Host "  build : $BuildDir" -ForegroundColor Gray

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

# 依存の再インストールが要るか（lock の変化・node_modules の欠如・-Force）をコピー前に判定する
$lockSrc = Join-Path $Frontend 'package-lock.json'
$lockDst = Join-Path $BuildDir 'package-lock.json'
$needInstall = $true
if (-not $Force) {
  if ((Test-Path (Join-Path $BuildDir 'node_modules')) -and (Test-Path $lockDst)) {
    if ((Get-FileHash $lockSrc).Hash -eq (Get-FileHash $lockDst).Hash) { $needInstall = $false }
  }
}

# ソースを退避先へミラー。node_modules / dist / .vite は退避先のものを残す
# （node_modules を毎回コピーすると 182MB の転送が発生するため）
robocopy $Frontend $BuildDir /MIR /XD node_modules dist .vite /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "ソースのコピーに失敗しました (robocopy exit $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

if ($needInstall) {
  Write-Host '  npm ci ...' -ForegroundColor Yellow
  Push-Location $BuildDir
  try { npm ci --no-fund --no-audit } finally { Pop-Location }
}

Write-Host '  vite build ...' -ForegroundColor Yellow
Push-Location $BuildDir
try { npm run build } finally { Pop-Location }

$distSrc = Join-Path $BuildDir 'dist'
if (-not (Test-Path (Join-Path $distSrc 'index.html'))) {
  throw "ビルド結果が見つかりません: $distSrc"
}

# 壊れたバンドル（bare import が残っている）を検知する。退避が効いていれば発生しない
$brokenImport = Select-String -Path (Join-Path $distSrc 'assets\*.js') -Pattern 'from"(preact|@xterm/)' -Quiet
if ($brokenImport) {
  throw 'バンドルに未解決の bare import が残っています（ASCIIパス退避が効いていません）'
}

# 生成物をプロジェクトへ戻す
$distDst = Join-Path $Frontend 'dist'
robocopy $distSrc $distDst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "dist の反映に失敗しました (robocopy exit $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

$size = [math]::Round(((Get-ChildItem $distDst -Recurse -File | Measure-Object Length -Sum).Sum / 1KB), 1)
Write-Host "  ok: $distDst ($size KB)" -ForegroundColor Green
