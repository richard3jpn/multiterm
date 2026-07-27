PGDD-REVIEW: verdict=PASS phase=requirements-v3 digest=04495ffa4826ae3ff1891beeb898b0bc2d9286671c9be22a7c91e6db14727504 at=2026-07-25T06:28:30.582Z

# Adversary Review — Phase 13: requirements-v3

レビュー実施: adversaryエージェント（1回目でPASS）。5次元すべてPASS。

## 確認事項
- セキュリティ設計（許可リストid-only・path/argsサーバ固定・配列引数でシェル補間なし・許可外400・Origin/CORS/ループバック維持）に注入面なし
- 既存Linux検出・Sessionモデル(shell=id)・状態判定との矛盾なし

## HIGH/MEDIUM対応（証跡保存前にRDDへ反映）
- HIGH: file/path表記ゆれ → 表を「path」列に統一、shell.path表記に修正
- HIGH: args必須化のLinux移行未記載 → args?:string[]（オプショナル）に変更、既存Linuxエントリはargs未指定でよいと明記
- HIGH: server.tsのargs空配列ハードコード結合 → PtySpawn/create/server.tsの3点更新が必要と明記（backend-v3で検証）
- MEDIUM: cmd状態判定の冗長性 → cmd/PSは既存汎用パターン/>\s*$/で判定と修正、新パターン追加不要に。受け入れ基準も「汎用パターンでidle判定」に変更
- MEDIUM: 7章条件表の二重ソース → 7章条件表の対象にcmd.exe/powershell明記、汎用行にcmd例追記
- MEDIUM: WSLログインシェル取得方法 → wsl -d <distro> -- sh -lc 'echo $SHELL'、フォールバックはwhichで在否確認と明記
- MEDIUM: wsl -l -v パース堅牢性 → UTF-16LE/*マーカ/空白整形を明記、パース失敗時はWSLシェル追加せずcmd/PS維持

VERDICT: PASS
