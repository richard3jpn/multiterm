PGDD-REVIEW: verdict=PASS phase=backend-v3 digest=63507c023df974b869b349510a92ffa4b07d7957280b0089e41822a796b21755 at=2026-07-25T06:39:07.813Z

# Adversary Review — Phase 14: backend-v3

レビュー実施: adversaryエージェント（1回目でPASS）。5次元すべてPASS。

## 確認事項（全経路トレース）
- クライアント入力→spawnのfile/args混入経路を全5経路（REST/create/spawn/WS/execFile）で不在確認
- resolveShellのid厳密一致・許可外400、execFileは全て配列引数でインジェクションなし
- parseWslDistros/buildWindowsShellsのエッジ（UTF-16残渣・*マーカ・docker-desktop除外・失敗時空）をテストで確認
- cmd/PSプロンプトの既存パターンidle判定、conptyハンドラが正常系を飲まない（非マッチはthrow）
- 既存99テスト・build非破壊、detectShellsのUnix専用化で既存挙動維持

## MEDIUM対応（証跡保存前に反映）
- conpty握りつぶしのグローバル汚染 → win32限定 + スタックにnode-pty/conpty含む場合のみに厳格化。99テストGREEN維持
- 残余（記録のみ）: cmd/powershellの無条件追加（Nano Server等の例外環境。RDD前提のWin10/11では問題なし）/ conptyエラーがuncaughtExceptionに到達するかは実機依存（integration-v3の手動確認で担保）/ server.tsのwin32副作用ロジックはLinuxで未実行（純関数でテスト担保）

VERDICT: PASS
