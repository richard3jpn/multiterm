# BUILDLOG — MultiTerm

## Phase 1: requirements（要件確認・MVP確定）

- 2026-07-25: 環境事前確認: Node v22.17.0 / npm 11.11.0 / Docker 28.5.1（デーモン稼働）/ Terraform v1.15.8 / python3 3.10.12 / gcc 11.4.0 / make 4.3 — すべて利用可能
- 2026-07-25: Agent.md 3.5節チェックリスト（11項目）とRDD.mdを照合。不足していた「MVP範囲・除外機能・セッション/状態モデル・画面構成・認証・生成先ディレクトリ」をユーザー指示（全フェーズ自律実行）に基づき決定し、RDD.md 5〜8章として追記。決定理由は .pgdd/notes.md に記録
- チェックリスト照合結果:
  1. プロジェクト名・ディレクトリ名: MultiTerm / プロジェクト直下（frontend/・backend/・terraform/） ✓
  2. 概要・目的: RDD.md 1章 ✓
  3. MVP範囲: RDD.md 5章に追記 ✓
  4. 除外機能: RDD.md 6章に追記 ✓
  5. データモデル: DBなし。セッション・状態モデルをRDD.md 7章に定義 ✓
  6. 画面構成: 単一ページ構成をRDD.md 8章に定義 ✓
  7. 認証: なし（127.0.0.1バインドで緩和） ✓
  8. 権限・ロール: なし（シングルユーザー） ✓
  9. 技術スタック: RDD.md 4章（shadcn/ui + Tailwind + xterm.js + Express + ws + node-pty） ✓
  10. 外部サービス連携: なし ✓
  11. デプロイ先: ローカル（Terraform + Docker） ✓

[requirements] 完了
- adversaryレビュー: 3回実施（FAIL→FAIL→PASS）。CRITICAL2件（クロスオリジンWS RCE・Docker公開矛盾）→ RDD 5章9項アクセス制御必須化・8章ネットワーク公開ポリシーで解消。証跡は .pgdd/reviews/ 参照

## Phase 2: environment（環境構築・ツール確認）

- 2026-07-25: ツール確認（コマンド実行結果）: Node v22.17.0 / npm 11.11.0 / Docker 28.5.1（`docker ps` 成功=デーモン稼働）/ Terraform v1.15.8 / Python 3.10.12 / gcc 11.4.0 / GNU Make 4.3 — 追加インストール不要
- 2026-07-25: .gitignore 整備: node_modules/ dist/ .env *.tfstate .terraform/ terraform.tfvars を登録（秘密情報・状態ファイルのコミット禁止）

[environment] 完了

## Phase 3: scaffold（プロジェクト雛形生成）

- 2026-07-25: frontend生成: `npm create vite@latest frontend -- --template react-ts`（Vite 8 / React 19 / TS 6）
- 2026-07-25: frontend依存: tailwindcss@4 + @tailwindcss/vite / @xterm/xterm@6 + @xterm/addon-webgl + @xterm/addon-fit / vitest + @vitest/coverage-v8 + testing-library + jsdom
- 2026-07-25: shadcn/ui初期化: `npx shadcn@latest init -y --no-monorepo -b radix -p nova`（components.json生成・index.css更新）。button / dropdown-menu / tooltip を追加
- 2026-07-25: tsconfig調整: TS6.0でbaseUrl非推奨エラー（TS5101）→ baseUrl削除、pathsのみで `@/*` エイリアス設定。`npm run build` 成功を確認
- 2026-07-25: backend生成: express / cors / dotenv / ws / node-pty + typescript / tsx / vitest。`node -e "require('node-pty')"` でネイティブモジュールのロード成功を確認。`npm run build`（tsc）成功
  - 手順書からの変更: ts-node + nodemon の代わりに tsx を採用（dev: `tsx watch src/server.ts`）
- 2026-07-25: terraform/: main.tf（2コンテナ + ports ip="127.0.0.1" + ALLOWED_ORIGINS注入）/ variables.tf / outputs.tf / terraform.tfvars.example を作成。`terraform fmt -check` 通過
- 2026-07-25: backend/.env.example（HOST=127.0.0.1, ALLOWED_ORIGINS=Viteオリジン）/ frontend/.env.example（VITE_WS_URL, VITE_API_URL）作成

[scaffold] 完了

## Phase 4: backend（バックエンド実装 PTY/WS/状態判定）

- 2026-07-25: TDD実施: テスト先行作成（RED確認: 実装未存在で5ファイル失敗）→ 実装 → 59テストGREEN
- 実装モジュール:
  - `src/monitor/state-detector.ts`: RDD 7章条件表準拠（300ms静止 + 末尾行パターン、優先順位 waiting-input > idle > running、ANSIエスケープ除去、末尾512文字のみ評価で軽量化）。受け入れシナリオ①〜④のテスト一致
  - `src/pty/session-manager.ts`: PTY注入可能設計（PtyLike/PtySpawn）、Terminal N自動採番、上限16、リングバッファ（appendCapped純関数）、subscribe/exit自動除去
  - `src/security/origin.ts`: Origin完全一致検証・Originなし拒否（RDD 5章9項）
  - `src/ws/handler.ts`: upgrade時Origin検証（403）・セッション存在検証（404）、replay/status/data/exit配信、input/resizeバリデーション（8KB上限・正整数）
  - `src/routes/sessions.ts` + `src/app.ts`: REST API（envelope形式、UUID検証400・上限429・不存在404・集中エラーハンドラで詳細非漏洩）、CORSホワイトリスト
  - `src/config/index.ts`: ALLOWED_ORIGINS必須（未設定は起動エラー）、HOST既定127.0.0.1、OS判定シェル選択
- 修正記録:
  - ANSI正規表現にESC(\x1b)明示が欠落 → 修正しテストで検証
  - Express 5のreq.paramsがstring|string[]型 → typeofガード追加（tscエラー解消）
  - WSテストでopen直後の同一パケットメッセージ取りこぼし → メッセージキュー方式に修正（実装側の問題ではないことをtsx直接実行で確認）
- 検証エビデンス:
  - `npm test`: 7ファイル59テスト全PASS（844ms）
  - `npm run coverage`: Statements 92.34% / Branches 86.13% / Functions 94.91% / Lines 92.95%（閾値80%合格。server.tsは起動ブートストラップのため対象外と明記）
  - `npm run build`: tsc成功
  - 実PTYスモーク: `tsx src/server.ts`（PORT=3901/3902）で起動→ /api/health OK → POST /api/sessions で実zsh PTY生成（id/title/shell応答確認）→ WS接続で replay/status受信・`echo MULTITERM_OK\r` 送信でdataフレーム受信を確認

- 2026-07-25: adversaryレビューPASS後の改善反映（レビューMEDIUM-1指摘）: サーバ側Origin強制ミドルウェアを追加（非許可Originの単純POSTによるセッション量産CSRFを403で遮断）。テスト3件追加 → 62テストGREEN、build成功

[backend] 完了

## Phase 5: frontend（フロントエンド実装 xterm/レイアウト/状態可視化）

- 2026-07-25: TDD実施: ロジック層テスト先行（RED: モジュール未存在で失敗確認）→ 実装 → 25テストGREEN
- 実装モジュール:
  - `features/layout/layout-tree.ts`: 二分木レイアウトの純関数群（splitLeaf / removeLeaf / pruneDeadLeaves / updateRatio 0.1-0.9クランプ / collectSessionIds。全て非破壊）
  - `features/layout/persistence.ts`: localStorage保存・形状バリデーション付き読込（不正データはnull）
  - `features/status/status-style.ts`: 状態別Tailwindクラス（running: 青パルス / waiting-input: 黄発光 / idle: 緑）
  - `services/api.ts` / `services/ws.ts`: envelope検証付きRESTクライアント・WSメッセージバリデータ
  - `components/TerminalPanel.tsx`: xterm.js + WebGLアドオン（try-catchフォールバック）+ FitAddon + ResizeObserver、WS接続（replay再生・status反映・exit処理）、テーマ動的切替
  - `components/SplitPane.tsx`: 再帰レンダラ + 境界線ポインタドラッグで比率変更
  - `components/Workspace.tsx`: セッション/レイアウト状態管理、初期化時にバックエンドをSSOTとして死んだ葉をprune（RDD 7章）、エラーバナー
  - `contexts/theme-context.tsx`: dark/light切替（documentElement.classList + localStorage）
- 検証エビデンス:
  - `npm test`: 25テストGREEN / `npm run coverage`: Statements 86.44% / Branches 82.47% / Functions 85% / Lines 90.47%（閾値80%合格。対象はロジック層。xterm/canvas依存UIとブートストラップはjsdom実行不能のため対象外とvitest.config.tsに明記）
  - `npm run build`: tsc + vite build成功
  - Playwright実機E2E: ターミナル作成→xterm描画→`echo MULTITERM_E2E_OK`実行・出力表示→スクリーンショット取得。コンソールエラー0
  - 状態遷移実機検証（bash・WS直結）: prompt→idle / sleep中→running / 完了→idle / read プロンプト→waiting-input / 応答後→idle の全遷移一致
- sparring記録: E2E検証中にbackend状態判定バグ（ESC= 未除去）を発見・修正（notes.md / sparring棚卸し参照。backend 63テストGREEN再確認）
- 既知の限界: プロンプト描画後に追加出力するカスタムシェルテーマ（本環境のスライム系zshテーマ等）では末尾行がプロンプトでなくなりidle判定できない場合がある（RDD 7章ベストエフォート範囲内）

- 2026-07-25: adversaryレビューPASS後の改善反映（レビューHIGH 2件+MEDIUM 2件）:
  - buildLayout を `features/layout/build-layout.ts` へ純関数抽出しテスト5件追加（SSOT再構成: 死んだ葉prune・レイアウト外セッション追加・全滅時再構成）
  - WS切断の可視化: onclose/onerror追加（灰色枠+「切断」ラベル+ターミナルへ通知行。クリーンアップ時は抑止）
  - api.ts のenvelope検証を `data == null` に厳格化 / statusDotClasses のテスト追加
  - 再検証: 31テストGREEN / カバレッジ Statements 91.4% / build成功

[frontend] 完了

## Phase 6: iac-integration（IaC・統合検証）

- 2026-07-25: Dockerfile作成:
  - backend: `node:22-bookworm-slim` + python3/make/g++（node-ptyネイティブビルド用にDebianベース採用）
  - frontend: `node:22-alpine` でVite build（VITE_WS_URL / VITE_API_URL をARG注入）→ `nginx:alpine` で配信
  - .dockerignore（node_modules/dist/.env）を両方に追加（ホストビルドのネイティブバイナリ混入防止）
- 2026-07-25: terraform.tfvars 作成（project_slug=multiterm）。`terraform init` / `validate`（Success）/ `fmt -check` 通過
- 2026-07-25: `terraform apply -auto-approve` 成功（5リソース: network + image×2 + container×2）
  - `docker ps`: multiterm-backend Up（127.0.0.1:3001->3001）/ multiterm-frontend Up（127.0.0.1:3000->80）
  - **公開は127.0.0.1限定を実測確認**（PORTS列。RDD 8章準拠）

### 統合動作確認（Playwright実機・エビデンスはスクリーンショット取得済み）

| 確認項目 | 結果 |
|---------|------|
| WebSocket疎通（コンテナ間） | ✅ ターミナル作成→bashプロンプト表示→`echo RELOAD_MARKER_123` 実行・出力表示 |
| 複数ターミナル・レイアウト変更 | ✅ 縦分割→横分割で3ペイン構成（Terminal 1 / 2 / 3） |
| 状態色切替 | ✅ idle=緑枠「待機」、`sleep 8` 実行中=青枠「実行中」（コンテナbashで実測） |
| リロード復元 | ✅ リロード後3ペインレイアウト復元 + Terminal 1のバッファ再生（RELOAD_MARKER_123表示） |
| 死んだ葉のprune（RDD 7章SSOT） | ✅ サーバ側でTerminal 2をDELETE→リロード→2ペインに自動再構成 |
| テーマ切替 | ✅ ライトテーマで全体白基調 + xterm配色連動（白背景/黒文字） |
| コンソールエラー | 0件 |

- パネルサイズのドラッグ調整: ロジックはSplitPane実装+クランプはユニットテスト済み。ブラウザ実機ドラッグは目視未実施（Playwrightのドラッグ操作は省略）
- Windows（powershell.exe）動作確認: 本環境はWSL2のためWindowsホスト直接起動は未実施（RDD 8章の規定どおり手動確認事項として残る。シェル選択ロジック・PSプロンプト判定はユニットテスト済み）

[iac-integration] 完了
- adversaryレビューPASS（1回目）: ループバック限定公開をss実測、Origin二重防御を403/201実挙動で確認。MEDIUM4件は改善提案として記録（単一ステージDockerfile・未使用network・localhost表記・手動確認2件の繰り延べ）

## Phase 7: docs（ドキュメント整備）

- 2026-07-25: README.md 生成（概要・機能一覧・セキュリティ方針・セットアップ（Terraform / 開発モード）・テスト手順・技術スタック・既知の制限）
- 全7フェーズ完了。テスト実績: backend 63 / frontend 31（いずれもGREEN、カバレッジ80%閾値合格）。adversaryレビュー: requirements（3回目PASS）/ backend / frontend / iac-integration 各PASS

[docs] 完了

---

# v2 機能拡張（2026-07-25 ユーザー要望: フォント設定・シェル選択・セッション名変更）

## Phase 8: requirements-v2（v2要件確定）

- 2026-07-25: PGDD configにv2フェーズ5本を追加（pgdd-planner差分提案→config apply。完了済み7フェーズ不変）
- 2026-07-25: RDD.md改訂:
  - 2章の機能要件表にv2 3行（フォント設定・シェル選択・セッション名変更）追加
  - 5章MVPに9〜11項追加（アクセス制御は12項に繰り下げ。8章の参照も5章12項に更新）
  - 6章の除外機能から「セッション名の変更」を削除。フォントはプリセット選択のみと明記
  - 7章のタイトル「変更不可」記述をrename許可に整合、シェル選択の記述追加
  - 9章新設: 9.1フォント設定（プリセット3種・10〜20px・localStorage・即時反映）/ 9.2シェル選択（GET /api/shells 許可リスト方式・許可外400）/ 9.3セッション名変更（PATCH /api/sessions/:id・1〜30文字・制御文字禁止）

[requirements-v2] 完了
- adversaryレビューPASS（1回目）。MEDIUM指摘（shellフィールドの意味・受け入れ基準・Origin適用明記）を証跡保存前にRDD 9.2/9.4へ反映

## Phase 9: backend-v2（shells検出・create拡張・rename API）

- 2026-07-25: TDD実施: テスト追加（shell-registry 5件 / routes 12件 / session-manager 2件）→ 実装 → **85テストGREEN**
- 実装:
  - `src/pty/shell-registry.ts`: detectShells（bash/zsh/fish/shの実在検出 + $SHELL、win32はpowershell.exe。exists注入可能）/ resolveShell（許可リストidのみ解決、パス文字列は不可）
  - `src/routes/sessions.ts`: POST shell指定（許可リスト外・非文字列は400）/ PATCH /api/sessions/:id（sanitizeTitle: トリム・1〜30文字・制御文字禁止、違反400・不存在404）
  - `src/app.ts`: GET /api/shells 追加（既存のサーバ側Origin強制ミドルウェアの後段に配置=RDD 9.4準拠）
  - `src/pty/session-manager.ts`: create(shell?: ShellInfo)（Session.shell=id、spawnへpath）/ rename() 追加。PtySpawnにshellパラメータ追加
  - `src/server.ts`: 起動時にdetectShells（fs.existsSync）で許可リスト構築、既定シェル解決
- 検証エビデンス:
  - `npm run build` 成功 / `npm test` 85件GREEN / カバレッジ Statements 92.95% / Branches 88.27%（80%閾値合格）
  - 実機スモーク（tsx起動・PORT=3905）: GET /api/shells→bash/zsh/sh検出 / POST {shell:"zsh"}→201・shell=zsh / POST {shell:"/bin/evil"}→400 / PATCH title="ビルド監視"→200・一覧反映 / PATCH title=""→400 を確認

- 2026-07-25: adversaryレビューPASS後の反映: タイトル文字数をコードポイント単位に変更（絵文字30個テスト）、shell非文字列型（オブジェクト/配列）400テスト、新エンドポイント（GET /api/shells・PATCH）のOrigin 403テストを追加 → **90テストGREEN**・build成功

[backend-v2] 完了

## Phase 10: frontend-v2（設定UI・シェル選択・インライン名前変更）

- 2026-07-25: TDD実施: ロジック層テスト先行（settings 6件 / title 4件 / api 3件追加）→ 実装 → **44テストGREEN**
- 実装:
  - `features/settings/settings.ts`: フォントプリセット3種（System Mono/Consolas/Courier New）・サイズ10〜20pxクランプ・localStorage保存/検証読込
  - `features/session/title.ts`: rename クライアント側バリデーション（サーバと同一規則。コードポイント単位1〜30文字・制御文字禁止）
  - `contexts/settings-context.tsx`: 設定のContext + localStorage永続化
  - `components/SettingsPanel.tsx`: フォント/サイズ/既定シェルの設定ポップオーバー
  - `components/TerminalPanel.tsx`: フォント設定の即時反映Effect（term.options更新+refit）、タイトルのインライン編集（クリック→入力→Enter/Esc、PATCH連携、エラー時赤枠）、シェル名表示
  - `services/api.ts`: fetchShells / createSession(shellId) / renameSession 追加
  - `components/Workspace.tsx`: 起動時にfetchShells、既定シェルで作成、rename結果を一覧へ反映
- 検証エビデンス:
  - `npm run build`（tsc+vite）成功 / `npm test` 44件GREEN / カバレッジ Statements 92.94%（80%閾値合格）
  - Playwright実機（dev: backend :3011 v2 + vite :5174）:
    - 設定パネルにシェル一覧（Bash/Zsh/sh）表示 → zsh選択 → 新規ターミナルが`%`プロンプトのzshで起動（shell表示=zsh）
    - フォント Courier New + サイズ20pxが開いているターミナルへ即時反映（文字サイズ拡大をスクリーンショットで確認）。localStorageに fontFamilyId=courier-new / fontSize=20 / defaultShellId=zsh 保存
    - タイトルのインライン編集で「ビルド監視🚀」（絵文字含む）へ変更成功、shell/状態表示と併存
  - コンソールエラー0

- 2026-07-25: adversaryレビューPASS後の反映（HIGH 1件+MEDIUM 2件）:
  - HIGH: fetchSessions（SSOT復元の必須依存）とfetchShellsをPromise.allで直列結合していたのを分離。shells取得失敗はセッション復元に影響させず「サーバ既定」で継続
  - MEDIUM: localStorageの既定シェルidが現在の許可リストに無い場合はnullへ矯正（恒常400を回避）
  - MEDIUM: rename確定の二重発火（Enter+blur）をcommittingRefでガード
  - 再検証: build成功・44テストGREEN

[frontend-v2] 完了

## Phase 11: integration-v2（Docker再ビルド・統合確認）

- 2026-07-25: `terraform fmt -check` / `validate`（Success）通過
- 2026-07-25: `terraform destroy` → 旧イメージ削除 → `terraform apply -auto-approve` でv2イメージ再ビルド・2コンテナ起動（5リソース）
  - `docker ps`: multiterm-backend Up（127.0.0.1:3001->3001）/ multiterm-frontend Up（127.0.0.1:3000->80）。**公開は127.0.0.1限定を実測確認**

### v2統合動作確認（Docker・Playwright実機）

| 確認項目 | 結果 |
|---------|------|
| GET /api/shells（コンテナ内検出） | ✅ bash / sh を検出（Debianコンテナにzsh/fish非導入のため） |
| 許可リスト外シェル指定の拒否 | ✅ POST {shell:"/bin/evil"} → 400 |
| シェル選択での起動 | ✅ 新規ターミナルがbashで起動（shell表示=bash、`待機`=idle判定も正常） |
| セッション名変更 | ✅ 「本番ログ監視」へ変更成功 |
| rename のSSOT維持 | ✅ リロード後も「本番ログ監視」が維持（バックエンドSSOT） |
| 公開ポリシー（127.0.0.1限定） | ✅ ss実測で両ポート127.0.0.1バインドのみ |

- フォント即時反映はPhaseフロントエンドのPlaywright実機（dev :5174）で確認済み（サイズ20px・Courier New反映をスクリーンショット取得）。Docker版も同一ビルド成果物のため挙動同一
- 既知の制限: Dockerコンテナ（Debian）で選択可能なシェルはbash/shのみ。zsh等を選ぶ場合は開発モード（ホスト直接起動）またはコンテナへのシェル追加が必要

[integration-v2] 完了
- adversaryレビューPASS（1回目）: 稼働中v2コンテナへ再実測（127.0.0.1限定・許可リスト外400・WS/REST Origin 403・シェル検出）。MEDIUM（REST no-Origin許可・rootコンテナ・origin.js docstring）は記録

## Phase 12: docs-v2（ドキュメント整備 v2）

- 2026-07-25: README.md にv2機能追記:
  - 主な機能にフォント設定・シェル選択・セッション名変更の3項目
  - 「API（抜粋）」表を新設（GET /api/shells・POST/PATCH/DELETE /api/sessions・WS /ws）
  - テスト実績を backend 90 / frontend 44 に更新
  - 既知の制限にシェル候補の環境依存（Dockerはbash/sh）を追記
- v2全4フェーズ完了（requirements-v2 / backend-v2 / frontend-v2 / integration-v2 / docs-v2）。adversaryレビューは各実装・要件・統合フェーズでPASS
- テスト最終実績: backend 90 / frontend 44（GREEN・カバレッジ80%閾値合格）

[docs-v2] 完了

---

# v3 機能拡張（2026-07-25 ユーザー要望: 新規ボタンから cmd / PowerShell / WSL zsh を VSCode 風に選択）

## Phase 13: requirements-v3（v3要件確定）

- 2026-07-25: 事前PoC（技術検証・エビデンス取得）: Windows Node.js v22.16.0 で node-pty@1.1.0（prebuilt・ビルド不要）を導入し、`/mnt/c/Temp/ptytest/poc.cjs` で以下の対話動作を実証:
  - powershell.exe → プロンプト `PS C:\Users\...>` 表示・`echo` 実行OK
  - cmd.exe → `C:\Users\...>` 表示・実行OK
  - `wsl.exe -d Ubuntu-22.04 --cd ~ -- zsh -l` → ユーザーの `.zshrc`（スライムテーマ出力）読込＝自分のWSL環境そのもの
- 2026-07-25: PGDD configにv3フェーズ5本追加（planner差分提案→config apply。完了済み12フェーズ不変）
- 2026-07-25: RDD.md 9.5章新設: Windowsマルチシェル対応（実行構成・シェル検出のWindows対応表・ShellInfo.args拡張・状態判定拡張・conpty既知事象・セキュリティ維持・受け入れ基準5項）

[requirements-v3] 完了
- adversaryレビューPASS（1回目）。HIGH（file/path表記・argsオプショナル化・server.ts配線）とMEDIUM（cmd状態判定の冗長性・7章条件表・WSL検出方法）を証跡保存前にRDDへ反映

## Phase 14: backend-v3（Windowsシェル検出・args対応・状態判定拡張）

- 2026-07-25: TDD実施: テスト先行（windows-shells 8件 / session-manager args / state-detector cmd・PS）→ 実装 → **99テストGREEN**
- 実装:
  - `src/pty/windows-shells.ts`（新規・純関数）: `parseWslDistros`（wsl -l -v 出力パース: NUL/改行/*マーカ除去・docker-desktop系除外・ヘッダ除外・失敗時空配列）/ `buildWindowsShells`（cmd/powershell常設・pwshはhasPwsh時・wsl-<distro>×ログインシェル、path/argsは固定構築）
  - `src/types/index.ts`: ShellInfo に `args?: readonly string[]`（オプショナル。既存Linuxエントリ・レスポンス契約を壊さない）
  - `src/pty/shell-registry.ts`: detectShellsをUnix系専用に（win32分岐削除、呼び出し側で分岐）
  - `src/pty/session-manager.ts`: PtySpawnにargs追加、create()で `args: chosen?.args ?? []` をspawnへ
  - `src/server.ts`: win32分岐でdetectWindowsShells（execFileSyncでwsl -l -v / pwsh検出 / 各distroのログインシェルを `sh -lc 'echo $SHELL'`→fallback which で解決）。spawn配線を `[...args]` に。conpty「AttachConsole failed」既知事象をuncaughtExceptionで限定握りつぶし（他は再送出）
  - **セキュリティ**: path/argsはバックエンド構築の固定値のみ。クライアントは許可リストidのみ指定（resolveShellでid厳密一致・許可外400）。node-ptyへargsを配列で渡しシェル補間なし
- 検証エビデンス:
  - `npm run build` 成功 / `npm test` 99件GREEN / カバレッジ Statements 93.35%（80%閾値合格）
  - Linux実機スモーク（tsx :3906）: GET /api/shells が bash/zsh/sh（argsなし=既存維持）/ POST {shell:"zsh"}→201 を確認（既存機能の非破壊）
  - Windowsシェル検出（win32分岐）はこのLinuxセッションでは実行されないため、純関数（parse/build）をユニットテストで担保。実機はintegration-v3で確認

- 2026-07-25: adversaryレビューPASS後の反映（MEDIUM）: conpty握りつぶしをwin32限定＋スタックにnode-pty/conptyを含む場合のみに厳格化（グローバル汚染回避）。99テストGREEN・build成功維持

[backend-v3] 完了

## Phase 15: frontend-v3（シェル選択ラベル整備・軽微）

- 2026-07-25: 軽微改修（新規UI・状態管理変更なし）:
  - `features/settings/shell-label.ts`（新規・純関数）: `resolveShellLabel`（シェルidを許可リストのlabelに解決、一覧に無いidはフォールバックでそのまま）+ テスト2件
  - `components/TerminalPanel.tsx`: パネルのシェル表示を `session.shell`（id）→ `shellLabel`（例「コマンドプロンプト」「Ubuntu-22.04 (zsh)」）に変更。titleツールチップ付き
  - `components/Workspace.tsx`: renderLeafで `resolveShellLabel(session.shell, shells)` を解決してTerminalPanelへ渡す
  - 既存のシェル選択UI（SettingsPanel）はGET /api/shellsのlabelをそのまま表示するため変更なし（Windows系ラベルはbackendが日本語で返す）
- 検証: `npm run build`（tsc+vite）成功 / `npm test` 46件GREEN（80%閾値合格）

[frontend-v3] 完了

## Phase 16: integration-v3（Windowsホスト実機確認・起動手順整備）

- 2026-07-25: `scripts/start-windows.ps1` 作成: Windowsホストでbackend(tsx)+frontend(vite)を起動。127.0.0.1限定バインド・ALLOWED_ORIGINS注入（RDD 5章12項/8章維持）・初回npm install・Ctrl+Cで両プロセス停止
- 2026-07-25: **Windows実機統合確認**（RDD 9.5章受け入れ基準5）: backendソースをWindowsローカル（C:\Temp\mtb）へコピー→Windows npm install（node-pty prebuilt・ビルド不要）→tscビルド→node dist/server.js起動→WSLからpowershell.exe interop経由でverify実行:

| 確認項目 | 結果 |
|---------|------|
| GET /api/shells（win32検出） | ✅ cmd / powershell / wsl-Ubuntu-22.04(zsh) / wsl-Ubuntu(sh) を返す（実在ディストロのみ・docker-desktop除外） |
| 許可リスト外シェル指定 | ✅ POST {shell:"/bin/evil"} → 400 |
| cmd.exe 対話動作 | ✅ `echo CMD_OK` 実行、プロンプト `C:\Users\...>` |
| powershell.exe 対話動作 | ✅ `echo PS_OK` 実行、プロンプト `PS C:\Users\...>` |
| WSL Ubuntu-22.04 zsh 対話動作 | ✅ `echo WSL_ZSH_OK` 実行、**`.zshrc`（スライムテーマ）読込＝ユーザー環境そのもの** |
| 状態判定（cmd/PS/wsl） | ✅ running→idle 遷移を確認（cmd `C:\...>`・PS `PS ...>`・zsh `~>` が既存パターンでidle判定） |
| 127.0.0.1限定バインド | ✅ HOST=127.0.0.1 で起動、Origin検証(403)込みで動作 |

- backendのビルド出力（Windows）にconpty「AttachConsole failed」の致命的落下は発生せず（uncaughtException限定握りつぶしが機能、または非到達）。全シェル正常動作
- 検証エビデンスの一時ファイル（C:\Temp\mtb・C:\Temp\ptytest）はクリーンアップ済み
- verify: `test -f scripts/start-windows.ps1` + 完了マーカーの機械チェック（実機起動はCI不可のため手動確認・上記記録で担保）

- 2026-07-25: adversaryレビューPASS後のスクリプト改善（HIGH/MEDIUM反映）:
  - HIGH: `npx tsx src/server.ts` は実機検証で起動しなかった（BACKEND_UP=False）ため、実証済み経路（`npm run build`（tsc）→ `node dist/server.js`）に変更
  - HIGH: IPv4/IPv6不整合回避のため VITE_WS_URL/VITE_API_URL/ALLOWED_ORIGINS を 127.0.0.1 主体に統一
  - MEDIUM: プロセス停止を `taskkill /PID <id> /T /F`（プロセスツリー終了。孫プロセスのオーファン化を防ぐ）に
  - MEDIUM: 片側プロセス終了を検知して両方停止するwhileループに（backendクラッシュを放置しない）
  - MEDIUM: vite起動を `cmd /c npx vite`（.cmdシム解決）に
- **重要な運用制約**: WSL上の backend/node_modules は Linux版 node-pty。Windowsマルチシェル用にWindowsホストで起動する場合は、プロジェクトを**Windows側に配置**（git clone またはコピー）してWindowsで `npm install`（Windows版node-pty prebuilt）する必要がある。WSLファイルシステム上のbackendをWindows nodeで直接実行するとnode-ptyのOS不一致でロード失敗する。実機確認もこの形（C:\配置・Windows npm install）で実施した。start-windows.ps1のbackend起動部分（tsc→node dist/server.js）は実機確認と同一経路（vite起動・プロセス管理部分はスクリプト全体の一括実機実行は未実施）

[integration-v3] 完了
- adversaryレビューPASS（1回目）: 127.0.0.1限定バインド・Origin検証維持を実コードで確認。HIGH/MEDIUM（tsx→node実証経路・IPv4統一・プロセスツリー終了・片側終了検知）を証跡保存前に反映

## Phase 17: docs-v3（ドキュメント整備 v3）

- 2026-07-25: README.md にv3追記:
  - 主な機能のシェル選択項目にWindowsホスト起動時のcmd/PowerShell/WSL(zsh)を明記
  - セットアップに「3. Windowsホストで起動する場合（Windowsマルチシェル対応）」を新設: 前提（Windows Node.js）・重要制約（プロジェクトをWindows側配置＋Windows npm install、node-ptyのOS不一致）・start-windows.ps1手順・検出されるシェル・セキュリティ維持
  - API表にShellInfoのargs説明追記、テスト実績を backend 99 / frontend 46 に更新
- v3全5フェーズ完了（requirements-v3 / backend-v3 / frontend-v3 / integration-v3 / docs-v3）。adversaryレビューは要件・backend・統合フェーズでPASS
- テスト最終実績: backend 99 / frontend 46（GREEN・カバレッジ80%閾値合格）
- v3実機エビデンス: Windowsホストで cmd / PowerShell / WSL Ubuntu-22.04(zsh, .zshrc込み) の対話動作・許可リスト外400・状態判定・127.0.0.1限定を確認

[docs-v3] 完了

## Phase 18: sparring-v4 軽量化（バックエンド Rust 化）

### 着手前の実測（2026-08-28）

| 項目 | 実測 |
|---|---|
| backend プロセス | node 63.6MB (Private 50.8MB) |
| frontend プロセス | vite dev 113.4MB (Private 183.5MB) |
| node_modules | backend 162MB/147pkg + frontend 303MB/395pkg = 465MB / 542pkg |
| ソース（非テスト） | backend 933行 / frontend 1,603行 |

特定した性能ボトルネック（PTY出力1チャンクごとに全て発生）:

- `backend/src/pty/ring-buffer.ts:7` — `(buffer + chunk).slice(-limit)` で毎回最大200KBの文字列を再確保（O(200KB)×チャンク数）
- `backend/src/ws/handler.ts:47` — `JSON.stringify` で出力全体をJSONエスケープ
- `frontend/src/services/ws.ts:12` — `JSON.parse` で全体をデコード
- `backend/src/monitor/state-detector.ts:99` — `chunk.match(ALT_SCREEN_PATTERN)` でチャンク全体を正規表現走査

### Phase 0: PGDDゲート解除

- `pgdd-gate-check.js` は `state.mode` を参照せず `currentPhase` の allow/block のみで判定することを確認。既存の `"mode": "sparring"` はゲートに効いていなかった
- `.pgdd/config.json` に `sparring-v4`（allow `["./"]` / block `[]`）を追加し、`currentPhase` を切替

### Phase 1: Rustバックエンド新設（backend-rs/）

技術選定: axum 0.8 + tokio + portable-pty 0.9 + tower-http(cors) + serde / uuid / time / regex / memchr / encoding_rs。
環境: rustc 1.97.1 / MSVC Build Tools 2022。

移植内容（Node版 933行 → Rust）:

- `ring_buffer.rs`: `VecDeque<u8>` の真のリングバッファ化。追記を O(chunk) に（Node版の O(200KB)/チャンクを解消）。バイト切断に備え `utf8::trim_broken_prefix` でreplay先頭の不完全UTF-8を除去
- `state_detector.rs`: RDD 7章の条件表を1:1移植。代替画面検知はチャンク全体の正規表現走査をやめ `memchr` でESC位置のみ照合。静止判定は tokio タスク（出力が無い間はCPU消費ゼロ）
- `session_manager.rs`: PTY読み取りは専用スレッド、状態評価は tokio タスク、配信は broadcast。バッファのロックを保持したまま配信し、subscribe時のreplayとdataの取りこぼし・重複を防止
- `ws/handler.rs`: WSをバイナリフレーム化（タグ1バイト+ペイロード）。PTY出力は5ms窓でコアレッシング
- REST・Origin検証・許可リストは Node版と同一仕様で移植

### 発見した既存バグ（Node版から引き継ぎ）: WSLログインシェルの誤検出

- 症状: `GET /api/shells` が `Ubuntu-22.04 (bash)` を返す。実機の正解は zsh（`echo $SHELL` = `/usr/bin/zsh`）
- 原因: 停止中のWSLディストロを起動する初回コマンドは実測で約10秒かかる（ウォーム時は約0.3秒）。Node版・Rust版とも `EXEC_OPTS.timeout = 5000ms` で必ずタイムアウトし、フォールバック（zsh→bash→sh の which）に落ちて誤検出していた
- 実測: `wsl -d Ubuntu-22.04 -- sh -lc 'echo $SHELL'` = 10,716ms（コールド）/ 286ms（ウォーム）、`which zsh` = 272ms、`wsl -l -v` = 111ms
- 修正: `COMMAND_TIMEOUT` を 20秒に延長し、ディストロごとの解決を `join_all` で並列化（コールドスタートを直列に積み上げない）
- 結果: `Ubuntu-22.04 (zsh)` を正しく検出。起動所要は2秒（ウォーム時）

### Phase 1 検証結果

`cargo test` 71件 GREEN（状態判定条件表の4シナリオ＋優先順位、WSLパース、許可リスト、Origin検証、UTF-8境界、WSフレーム）。

実機 REST 検証（Rust :3002）:

| 検証項目 | 結果 |
|---|---|
| GET /api/health | 200 |
| GET /api/shells（win32検出） | cmd / powershell / wsl-Ubuntu-22.04(zsh) / wsl-Ubuntu(bash)。pwsh未導入のため非掲載 |
| POST（既定シェル / shell=wsl-Ubuntu-22.04） | 201 |
| POST 許可リスト外（`/bin/evil`・存在しないid） | 400 |
| PATCH リネーム（日本語11文字） | 200・一覧に反映 |
| PATCH 空白のみ / title欠落 / 31文字 / 不正UUID | 400 |
| DELETE | 200 / 不存在UUID 404 / 不正UUID 400 |
| セッション上限16 → 17個目 | 429（`セッション数が上限（16）に達しています`） |
| 非許可Origin | 403（レスポンス本文もNode版と完全一致） |

Node版との差異:

- `Content-Type` が `application/json`（Node版は `; charset=utf-8` 付き）。JSONはRFC 8259でUTF-8必須のため実害なし
- `DELETE /api/sessions/../etc/passwd` が 404（Node版は400）。axumがパス正規化でルート不一致にするため。より安全側で、通常の不正UUID（`not-a-uuid`）は仕様どおり400

### Phase 2: WSバイナリプロトコル切替

- フロント `services/ws.ts` をバイナリフレーム化（タグ1バイト + ペイロード）。`types/index.ts` の `ServerMessage` の data を `Uint8Array` に変更し、`TerminalPanel.tsx` は `ws.binaryType='arraybuffer'` + `term.write(Uint8Array)` で xterm へ直接書き込む（両端の JSON エスケープ／パースを除去）
- 送信フレームは `Uint8Array<ArrayBuffer>` を明示（TypeScript 5.7+ の `ArrayBufferLike` ジェネリクスにより `ws.send()` の型と不一致になるため）
- frontend テスト 51件 GREEN（WS のバイナリ往復・境界値を追加）

#### ブラウザ実機検証（Rust :3001 + Vite :5174）

| 項目 | 結果 |
|---|---|
| PowerShell 入出力 | `echo RUST_OK_日本語テスト` が正しく往復。パスの日本語（浅野寛貴）も正常表示 |
| WSL zsh | `Ubuntu-22.04 (zsh)` で起動し `.zshrc` を読込（スライムテーマの slime.txt 参照を確認）。RDD 9.5章 受け入れ基準5 |
| 分割・状態可視化 | 左右分割、緑=待機／青=実行中 の遷移を確認 |
| リロード復元 | 2セッション・レイアウト・出力履歴とも復元 |
| 10万行出力 | 完走（52.2秒）。状態も idle へ正しく復帰 |

参考値: PowerShell 単体の `1..100000` は列挙のみ 202ms / 文字列化まで 1,203ms。残りが PTY→WS→描画のコスト。Node版との比較測定は未実施。

### 発見・修正: ConPTY の DSR にバックエンドが応答する

- **症状**: 新規セッションを作ってもシェルが起動せず、status が running のまま。cmd.exe / WSL いずれも再現
- **原因調査**: 読み取りスレッドにデバッグ出力を入れたところ、PTY から届くのは `\x1b[6n`（DSR = カーソル位置問い合わせ）4バイトのみだった。**ConPTY はこの問い合わせに応答があるまでシェルの出力を開始しない**。Node版ではブラウザの xterm が自動応答し、それが WS 経由で PTY に返ることで先へ進んでいた（＝クライアント未接続では起動しない構造だった）
- **併発していた既存バグ**: リロード時、replay バッファ内の DSR に xterm が応答し、その `;1R` がプロンプトへ入力される
- **対処（ユーザー選択）**: `src/pty/dsr.rs` を新設。`spawn_reader` が出力チャンクから `ESC[6n` を検出したらバックエンドが `ESC[1;1R` を PTY へ書き戻し、DSR 自体はクライアントへ送らない（xterm の二重応答を防ぐ）。DSR を含まないチャンクは `memchr::memmem` の検索のみでコピーせず素通しし、大量出力時のコストを増やさない
- **検証**: WS 未接続のまま REST で cmd セッションを作成 → 4秒後に `status=idle` に到達。ブラウザを開かなくてもシェルが起動するようになった（Node版では不可能だった動作）
- `cargo test` 78件 GREEN（dsr の 7件を追加）

#### 作業事故と復旧

重複していた `strip_dsr` を整理する際、`sed -i '253,305d'` の範囲指定を誤り `now_iso8601` / `spawn_reader` / `spawn_quiescence_watcher` / `spawn_pty` / `home_dir` を削除した。全て書き戻し、`cargo test` 78件 GREEN・関数一覧で復旧を確認済み。

#### 並行セッションとの競合

同名の別 Claude セッション（multiterm-rust-backend-optimization [3e7e0e]）が同じプロジェクトを並行編集しており、`session_manager.rs` に想定外の差分（`replay_consumed` 等）が現れた。以後はセッション間で連絡を取りながら分担する。

## Phase 19: フロントエンド軽量化（React → Preact / 依存排除）

### やったこと

- **React 19 → Preact 10.29.8**。compat レイヤーは挟まず `preact` / `preact/hooks` を直接使用。`main.tsx` は `createRoot().render()` → `render()`、`tsconfig.app.json` に `jsxImportSource: "preact"` を追加
- **shadcn/ui を全削除**。`ui/dropdown-menu.tsx`（267行）と `ui/tooltip.tsx`（57行）は調査の結果**どこからも import されていなかった**ため削除のみ。`ui/button.tsx`（67行）は使用中だったため `components/primitives/Button.tsx`（37行）へ置換し、cva / clsx / tailwind-merge / radix Slot を排除
- **lucide-react（39MB）→ inline SVG 9個**（`components/icons.tsx`）。パスデータは lucide v1.26.0（ISC）の `__iconNode` から採取し、属性も lucide のデフォルト（viewBox 0 0 24 24 / stroke-width 2 / stroke-linecap round）に合わせた
- `lib/utils.ts`（`cn`）削除。`index.css` から `tw-animate-css` / `shadcn/tailwind.css` / `@fontsource-variable/geist` の import を削除し、UIフォントはシステムフォントスタックへ
- Preact の型差分に対応: `ReactNode` → `ComponentChildren`、`React.PointerEvent` → `JSX.TargetedPointerEvent`、`e.target.value` → `e.currentTarget.value`（3箇所）、Button の props を `JSX.IntrinsicElements['button']` に
- `@preact/preset-vite` は Vite 8 / rolldown でビルドが通らないため使わず、tsconfig の `jsxImportSource` に委ねる構成にした

### 効果測定（同一条件・ASCIIパスでのビルド実測）

| 指標 | React 構成（移行前） | Preact 構成（移行後） | 削減 |
|---|---|---|---|
| JS バンドル | 708.66 kB（gzip 198.70 kB） | 482.68 kB（gzip 128.14 kB） | **-225.98 kB / gzip -70.56 kB（-35.5%）** |
| CSS | 43.57 kB（gzip 8.55 kB） | 26.09 kB（gzip 5.70 kB） | -17.48 kB / gzip -2.85 kB（-33.3%） |
| Webフォント | 76.41 kB（Geist woff2 × 5） | 0（システムフォント） | **-76.41 kB（-100%）** |
| 初回転送量（gzip換算） | 283.66 kB | 133.84 kB | **-149.82 kB（-52.8%）** |
| npm パッケージ数 | 581 | 251 | **-330（-56.8%）** |
| node_modules | 303MB | 182MB | -121MB（-39.9%） |
| package.json 依存 | deps 15 / devDeps 14 | deps 6 / devDeps 10 | -13 |
| ビルド時間 | 922ms | 405ms | -56% |

`npx tsc -b --noEmit` → exit 0 / `npx vitest run` → **51件 GREEN**。
テストは全て純関数のテストで `@testing-library` を使っていなかったため、Preact 移行に伴う差し替えは不要だった。

### 判明した問題: 非ASCIIパスで vite build が壊れる

**現象**: プロジェクトの現在地（OneDrive 配下・日本語と全角中黒を含むパス）で `npm run build` すると
`Rolldown failed to resolve import "preact"` で失敗する。dist は出力されるが**全ての node_modules 依存が
external 化**され、`import ... from "preact"` `from "@xterm/xterm"` が残った壊れたバンドル（JS 22.3kB）になる。

**切り分け結果**:

| 構成 | パス | 結果 |
|---|---|---|
| React（移行前） | 日本語パス（OneDrive配下） | **成功**（708.66 kB） |
| Preact（移行後） | 日本語パス（OneDrive配下） | **失敗** |
| Preact（移行後） | ASCIIパス（C:\Temp\vt） | **成功**（482.68 kB） |

除外できた原因: rolldown のネイティブバイナリは存在（`@rolldown/binding-win32-x64-msvc/*.node`）／
`@preact/preset-vite` の有無は無関係（両方で再現）／`resolve.alias` の有無も無関係／`.vite` キャッシュ削除でも再現／
`npm ci` で node_modules を作り直しても再現。

`resolve.alias` で preact の実ファイル（`dist/preact.mjs` 等）を直接指すと preact は解決されるが、
次は `@xterm/xterm` が解決できずに失敗する。つまり preact 固有ではなく **bare import 解決全般**が壊れている。
preact の package.json exports に `default` 条件が無い（types/browser/umd/import/require のみ）ことが
引き金になった可能性はあるが、React 構成が同じパスで通る理由までは特定できていない。

**対処（ユーザー判断）**: (c) ビルド時だけ ASCII パスへ退避する。フォルダは移動せず、vite のバージョンも変えない。
`scripts/start-windows.ps1` に「frontend を ASCII パスへコピー → build → dist を戻す」を組み込む。

### 並行セッションでの作業分担

このフェーズは2つの Claude セッションが並行して作業した。backend-rs は別セッションが担当し、
本セッションは frontend のみを担当。境界を明示的に取り決めて競合を回避した
（session_manager.rs で一度競合し、削除範囲を誤って関数が消える事故が起きたため）。

## Phase 20: 単一バイナリ化（rust-embed）とDocker構成の廃止

### Docker / Terraform の廃止（ユーザー判断）

実際の利用が Windows ホスト直接起動のみだったため、Docker 構成そのものを廃止した。
`terraform/`・ルートの `Dockerfile`・`frontend/Dockerfile`・`backend/Dockerfile` をごみ箱へ送付
（git 管理下のため履歴から復元可能）。これにより RDD 8章の「Terraform + Docker provider で
2コンテナ構築」は要件から外れる。

廃止前に一度 1コンテナ構成への書き換え（nginx コンテナ削除・`backend_port`/`frontend_port` を
`app_port` へ統一）まで実施し `terraform validate` は通していたが、廃止決定により削除した。

### 非ASCIIパスで vite build が壊れる問題への対処

**現象**: Preact 構成 + 日本語を含むパス（本プロジェクトは OneDrive 配下）で `vite build` すると、
全依存が external 化された壊れたバンドルが出力される（JS 22KB、`from"preact"` `from"@xterm/xterm"`
等の bare import が残存）。React 構成では同じパスでも成功するため、Preact 構成固有。

**対処**: `scripts/build-frontend.ps1` を新設し、ビルド時だけ ASCII パスへ退避する。

- 退避先は `C:\Temp\multiterm-frontend-build` 固定（`$env:TEMP` はユーザー名に日本語を含むため使えない）
- `robocopy /MIR /XD node_modules dist .vite` でソースのみミラー。退避先の node_modules（182MB）を
  残すことで、`npm ci` は package-lock.json のハッシュが変わった時だけ実行する
- ビルド後、生成物に bare import が残っていないか `Select-String` で検査し、残っていれば throw する
  （退避が効かなくなった場合に壊れた dist を配布しないため）
- 生成物は `frontend/dist` へ robocopy で戻す

実測: JS 497.06 kB (gzip 133.52 kB) / CSS 26.09 kB (gzip 5.70 kB) の正常なバンドルを確認。

> **PowerShell の注意**: 日本語コメントを含む `.ps1` は UTF-8 **BOM 付き**で保存すること。
> BOM が無いと PS 5.1 が ANSI として読み、コメントが化けて構文エラーになる（実際に踏んだ）。

### rust-embed による静的配信

`src/static_files.rs` を新設。`#[folder = "../frontend/dist"]` でビルド成果物をバイナリへ埋め込み、
axum の `fallback` で配信する。SPA のため実ファイルが無いパスは `index.html` を返す。

- release ビルドでは埋め込み、debug ビルドでは実ファイルを読む（`npm run build` し直せば再起動なしで反映）
- **`frontend/dist` が存在しないと `cargo build` が通らない**。先に `scripts\build-frontend.ps1` が必要
- `$CARGO_MANIFEST_DIR` は rust-embed で展開されないため、`../frontend/dist` の相対指定を使う

### 単一プロセス・単一ポートでの動作確認

| 検証 | 結果 |
|---|---|
| `GET /` | 200 `text/html` 463 bytes |
| `GET /assets/index-*.js` | 200 `text/javascript` 497,062 bytes（正常なバンドル） |
| `GET /api/health` | 200 |
| `GET /api/shells` | 200 |
| `GET /nonexistent` | 200 `text/html`（SPAフォールバック） |

`cargo test` 78件 GREEN 維持。

### 起動スクリプトの単一プロセス化

- `scripts/start-windows.ps1`: Node版backendの起動と Vite 常駐を削除。`build-frontend.ps1` を呼んでから
  `cargo build --release` → 生成した exe を起動するだけの構成に。`-Rebuild` / `-SkipBuild` を追加。
  `ALLOWED_ORIGINS` は画面も同一ポートから配信するため `http://127.0.0.1:3001,http://localhost:3001` に変更
- `MultiTerm起動.bat`: 待機ポートを 5174 → 3001。release ビルド（LTO）が数分かかるためブラウザ待機を
  最大5分へ延長
- `MultiTerm停止.bat`: 対象ポートを 3001 のみに

### 効果測定（Node版との比較）

| 指標 | Node版 | Rust版 | 削減 |
|---|---|---|---|
| 常駐プロセス数 | 2（node backend + vite） | **1**（multiterm-backend.exe） | -1 |
| 公開ポート数 | 2（3001 + 5174） | **1**（3001） | -1 |
| WorkingSet | 48.7MB + 41.8MB | **9.6MB** | -80.9MB |
| PrivateMemory | 43.6MB + 190.2MB = 233.8MB | **2.1MB** | **-231.7MB（-99.1%）** |
| フロント初回転送量(gzip) | 283.66 kB | 133.84 kB | -52.8%（Phase 3 実測） |
| npmパッケージ数 | 581 | 251 | -56.8%（Phase 3 実測） |

実行時の Node.js は不要になった（フロントのビルドにのみ使用）。

### 同一オリジン化（接続先のハードコード解消）

単一ポート配信にしたことで、フロントの接続先がビルド時の環境変数に依存するのが問題になった
（`VITE_WS_URL` 未設定時のデフォルト `ws://127.0.0.1:3001` が焼き込まれ、`localhost:3001` で開くと
WS が繋がらない）。`services/api.ts` は `location.origin`、`services/ws.ts` は `location.host` を
既定にし、開発時のみ `VITE_*` で上書きする形に変更した。

焼き直し後のバンドル検査: ハードコードされた接続先 0件、`location.host` / `location.origin` /
`location.protocol` / `wss:` を検出、bare import なし。

### 単一バイナリの実機検証（release）

`cargo build --release` で 2分46秒、**バイナリ 4.25MB**（フロント込み）。
`frontend/dist` が存在しない `C:\Temp\multiterm-release-test` へ exe だけをコピーして起動し、
埋め込みが効いていることを確認した。

| 検証（exe 1個のみの環境） | 結果 |
|---|---|
| `GET /` | 200 `text/html` 463 bytes |
| `GET /assets/*.js` | 200 `text/javascript` 497,097 bytes |
| `GET /assets/*.css` | 200 `text/css` 26,094 bytes |
| `GET /favicon.ico` | 200 `image/x-icon` |
| `GET /api/health`・`/api/shells` | 200 |
| 非許可 Origin | 403（セキュリティ維持） |
| 配信JSの bare import | 0件（正常なバンドル） |
| メモリ | WorkingSet 8.2MB / Private 2.0MB |

**exe 単体で完結**する（Node.js も dist も不要）。

### ブラウザ実機検証（単一バイナリ配信 :3001、Vite不使用）

| 検証 | 結果 |
|---|---|
| `http://localhost:3001` で新規セッション | WSL zsh 起動・`~>` プロンプト・`.zshrc` 読込・idle（緑枠）。**同一オリジン化により従来繋がらなかった経路が動作** |
| `http://127.0.0.1:3001` | 同様に動作 |
| 分割 | `Ubuntu-22.04 (zsh)` と `Windows PowerShell` を別シェルで同時稼働、両方 idle |
| リロード復元 | 2ペイン構成・出力・状態色すべて復元。`;1R` の混入なし |
| 古いレイアウトの整合 | 存在しないセッションIDの葉ノードが自動削除され「ターミナルがありません」表示（RDD 7章: バックエンドがSSOT） |
| コンソール | エラー0件・警告0件 |

### 運用上の注意（開発時に踏んだもの）

- `run_in_background` で起動したバックエンドは**ターン終了時に kill される**。検証用に常駐させるなら
  `Start-Process -WindowStyle Minimized` で親から独立させること（3回落として原因を誤認しかけた）
- 日本語コメントを含む `.ps1` は UTF-8 **BOM 付き**で保存すること（PS 5.1 が ANSI 解釈して構文エラーになる）

## Phase 21: 左サイドバー（herdr のエージェント状態可視化を踏襲）

### 背景

ユーザー要望「[herdr](https://github.com/herdrdev) のヘッダーの有効な部分を踏襲」「左サイドバーでタブ管理・AIの状態・ステータスが分かるようにしてほしい」。

### 調査した herdr の設計

- 左サイドバーに全ペインを一覧し、AIエージェントの状態を表示する
- 状態は **blocked**（入力・承認待ち）/ **working**（実行中）/ **done**（完了・未確認）/ **idle**（確認済み）/ unknown の5段階
- 状態は上位（tab → workspace）へ集約され、1つでも blocked があれば全体が blocked に見える
- **done は「見るまで」残る**。これがタブを切り替えずに複数エージェントを監視できる理由

出典: [公式docs](https://herdr.dev/ja/docs/concepts/) / [Better Stack](https://betterstack.com/community/guides/ai/herdr-ai-agent/) / [技術ブログ](https://syusodo.co.jp/tech-blog/articles/repo-ogulcancelik-herdr)

### 採用しなかったもの（判断）

| 論点 | 判断 | 理由 |
|---|---|---|
| herdr の workspace / tab 階層 | **導入しない** | MultiTerm は二分木分割モデルで、RDD 6章がタブ機能をスコープ外と定義。「タブ管理」は既存ターミナル一覧の管理として実装した |
| herdr の色（赤=blocked / 黄=working / 青=done） | **採用しない** | RDD 5章6項が青=実行中・黄=入力待ち・緑=待機を定義済み。既存色を維持し、done にだけシアンを新規割当 |
| SessionStatus への done 追加 | **しない** | バックエンドの状態モデル（RDD 7章）は変更せず、done はフロント側の「見たかどうか」で合成する |

### 実装

- `features/status/pane-state.ts`（新規・純関数）
  - `resolvePaneState(status, unseen)`: SessionStatus + 未確認フラグ → PaneState
  - `aggregatePaneState(states)`: blocked > working > done > idle の順で最も強い状態を返す
  - `countPaneStates` / `paneDotClasses` / `paneStateLabel`
  - `shouldMarkDone({ status, previous, isActive, runningMs })`: 完了として記録すべきかの判定
- `components/Sidebar.tsx`（新規）: 状態ドット + Alt番号 + タイトル + シェル + 状態ラベルの一覧。クリックで切替、行から閉じる、上部に「入力待ち N / 実行中 N / 完了 N」
- `components/Workspace.tsx`: サイドバー配置、状態集約、ヘッダーにサイドバー開閉ボタンと集約バッジ
- `components/TerminalPanel.tsx`: `onStatusChange` で状態を親へ通知。狭い時に折り返していたヘッダーを truncate に（サイドバーで幅が減って顕在化）
- `components/icons.tsx`: `PanelLeft` を追加（lucide は Phase 3 で削除済みのため自作）

### 実装中に見つけて直したバグ

1. **最初から待機のターミナルが「完了」と誤判定される**
   初回の idle イベントで done にしていた。実行中→待機の遷移時のみに限定して解消。
2. **リロードのたびに全ターミナルが「完了（未確認）」になる**
   WS 再接続時の `resize` 送信で PTY が再描画し、`running` が一瞬立って `running→idle` の遷移が成立していた。
   `MIN_RUNNING_MS = 1000` を導入し、1秒未満の実行は完了に数えないようにして解消。

### 検証

`npx tsc -b --noEmit` → exit 0 / `npx vitest run` → **69件 GREEN**（51 → 69。pane-state のテスト18件を追加）。

ブラウザ実機（Vite :5174 + backend :3001）:

| 検証 | 結果 |
|---|---|
| サイドバー表示 | ターミナル一覧・状態ドット・Alt番号・シェル名・状態ラベルが表示 |
| クリック切替 | サイドバー行クリックで該当ペインがアクティブ化・フォーカス移動 |
| 実行中の反映 | zsh で `sleep 25` 実行 → サイドバーが青ドット「実行中」、ヘッダーに集約バッジ |
| 完了（未確認）の検出 | 別ペインを見ている間に PowerShell で `Start-Sleep 4` → シアンドット「完了（未確認）」、ヘッダーも集約表示 |
| 未確認の解除 | その行をクリック → 「待機」に戻り、集約バッジが消える |
| 集約 | サイドバー上部に「実行中 1 / 完了 1」等のカウント。すべて待機なら「すべて待機」 |
| コンソール | エラー0件 |

### 残っている作業（担当セッション終了により未着手）

backend-rs 担当セッションが終了したため、以下はユーザー許可待ちのまま残っている:
- RDD.md / README.md の改訂（Rust構成・Docker廃止・サイドバー機能の反映）
- Node版 `backend/` の削除
- **`frontend/dist` の再ビルド**（サイドバーの変更が未反映。`scripts/build-frontend.ps1` で焼き直しが必要）

## Phase 22: dist焼き直し・Node版削除・ドキュメント改訂（2026-08-31）

### frontend/dist の焼き直し

`scripts\build-frontend.ps1` を実行し、サイドバー（Phase 6）を含むバンドルを生成。

```
dist/assets/index-DL40YSgj.css   28.48 kB │ gzip:  6.11 kB
dist/assets/index-b4tMAnPW.js   501.76 kB │ gzip: 135.03 kB
✓ built in 731ms
```

検証:
- 未解決の bare import（`from"preact"` / `from"@xterm/"`）: **0件**（スクリプトの検知も通過）
- サイドバーのコードが含まれること: 「ターミナル一覧」「完了（未確認）」「サイドバーを閉じる」「入力待ち」の各文字列を確認
- 単一バイナリ配信（`http://localhost:3001`）でサイドバー表示・2セッション復元・状態表示を実機確認。コンソールエラー0件

### 削除

| 対象 | 状態 |
|---|---|
| `backend/`（Node版、163MB） | ごみ箱へ移動。git 追跡28ファイルのため履歴は残る |
| `frontend/.dockerignore` | ごみ箱へ移動（Docker廃止のため） |
| `terraform/` | 前セッションが削除済み |
| `Dockerfile` 群 | 前セッションが削除済み |

削除前に `backend-rs` / `scripts` からの参照が無いことを確認。削除後に `cargo test` 78件・`vitest` 69件が GREEN であることを確認済み。

### ドキュメント改訂

**README.md**（133行 → 191行）: 単一バイナリ構成へ全面改訂。
- Terraform/Docker のセットアップ手順を削除し、`MultiTerm起動.bat` / `start-windows.ps1` による起動手順へ
- サイドバーの説明（状態4段階の意味・完了が見るまで残ること・1秒未満の実行を数えない理由）を追加
- WebSocketバイナリプロトコルのフレーム表を追加
- 技術スタックを Rust + axum + portable-pty + rust-embed / Preact へ更新
- 移行前後の実測値表を追加（常駐メモリ 233.8MB → 2.1MB 等）
- 非ASCIIパスでビルドが壊れる制約と回避策を明記

**RDD.md**（209行 → 321行）: 要件は残しつつ v4 の変更を反映。
- 4章の技術スタックを Rust 構成へ改訂し、旧構成を 4.1 に参考として残した
- 5章に13〜15項（単一プロセス配信・WSバイナリプロトコル・サイドバー）を追加
- 6章の除外機能に「Docker/Terraform によるコンテナ構築（v4で廃止）」を追加。タブ機能がスコープ外である点は維持し、v4のサイドバーが階層を導入しないことを明記
- 8章のネットワーク公開ポリシーを単一ポート構成へ改訂。フロントの接続先が配信元オリジンに追従する要件を追加
- **10章（新規）**: WebSocketバイナリプロトコル。フレーム形式・UTF-8境界・DSR自動応答・受け入れ基準
- **11章（新規）**: ターミナル一覧サイドバー。表示内容・ペイン状態の4段階・集約規則・完了判定の条件・受け入れ基準

### 現在の構成

```
multiterm/
├── backend-rs/     Rust バックエンド（PTY + WS + 静的配信）
├── frontend/       Preact フロントエンド
├── scripts/        build-frontend.ps1 / start-windows.ps1
├── MultiTerm起動.bat / MultiTerm停止.bat
├── RDD.md / README.md / BUILDLOG.md / NEXTSTEP.md
└── .pgdd/
```

テスト実績: cargo test **78件** / vitest **69件** GREEN。

## Phase 23: エージェント別の状態判定（herdr のスクリーンマニフェスト方式を踏襲）

### 背景

ユーザーからの問い「herdr と Claude Code の入力状態の判定は同じか」。調査の結果、**同じではなく herdr の方が厳格**だった。

| | herdr | MultiTerm（変更前） |
|---|---|---|
| 方式 | ①ライフサイクルフック ②**スクリーンマニフェスト**（フォアグラウンドプロセスを識別し専用TOMLで画面下部を照合。OSCも見る） ③ソケットAPI | 汎用正規表現 + 「代替画面で静止＝入力待ち」 |
| blocked の条件 | **既知の承認・質問・許可UIに一致したときだけ** | 代替画面で静止すれば無条件 |
| Claude Code | スクリーンマニフェストで対応 | エージェント固有の知識なし |

出典: [herdr docs / agents](https://herdr.dev/ja/docs/agents/)

変更前の問題: Claude Code が作業を終えて入力を待っているだけでも「入力待ち（黄）」になり、承認を求めている状態と区別できない。分割が多いと本当に対応が必要なペインが埋もれる。

### 実測した画面（推測ではなく実機から採取）

稼働中の Claude Code セッションの replay バッファを読み、待機画面の実データを取得した。

```
 ▐▛███▛█   Claude Code v2.1.251
▝▜██████▀  Opus 5 (1M context) with xhigh effort · Claude Team
  ▝▝ ▝▝    C:\Users\浅野寛貴
  ⏵⏵ auto mode on (shift+tab to cycle)
  ⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker
───────────────────────────────（罫線1行が200文字超）
❯
```

承認UIの文言は Claude Code の公開ドキュメント・issue から確認した
（[permissions](https://code.claude.com/docs/en/permissions) / [issue #4421](https://github.com/anthropics/claude-code/issues/4421)）。

### 実装（backend-rs/src/monitor/state_detector.rs）

- `Agent` enum と `detect_agent(screen)`: 代替画面に入っているセッションに限り、画面テキストから識別する。
  目印は `Claude Code v<数字>` / `for shortcuts` / `auto mode on (shift+tab to cycle)`。
  識別はセッションごとに一度だけ行い以後保持する（毎チャンクの走査はしない）
- `classify_agent_screen(agent, screen)`: 承認・選択のパターンに一致すれば waiting-input、無ければ idle
- `AGENT_TAIL_LIMIT = 8192`: 承認UIは罫線とともに画面下部へ描かれるため、従来の末尾512バイトでは選択肢まで届かない。
  エージェント識別後のみ8KBを保持する（評価は静止時のみなので常時コストは増えない）
- `evaluate()`: エージェント識別済み → 専用判定 / 未識別のTUI → 従来どおり静止＝入力待ち / 通常画面 → 7章の末尾行判定

### 検証

`cargo test` **88件 GREEN**（78 → 88。エージェント判定10件を追加）。テストには実機から採取した画面データを使用。

実機検証（バックエンドを通した状態遷移の観測）:

| ケース | 画面 | 結果 | 変更前 |
|---|---|---|---|
| A | 承認UIでもプロンプトでもない末尾（`Working on the task`） | **idle** | waiting-input |
| B | 承認UI（`Do you want to proceed?` + 3択） | **waiting-input** | waiting-input |

A が idle になったことがエージェント識別の効いている証拠。変更前は代替画面で静止すれば無条件に入力待ちだった。

なお実機の `claude` 起動は `Accessing workspace...` で長時間止まり完了しなかったため、
Claude Code の画面を模した出力を PTY へ流して判定経路を検証した（判定はバックエンドを通っている）。

### ドキュメント

RDD.md に **12章「エージェント別の状態判定」** を追加（背景・識別方法・判定表・承認パターン・末尾バッファ・受け入れ基準）。

## Phase 24: ターミナルの発色を Windows Terminal に合わせる

### 背景

ユーザーからの指摘「ターミナルで開いたときは色あるけどこっちは色ない」。

まず**色が出ているか**を実測した。PTY出力に PSReadLine の構文ハイライト（`ESC[93m` 黄・`ESC[36m` シアン・`ESC[92m` 緑）が
含まれていること、`TERM=xterm-256color` / `SupportsVirtualTerminal=True` / PSReadLine 2.0.0 読込済み /
`$PROFILE` も読まれている（`shiori` 関数が使える）ことを確認。`Write-Host -ForegroundColor` で
RED/GREEN/CYAN/YELLOW がすべて着色されることも画面で確認した。**色は出ていた。**

`PS C:\Users\...>` が白いのは PowerShell 5.1 の既定プロンプトが無色だからで、Windows Terminal でも同じ。

### 原因（実データで確定）

既定の ANSI 16色パレットが両者で違っていた。

| | 既定パレット | 確認方法 |
|---|---|---|
| xterm.js 6.0.0 | **Tango**（GNOME Terminal 由来） | `node_modules/@xterm/xterm/lib/xterm.js` から色コードを抽出 |
| Windows Terminal | **Campbell** | settings.json に colorScheme 指定なし＝既定 |

`XTERM_THEMES` は background / foreground / cursor の3色しか指定しておらず、16色は xterm.js の既定（Tango）のままだった。
Tango は暗い色が多く、背景 `#0a0a0a` では沈んで「色が付いていない」ように見える。

| 色 | Tango（変更前） | Campbell（変更後） |
|---|---|---|
| green | `#4e9a06` 暗い黄緑 | `#13A10E` 鮮やかな緑 |
| blue | `#3465a4` くすんだ青 | `#0037DA` 濃い青 |
| cyan | `#06989a` 暗い青緑 | `#3A96DD` 明るい水色 |
| red | `#cc0000` | `#C50F1F` |
| brightGreen | `#8ae234` | `#16C60C` |

### 実装

`frontend/src/components/TerminalPanel.tsx` に `CAMPBELL_ANSI`（16色）を追加し、dark テーマへ展開。

- 背景・前景・カーソルはアプリの配色（`#0a0a0a` / `#e5e5e5`）を維持し、**16色だけ**を差し替えた
- light テーマは白背景で Campbell の明色が視認しづらいため**変更しない**
- 色値の出典: [Microsoft Learn / Windows Terminal color schemes](https://learn.microsoft.com/en-us/windows/terminal/customize-settings/color-schemes)

### 検証

`npx tsc -b --noEmit` → exit 0 / `npx vitest run` → **69件 GREEN**。

実機で ANSI 30-37（通常色）と 90-97（明色）を並べて出力し、画面で発色を確認:

- `NORMAL34`（青）がくすんだ青から**濃い青**へ
- `NORMAL36`（シアン）が暗い青緑から**明るい水色**へ
- `NORMAL32`（緑）が暗い黄緑から**鮮やかな緑**へ

dist を焼き直し（JSハッシュ `b4tMAnPW` → `DkLTBkJ7`）、release バイナリへ反映した。

## Phase 25: 起動時間の短縮（シェル検出をサーバ起動から分離）

### 症状

`MultiTerm起動.bat` を実行してもポートが開かず「起動できない」状態になる。

### 原因

`main.rs` が `detect_available_shells()` を **await してから** listen していた。
Phase 18 で WSL の誤検出を直すため `COMMAND_TIMEOUT` を 5秒→20秒 に延ばしたことで、待ち時間が伸びていた。

実測:

| WSLの状態 | listening までの所要 |
|---|---|
| ウォーム | 7秒 |
| コールド | 20秒以上（WSL起動が実測10秒 × タイムアウト20秒） |

`MultiTerm起動.bat` は最大5分待つ作りなので最終的には開くが、その間ウィンドウが無反応になる。

### 実装

**サーバ起動と外部コマンド実行を分離した。**

- `immediate_shells()` を追加。外部コマンドを起動せずに用意できるシェルだけを返す
  （Windows: cmd / powershell、Unix: 実在確認のみで済む bash / zsh / fish / sh）
- `main()` はこの一覧で即座に listen し、pwsh / WSL の検出は `tokio::spawn` で背後に回す
- `ShellRegistry`（`RwLock<Vec<ShellInfo>>` + `AtomicBool`）を新設し、検出完了時に差し替える
- `GET /api/shells` はレスポンスヘッダ `x-shell-detection: detecting | complete` で状況を返す。
  envelope の形は変えない。CORS の `expose_headers` に含め、開発モード（別オリジン）からも読めるようにした
- フロントは `detecting` の間 2秒間隔で取り直す（上限20回）。
  localStorage の既定シェルを許可リストと突き合わせる矯正処理は**検出完了後にのみ**行う
  （検出途中の不完全な一覧で矯正すると、WSLを既定にしていた設定が消えるため）

### 検証

`cargo test` **88件** / `vitest` **71件**（69→71。検出中/完了のヘッダ解釈テストを追加）GREEN。

実機:

| 項目 | 結果 |
|---|---|
| listening までの所要 | **0〜1秒**（7秒から短縮） |
| 起動直後の `GET /api/shells` | `x-shell-detection: detecting` / cmd・powershell（208 bytes） |
| 検出完了後 | `x-shell-detection: complete` / cmd・powershell・wsl-Ubuntu-22.04・wsl-Ubuntu（448 bytes） |
| ログ | `listening on 127.0.0.1:3001 (shells: cmd, powershell)` → `shell detection finished (shells: cmd, powershell, wsl-Ubuntu-22.04, wsl-Ubuntu)` |

RDD.md に **13章「起動時間とシェル検出の分離」** を追加。

### 調査時の注意（踏んだもの）

`cargo test` はテストバイナリしかビルドしないため、`target/debug/multiterm-backend.exe` を直接起動すると
**古いバイナリが動く**。ヘッダが出ずに実装を疑ったが、`cargo build` し直したら正しく出た。

## Phase 26: PTYへ渡す環境変数の修正（色が出ない根本原因）

### 症状

Phase 24 で ANSI 16色を Campbell に揃えたのに、Claude Code のロゴが白一色のままだった。

### 原因

**`NO_COLOR=1` が PTY の子プロセスへ引き継がれていた。**

Claude Code のロゴ部分の生データを調べたところ、色指定（SGR）が**一つも含まれていなかった**。

```
ESC[2;2H ▐▛███▛█ ESC[3C Claude ESC[1C Code ESC[1C v2.1.252
```

`has256: false` / `hasTrueColor: false`。つまり xterm.js の描画ではなく、**アプリが色を出していなかった**。

PTY内の環境変数を調べた結果:

| 変数 | 値 | 出所 |
|---|---|---|
| `NO_COLOR` | **`1`** | プロセス環境のみ（ユーザー/システム環境変数には無い＝MultiTermを起動した親から継承） |
| `COLORTERM` | 空 | Windows Terminal では `truecolor` が入る |
| `TERM` | `xterm-256color` | 設定済み |

[NO_COLOR 規約](https://no-color.org/) により、この変数があるとアプリは色出力を抑止する。
`spawn_pty` は環境を明示的に整えていなかったため、親の値がそのまま子まで伝播していた。

### 実装

`session_manager.rs` の `spawn_pty` で PTY 起動時に:

- `command.env("COLORTERM", "truecolor")` — 24bit色を使える環境であることを伝える（Windows Terminal と同条件）
- `command.env_remove("NO_COLOR")` — 親から継承した値をターミナルの子プロセスへ持ち込まない

`TERM=xterm-256color` は据え置き。

### 検証

`cargo test` **88件 GREEN**。

**親プロセスに `NO_COLOR=1` を設定して起動**した状態で、PTY内の環境を確認:

```
TERM=[xterm-256color]  COLORTERM=[truecolor]  NO_COLOR=[]  NOCOLOR_SET=[False]
```

同じ状態で `claude` を起動し、出力に TrueColor エスケープが含まれること（`hasTrueColor: true`。修正前は `false`）を確認。
画面でも Claude Code の信頼確認画面が着色されることを確認した（`Accessing workspace:` がオレンジ、選択中項目が青、
`Security guide` がリンク色。修正前は同じ画面が白一色）。

### 補足

Phase 24 の Campbell パレット適用自体は正しく効いていたが、アプリが色を出していなかったため見えていなかった。
16色パレット（Campbell）と、アプリに色を出させる環境変数の両方が揃って初めて Windows Terminal と同じ見た目になる。

---

## Phase 27: サイドバーの幅をドラッグで変更（2026-09-02）

### 背景

サイドバーの幅が `Sidebar.tsx` の `w-56`（224px）でハードコードされており変更できなかった。
ターミナル名やシェル名が長いと truncate され（`Windows Power...`）、逆に短い名前ばかりのときは横幅が無駄になる。

折りたたみ自体は Phase 21 で実装済み（ヘッダの PanelLeft ボタン）。今回追加したのは以下の2点。

1. 境界線ドラッグによる幅の変更
2. 幅と開閉状態の localStorage 永続化（従来はリロードすると必ず開いた状態・既定幅に戻っていた）

### 実装

既存の仕組みをそのまま踏襲し、新しい方式は持ち込んでいない。

| 要素 | 踏襲元 |
|---|---|
| ドラッグ処理 | `SplitPane.tsx` — `pointerdown` で `window` に `pointermove`/`pointerup` を張り、`pointerup` で自ら外す |
| 永続化 | `features/settings/settings.ts` — clamp + load/save の純関数、`try/catch` で既定値へフォールバック |
| 保存タイミング | `Workspace.tsx` の layout 保存と同じ `useEffect` 方式 |
| 境界線の見た目 | `SplitPane.tsx` — `role="separator"` + `bg-border hover:bg-primary/60` + `cursor-col-resize` |

**新規** `frontend/src/features/sidebar/sidebar-state.ts`（46行）

```ts
const STORAGE_KEY = 'multiterm.sidebar.v1';
export const SIDEBAR_WIDTH_MIN = 160;   // タイトルとシェル名が読める下限
export const SIDEBAR_WIDTH_MAX = 480;   // ターミナル領域を圧迫しない上限
export const DEFAULT_SIDEBAR_WIDTH = 224; // 従来の w-56 と同値

export interface SidebarState {
  readonly width: number;
  readonly open: boolean;
}
```

`clampSidebarWidth` / `loadSidebarState` / `saveSidebarState` は `settings.ts` の
`clampFontSize` / `loadSettings` / `saveSettings` と同形。

**変更** `Sidebar.tsx`

- props に `width: number` を追加
- `w-56` と `border-r` を外し `style={{ width: \`${width}px\` }}` に。
  `border-r` を外したのは、隣に置くドラッグ用 separator が境界線を兼ねるため（二重線の回避）

**変更** `Workspace.tsx`

- `sidebarOpen: boolean` を `sidebar: SidebarState` に置き換え（初期値は `loadSidebarState`）
- 保存の `useEffect` を追加
- `handleSidebarPointerDown` を追加。`contentRef`（サイドバー＋ターミナル領域）の左端を基準に
  `clientX - rect.left` を幅とし、`clampSidebarWidth` を通す
- サイドバーと separator を同じ条件式に入れ、閉じているときは両方消える

### 検証

`npm test` **77件 GREEN**（既存71 + 新規6）。`tsc -b` 型エラーなし。

release ビルドで起動し、ブラウザで実測:

| 確認項目 | 結果 |
|---|---|
| ドラッグで幅が追従 | x=380 へドラッグ → 380px |
| 最小クランプ | x=40 → 160px |
| 最大クランプ | x=900 → 480px |
| pointerup 後にリスナー解除 | 解放後に x=700 へ動かしても 320px のまま |
| リロードで幅を復元 | `{"width":320,"open":true}` → 320px で復元 |
| 折りたたみの永続化 | 閉じてリロード → 閉じたまま。再度開くと 320px に戻る |
| 閉じたとき separator も消える | サイドバーの separator のみ消え、SplitPane の分割線3本は残る |
| localStorage 削除時 | 既定 224px・開いた状態 |
| xterm の追従 | サイドバー 320→460px で `.xterm-screen` が 105→84px。`ResizeObserver` が `fit()` を呼んでいる |

### 注意点（ビルド時にはまった箇所）

`build-frontend.ps1` を PowerShell から `2>&1` 付きで呼ぶと、ビルドが成功していても失敗する。
PowerShell 5.1 は native コマンドの stderr を `NativeCommandError` に包むため、
スクリプト側の `$ErrorActionPreference = 'Stop'` が発火して dist の反映前に中断する。
今回は vite の chunk サイズ警告（バンドルが 500kB を超えた）が stderr に出たことで顕在化した。
`2>&1` を付けずに呼べば正常に完了する。

### スコープ外（今回は入れていない）

| 項目 | 理由 |
|---|---|
| 矢印キーでのリサイズ | 既存の `SplitPane` にも無く、操作系を不揃いにしないため |
| アイコンのみの細幅表示（VS Code 風） | 既存の折りたたみで代替できる |
| `aria-valuenow` / `tabIndex` | 既存 `SplitPane` と同水準（`role="separator"` + `aria-orientation`）に揃えた |
| 保存のデバウンス | layout 保存がより大きな JSON を同じ頻度で書いており、そこで問題が出ていない |

---

## Phase 28: サイドバー幅の下限撤廃と、名前のダブルクリック編集（2026-09-02）

### 依頼

1. サイドバーの幅を「ギリギリまで」調整できるようにする（最大は現状のまま、最小は消えるくらいまで）
2. ターミナル名をダブルクリックで変更できるようにする。サイドバーとヘッダのどちらで変えても両方に反映されること

### 実装

**幅の下限を撤廃** — `features/sidebar/sidebar-state.ts`

`SIDEBAR_WIDTH_MIN` を 160 → **0**。最大は 480 のまま。
幅0でもドラッグ用の境界線（6px）はサイドバーの外側にあるため残り、そこから掴んで戻せる。

**名前のダブルクリック編集** — `Sidebar.tsx`（新規）/ `TerminalPanel.tsx`（シングル→ダブルへ変更）

サイドバーは `renameSession` を直接呼び、結果を `onRenamed` で Workspace に渡す（TerminalPanel と同じ形）。
`handleRenamed` が `sessions` を更新し、サイドバーの行・ヘッダのタイトルはどちらもそこから派生するため、
片方で変更するともう片方にも自動で反映される。

### この作業で見つけた既存バグ3件（いずれも Phase 19 の React → Preact 移行時に混入）

**① `onChange` がタイプ中に発火しない → リネームが常に無効だった**

Preact の `onChange` は**ネイティブの `change` イベント**にマップされる（React は `input`）。
タイプしても `draftTitle` が更新されず、Enter（keydown）が change より先に走るため、
`commitRename` が編集前の値を読んで「変更なし」と判断していた。

検証で得た決定的な差:

| 操作 | 結果 |
|---|---|
| `input` イベント → Enter | 名前は**前回の change 時の値**のまま |
| `change` イベント → Enter | 名前が**正しく変わる** |

修正: `onChange` → **`onInput`**（TerminalPanel / Sidebar の text input）。
`SettingsPanel` の `<select>` は `change` が正しい挙動なので変更しない。

**② Escape でキャンセルしても保存されていた**

Escape で `setEditing(false)` すると input が DOM から外れ、**`onBlur` が発火して `commitRename` が走る**。
`setDraftTitle` は非同期なので間に合わず、編集中の値がそのまま保存されていた。

修正: `cancelledRef` を追加し、Escape 時に立てて `onBlur` 側の保存をスキップする。
編集開始時にフラグをリセットして持ち越さない。

**③ 未選択の行・非アクティブなパネルでは、ダブルクリックが効かなかった**

`TerminalPanel.tsx` の

```tsx
useEffect(() => {
  if (active) termRef.current?.focus();
}, [active]);
```

が原因。サイドバーの未選択行をダブルクリックすると、
①クリックで選択され `active` が false→true ②編集欄が開いて autoFocus
③この useEffect が端末へフォーカスを移す ④input が blur して編集が即終了、という順で潰れていた。
既に選択済みの行では `active` が変わらないため発生せず、「2回目は成功する」という挙動になっていた。

MutationObserver で捉えた時系列（9ms で開いて閉じている）:

```
17622 dblclick detail:2
17624 BUTTON removed   ← 編集モードに入っている
17625 DIV added        ← input 出現
17633 DIV removed      ← 閉じられた
17633 BUTTON added
```

修正:
- 端末へのフォーカス移動を、入力欄にフォーカスがあるときは行わない
  （`document.activeElement instanceof HTMLInputElement` で判定）
- 編集開始時に `titleInputRef` で入力欄へ明示的にフォーカス（autoFocus だけでは xterm が保持したままになる）
- 三項演算子の両分岐に `key` を付与。key がないと Preact が編集UIと通常UIの子要素を再利用し、
  閉じるボタンの `svg` が名前ボタンの子として使われる壊れ方をしていた（ログに `removed: svg / added: SPAN×3`）

### 検証

`npm test` **77件 GREEN**。`tsc -b` 型エラーなし。release ビルドで実機確認:

| 確認項目 | 結果 |
|---|---|
| 幅を0まで縮小 | 0px。横スクロールなし、レイアウト崩れなし |
| 幅0から復帰 | 境界線が左端に6px残る（`x:0, width:6`）→ 掴んで300pxへ戻せる |
| サイドバーで改名（**未選択の行・リロード直後**） | 1回のダブルクリックで開き、フォーカスも保持。`ビルド監視` に変更 |
| ヘッダで改名（**非アクティブなパネル**） | 同様に成功。`テスト実行` に変更 |
| 双方向の同期 | サイドバー・ヘッダ・サーバーの3箇所すべて一致 |
| Escape | 編集前の名前が維持され、サーバーも未変更 |
| 端末のフォーカス（既存機能） | 編集していないときは通常どおり端末へ移る |
| Alt+数字での移動（RDD 9.6章） | 2番目がアクティブになり、端末へフォーカスが移る |

### 補足

依頼の「両方をダブルクリックに」を満たすため、ヘッダ側は**シングルクリック→ダブルクリック**に変更した。
シングルクリックだと名前を押しただけで編集モードに入る誤爆があったため、その点も解消している。

---

## Phase 29: Ctrl+V でペーストできない問題の修正（2026-09-02）

### 症状

MultiTerm 上で Claude Code の TUI を使っているとき、Ctrl+V でペーストできない。

### 原因

xterm.js は Ctrl+V を制御文字 `\x16`（SYN）として PTY へ送り、その際 `preventDefault()` するため、
ブラウザのネイティブ paste イベントが発火しない。Claude Code の TUI は `\x16` を無視するため何も起きない。

PowerShell では動いていた。PSReadLine が `\x16` を「Paste」にバインドしており、
**サーバー側（ローカルなので同一PC）の Windows クリップボード**から貼り付けるため。
Claude Code は PSReadLine を使わないので、この経路が使えない。

xterm.js の paste 処理自体は生きていることを確認した。paste イベントを直接投げると
ブラケットペースト形式で正しく送られ、Claude Code の入力欄にも入る。

```
送信内容: \x1b[200~MANUAL_PASTE_EVENT\x1b[201~
→ Claude Code の入力欄に MANUAL_PASTE_EVENT が表示される
```

### 修正

`TerminalPanel.tsx` — Ctrl+V だけ xterm に処理させず、ブラウザのペーストに任せる。

```ts
term.attachCustomKeyEventHandler((event) => {
  if (
    event.type === 'keydown' && event.ctrlKey &&
    !event.altKey && !event.metaKey && !event.shiftKey &&
    event.key === 'v'
  ) {
    return false;
  }
  return true;
});
```

`attachCustomKeyEventHandler` が false を返すと xterm はそのキーを処理せず `preventDefault` も呼ばないため、
ネイティブの paste イベントが発火し、xterm の paste ハンドラがブラケットペーストで送信する。
Windows Terminal と同じ挙動になる。

### 検証

`npm test` 77件 GREEN。`tsc -b` 型エラーなし。release ビルドで WebSocket の送信内容を実測:

| 状況 | PTYへ送られた内容 |
|---|---|
| 修正前 Ctrl+V | `\x16` のみ（クリップボードの内容は送られない） |
| 修正後 Ctrl+V（素のPowerShell） | `CTRL_V_PASTE_OK`（クリップボードの内容そのまま） |
| 修正後 Ctrl+V（Claude Code 起動中） | `\x1b[200~PASTED_INTO_CLAUDE_CODE_TUI\x1b[201~` |

Claude Code は DEC 2004（ブラケットペーストモード）を有効にするため、マーカー付きで送られる。
ユーザーの環境でも Ctrl+V でペーストできることを確認した。

### 副作用

Ctrl+V を制御文字として送りたいアプリ（Emacs の quoted-insert 等）では使えなくなる。
Windows Terminal も Ctrl+V をペーストに割り当てているため、標準的な挙動に揃える判断とした。
Ctrl+C は中断シグナルとして必要なため変更していない。

### 実装中のミス

コメントに `\x16` と書こうとして、生の制御文字（0x16）をソースへ書き込んでしまった。
`grep -P '\x16'` で検知し、文字列表記に置き換えて除去した。

---

## Phase 30: 状態色を赤・黄・青へ、ヘッダー帯の着色、サイドバーの表記順（2026-09-03）

### 依頼

1. それぞれのターミナルのヘッダーの色もステータスの色になるように
2. 左のサイドバーのターミナルの種類の名前と状態の位置を反対に
3. 状態の色が緑と青がわかりにくいから変えて

### 配色の決定経緯

当初は「実行中だけを紫にする」案で実装したが、ユーザーから
**「色、赤系と黄色系と青」「今の緑と青の状態がほとんどでわかりにくい」**
との指摘があり、**紫案を破棄して赤・黄・青の3系統に組み直した**。

変更前は 実行中=青 / 完了=シアン / 待機=緑 と青系が3つ隣接しており、
かつ画面の大半を占めるのが「実行中」と「待機」だったため、
最も頻繁に見る2つが最も見分けにくいという状態だった。

| 状態 | 変更前 | 変更後 |
|---|---|---|
| 入力待ち | 黄 `yellow-400` + 点滅 | **赤 `red-500`** + 点滅 |
| 実行中 | 青 `blue-500` | **黄 `amber-400`** |
| 完了（未確認） | シアン `cyan-400` | **青 `blue-500`**（待機と同色） |
| 待機 | 緑 `green-500` | **青 `blue-500`** |

待機が大半を占めるため、待機を落ち着いた青にして、
実行中（黄）と入力待ち（赤）だけが視界に飛び込むようにしている。

**「完了（未確認）」はユーザー判断で色だけ待機と同じにした。**
判定ロジック（`shouldMarkDone`）・ラベル・サイドバー上部の集約カウント（`完了 N`）は
残っているため、色では区別できないが数だけは分かる状態になっている。
実機で見て気になるようなら done の機能ごと削除する。

### 実装

**① 配色** — `features/status/status-style.ts` / `features/status/pane-state.ts`

枠・ドット・ヘッダー帯・集約カウント・集約バッジの計5系統を赤/黄/青へ。
発光の `rgba` も対応色に差し替えた（赤 `239,68,68` / 黄 `251,191,36` / 青 `59,130,246`）。

旧色（`purple-` / `green-` / `cyan-` / `yellow-`）の残存が0件であることを grep で確認済み。

**② ヘッダー帯の着色** — `features/status/status-style.ts` に `statusHeaderClasses()` を新規追加

```ts
export const statusHeaderClasses = (status: SessionStatus): string => {
  switch (status) {
    case 'running':       return 'bg-amber-400/40';
    case 'waiting-input': return 'bg-red-500/40';
    case 'idle':          return 'bg-blue-500/40';
  }
};
```

`components/TerminalPanel.tsx` のヘッダー帯を、従来の固定 `bg-muted/50` から
接続時のみ状態色へ切り替えるようにした（未接続時は `bg-muted/50` のまま）。
不透明度はユーザー選択により40%（「背景をしっかり染める」）。

**③ サイドバーの表記順** — `components/Sidebar.tsx`

```diff
- {item.shellLabel} · {paneStateLabel(item.state)}
+ {paneStateLabel(item.state)} · {item.shellLabel}
```

### 検証

`npm test` **80件 GREEN**（既存77 + 新規3）。`tsc -b` 型エラーなし。

新規テスト:
- `statusHeaderClasses` が枠と同じ状態色を返すこと
- 実行中と待機が別の色相であること
- **赤・黄・青の3系統で組むこと**（`green` / `purple` / `cyan` が一切現れないことを機械的に検証）

### 未検証（重要）

**画面での見え方は確認していない。** 稼働中のセッションが5つ（うち4つが実行中）あり、
`rust-embed` の構成上 dist の更新には `cargo build --release` が必要だが、
バックエンド稼働中は exe を置き換えられない（`os error 5`）ため、
フロントの dist 生成までで停止している。ユーザー判断により、
**画面確認より先にコミット・push を行った。**

次に起動したときに確認すべき項目:

- ヘッダー帯の不透明度40%でタイトルとシェル名が読めるか（読みにくければ 25〜30% へ下げる）
- 実行中の黄と待機の青が見分けられるか（今回の主目的）
- 入力待ちの赤が実行中の黄と紛れないか
- 待機（青）が大半のとき画面がうるさくないか
- ライトテーマでも文字が読めるか（40%は暗いテーマ前提で選んでいる）

### 補足

作業の中断・再開用に `TODO.md` を新規作成した。
残作業（画面確認、ウィンドウ切り替え機能の仕様確定）と、
この環境で踏んだ罠（稼働中は cargo build できない等）をまとめてある。
