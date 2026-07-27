# NEXTSTEP

v3全フェーズ完了

- v1（7）+ v2（5）+ v3（5: requirements-v3 / backend-v3 / frontend-v3 / integration-v3 / docs-v3）すべて完了
- Docker/WSL構成は http://localhost:3000（terraform apply済み）で稼働
- Windowsマルチシェル（cmd/PowerShell/WSL zsh）を使う場合は、プロジェクトをWindows側に配置して scripts/start-windows.ps1 で起動（README「3. Windowsホストで起動する場合」参照）
- 残る手動確認: start-windows.ps1 全体（vite起動・プロセス管理）のWindows配置での一括実機実行
