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
