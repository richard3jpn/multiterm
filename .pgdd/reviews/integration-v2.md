PGDD-REVIEW: verdict=PASS phase=integration-v2 digest=77ecfee790ac9dfe880dd736f04b70bb2a3b881fdc68d3a52e4af8ee91c6a303 at=2026-07-25T05:57:41.376Z

# Adversary Review — Phase 11: integration-v2

レビュー実施: adversaryエージェント（1回目でPASS）。5次元すべてPASS。

## 実測確認（稼働中v2 Dockerコンテナへの再実測）
- 127.0.0.1限定公開: docker ps + ss -tln で両ポート127.0.0.1のみLISTEN
- 許可リスト外シェル拒否: POST {shell:"/bin/evil"}→400
- WS Origin検証: Origin無し/不正→403、許可Origin+不存在session→404
- REST不正Origin→403（GET /api/shells・POST）
- コンテナ内シェル検出: bash/sh（docker exec で存在確認）
- terraform validate Success / fmt -check 通過
- BUILDLOG記録に過大主張なし

## MEDIUM（FAIL根拠外・記録のみ）
- REST no-Originは200許可（WSは403）。RDDはREST側にCORSホワイトリストのみ要求・CSRFはブラウザがOrigin付与するため塞がる。ループバック限定と二重防御
- backendコンテナがrootで稼働（Phase6繰り延べ範囲。非root化はdefense-in-depth推奨）
- フォント即時反映のDocker版は同一ビルド成果物からの外挿（dev :5174で実機確認済み）
- origin.tsのdocstring「Originなし拒否」がREST実挙動と乖離 + 旧「5章9項」参照 → docs-v2で追随

VERDICT: PASS
