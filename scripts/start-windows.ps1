# MultiTerm - Windows host startup script (RDD 9.5)
#
# Runs the backend directly on the Windows host so that new terminals can open
# Windows PowerShell / cmd.exe / WSL distros (zsh etc., with your dotfiles).
#
# Prerequisite: Node.js (v22.x) installed on Windows. node-pty ships prebuilt (no build tools).
# Usage (from PowerShell):
#   cd <project>\scripts
#   .\start-windows.ps1
# Stop: Ctrl+C (terminates both process trees)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'

$BackendPort = 3001
$FrontendPort = 5173

# Security (RDD 5.12 / 8): loopback-only bind + Origin whitelist.
# Use 127.0.0.1 (not "localhost") everywhere to avoid IPv4/IPv6 resolution mismatch.
$env:PORT = "$BackendPort"
$env:HOST = '127.0.0.1'
$env:ALLOWED_ORIGINS = "http://127.0.0.1:$FrontendPort,http://localhost:$FrontendPort"
$env:NODE_ENV = 'development'
$env:VITE_WS_URL = "ws://127.0.0.1:$BackendPort"
$env:VITE_API_URL = "http://127.0.0.1:$BackendPort"

Write-Host '=== MultiTerm (Windows host) ===' -ForegroundColor Cyan
Write-Host "backend : http://127.0.0.1:$BackendPort (loopback only)" -ForegroundColor Gray
Write-Host "frontend: http://127.0.0.1:$FrontendPort" -ForegroundColor Gray

# Install deps on first run (node-pty is prebuilt)
if (-not (Test-Path (Join-Path $Backend 'node_modules'))) {
  Write-Host 'backend: npm install...' -ForegroundColor Yellow
  Push-Location $Backend; npm install --no-fund --no-audit; Pop-Location
}
if (-not (Test-Path (Join-Path $Frontend 'node_modules'))) {
  Write-Host 'frontend: npm install...' -ForegroundColor Yellow
  Push-Location $Frontend; npm install --no-fund --no-audit; Pop-Location
}

# Build backend with tsc, then run compiled JS with node.
# (npx tsx did not start reliably in verification; compiled node is the supported path.)
Write-Host 'backend: building (tsc)...' -ForegroundColor Yellow
Push-Location $Backend; & npm run build; Pop-Location
if (-not (Test-Path (Join-Path $Backend 'dist\server.js'))) {
  throw 'backend build failed: dist/server.js not found'
}

# Start backend (node) and frontend (vite). cmd /c ensures .cmd shims resolve.
$backendProc = Start-Process -PassThru -NoNewWindow -WorkingDirectory $Backend `
  -FilePath 'node' -ArgumentList 'dist\server.js'
$frontendProc = Start-Process -PassThru -NoNewWindow -WorkingDirectory $Frontend `
  -FilePath 'cmd' -ArgumentList '/c', 'npx', 'vite', '--port', "$FrontendPort", '--strictPort'

Write-Host "Open http://127.0.0.1:$FrontendPort in your browser." -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop.' -ForegroundColor Gray

# Terminate a whole process tree by PID (kills grandchildren too)
function Stop-Tree($processId) {
  if ($processId) { taskkill /PID $processId /T /F 2>$null | Out-Null }
}

try {
  # Stop everything as soon as EITHER process exits (so a crashed backend is noticed)
  while ($true) {
    Start-Sleep -Seconds 1
    if ($backendProc.HasExited) { Write-Host 'backend exited.' -ForegroundColor Red; break }
    if ($frontendProc.HasExited) { Write-Host 'frontend exited.' -ForegroundColor Red; break }
  }
}
finally {
  Stop-Tree $backendProc.Id
  Stop-Tree $frontendProc.Id
}
