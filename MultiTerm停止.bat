@echo off
rem MultiTerm stopper (double-click).
rem Kills whatever is listening on the MultiTerm port (3001), then re-checks with
rem netstat so a failed kill is never reported as success.
setlocal
title MultiTerm - stop

powershell -NoProfile -ExecutionPolicy Bypass -Command "$found = $false; netstat -ano | Select-String 'LISTENING' | Select-String ':3001\b' | ForEach-Object { $procId = ($_.Line -split '\s+')[-1]; $found = $true; Write-Host ('port 3001: killing pid ' + $procId); taskkill /PID $procId /T /F }; if (-not $found) { Write-Host 'nothing was listening on 3001' }; $left = netstat -ano | Select-String 'LISTENING' | Select-String ':3001\b'; Write-Host ''; if ($left) { Write-Host 'WARNING: still listening -'; $left | ForEach-Object { Write-Host ('  ' + $_.Line.Trim()) } } else { Write-Host 'stopped: 3001 is free' }"

echo.
pause
