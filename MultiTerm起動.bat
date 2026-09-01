@echo off
rem MultiTerm launcher (double-click).
rem Wraps scripts\start-windows.ps1 and opens the browser once the app is up.
rem Screen, REST API and WebSocket are all served from a single port by the Rust binary.
rem Stop: Ctrl+C, or just close this window.
setlocal
pushd "%~dp0"
title MultiTerm

rem Wait for port 3001 to accept a connection, then open the browser.
rem The release build (LTO) can take a few minutes on a cold target dir, so wait up to 5 min.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "for ($i=0; $i -lt 600; $i++) { $c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', 3001); Start-Process 'http://127.0.0.1:3001'; break } catch { Start-Sleep -Milliseconds 500 } finally { $c.Dispose() } }"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"

echo.
echo MultiTerm stopped.
popd
pause
