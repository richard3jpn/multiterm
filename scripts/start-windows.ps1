# MultiTerm - Windows ホストでの起動（RDD 9.5章）
#
# Rust バックエンドが PTY・WebSocket・画面の静的配信をすべて担うため、起動するのは
# 1プロセス・1ポートだけ。Node.js の常駐（Express / Vite）はもう無い。
#
# 前提:
#   - Rust ツールチェーン（stable-x86_64-pc-windows-msvc）と MSVC Build Tools
#   - Node.js（フロントのビルドにのみ使用。実行時には不要）
#
# 使い方:
#   .\start-windows.ps1            # 差分ビルドして起動
#   .\start-windows.ps1 -Rebuild   # フロントの npm ci からやり直す
#   .\start-windows.ps1 -SkipBuild # ビルドを飛ばして起動だけ（前回の成果物を使う）
# 停止: Ctrl+C

param(
  [switch]$Rebuild,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$BackendRs = Join-Path $Root 'backend-rs'
$Port = 3001

# セキュリティ（RDD 5章12項 / 8章）: ループバック限定バインド + Origin ホワイトリスト。
# 画面も同じポートから配信するため、許可オリジンはこのポート自身になる。
# IPv4/IPv6 の解決差を避けるため 127.0.0.1 と localhost の両方を許可する。
$env:PORT = "$Port"
$env:HOST = '127.0.0.1'
$env:ALLOWED_ORIGINS = "http://127.0.0.1:$Port,http://localhost:$Port"

Write-Host '=== MultiTerm (Windows host) ===' -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:$Port （画面・API・WebSocket すべて同一ポート）" -ForegroundColor Gray

if (-not $SkipBuild) {
  # フロントは非ASCIIパスでビルドが壊れるため、専用スクリプトが ASCII パスへ退避して行う
  & (Join-Path $PSScriptRoot 'build-frontend.ps1') -Force:$Rebuild
}

# rust-embed が frontend\dist を焼き込むため、dist が無いとコンパイルが通らない
if (-not (Test-Path (Join-Path $Root 'frontend\dist\index.html'))) {
  throw 'frontend\dist がありません。-SkipBuild を外して実行してください'
}

Write-Host '  cargo build --release ...' -ForegroundColor Yellow
Push-Location $BackendRs
try { & cargo build --release } finally { Pop-Location }

$Exe = Join-Path $BackendRs 'target\release\multiterm-backend.exe'
if (-not (Test-Path $Exe)) { throw "ビルド結果が見つかりません: $Exe" }

Write-Host "  起動: $Exe" -ForegroundColor Green
Write-Host '  Ctrl+C で停止します。' -ForegroundColor Gray

# 子プロセスとして起動し、Ctrl+C 時にプロセスツリーごと終了させる
# （PTY の子孫（wsl.exe / powershell.exe 等）を残さないため）
$proc = Start-Process -PassThru -NoNewWindow -FilePath $Exe
try {
  while (-not $proc.HasExited) { Start-Sleep -Seconds 1 }
  Write-Host 'backend exited.' -ForegroundColor Red
}
finally {
  if ($proc -and -not $proc.HasExited) {
    taskkill /PID $proc.Id /T /F 2>$null | Out-Null
  }
}
