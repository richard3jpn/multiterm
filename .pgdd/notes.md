# PGDD Notes

壁打ち・設計判断・棚卸しの記録。`pgdd-cli.js note` 経由で追記する。

## 2026-07-25 記録

## フェーズ1: 開発前チェックリスト不足項目の決定（ユーザー指示「最後まで走ってアプリ完成させて」に基づきAgentが決定）
- 決定: 生成先はプロジェクト直下（multiterm/frontend, backend, terraform）。サブディレクトリを作らない
- 理由: PGDD configのallow/blockパスがプロジェクト直下のfrontend/等を前提としているため
- 影響フェーズ: scaffold, backend, frontend, iac-integration
- 決定: 認証・マルチユーザーは不採用。バックエンドは127.0.0.1のみにバインド（ローカル個人利用前提）
- 理由: RDD.mdに認証要件なし。PTYへの任意コマンド実行を許すため、外部公開は危険。localhostバインドで緩和
- 影響フェーズ: backend, iac-integration
- 決定: MVP範囲＝セッション任意数起動/破棄・OS判定シェル・WS経由PTY同期・リロード後再接続・分割レイアウト＋ドラッグリサイズ・状態判定(Running/Idle/Waiting Input)＋色エフェクト・プリセットテーマ切替
- 決定: 除外＝背景画像/透明度カスタム・サーバプロセス再起動後のセッション復元・タブ機能・セッション名変更以外の管理機能・クラウドデプロイ
- 理由: RDD.mdのコア価値（状態がひと目でわかるワークスペース）に集中し過剰実装を避ける
- 影響フェーズ: backend, frontend
- 決定: 状態管理はContext API、テストはVitest（frontend/backend共通）で80%目標
- 影響フェーズ: backend, frontend

## 2026-07-25 記録

## フェーズ1: adversaryレビュー1回目FAILへの対応（C-1/C-2/H-1/H-2/H-3/M-1/M-2/M-3）
- 決定: アクセス制御を必須要件化（RDD 5章9項）: WS Origin検証ホワイトリスト + REST CORS制限 + ループバック限定公開
- 理由: 認証なしでもクロスオリジンWS/DNSリバインディング経由のRCEを防ぐ最低要件（C-1）
- 影響フェーズ: backend, iac-integration
- 決定: Docker公開はコンテナ内0.0.0.0リッスン + Terraform ports に ip="127.0.0.1" 明記（RDD 8章に形態別表）
- 理由: 127.0.0.1バインドとコンテナ間通信の技術矛盾を解消（C-2）
- 影響フェーズ: backend, iac-integration
- 決定: 状態判定条件表（bash/zsh/powershell/汎用、300ms静止+末尾行パターン、優先順位waiting>idle>running）と受け入れ基準（代表3シナリオのユニットテスト一致）をRDD 7章に定義（H-2）
- 影響フェーズ: backend
- 決定: 再接続時はバックエンドのセッション一覧をSSOTとし、レイアウトの死んだ葉ノードは自動削除（H-3）
- 影響フェーズ: frontend
- 決定: グリッド配置・セッション名変更を除外機能に明記（M-1, M-2。前回noteの「セッション名変更以外の管理機能を除外」を訂正: 名前変更も除外、タイトルは自動採番固定）
- 決定: リングバッファ上限200KB/セッション、同時セッション上限16、テーマはdark/lightの2種（M-3）
- 影響フェーズ: backend, frontend
- 決定: RDD 2章の機能要件表をMVP整合に修正（テーマ行・レイアウト行・状態監視行）、Agent.mdのテーマUI記述とterraform ports骨子も同期修正（H-1）
- 影響フェーズ: frontend, iac-integration

## 2026-07-25 記録

## フェーズ1: adversaryレビュー2回目FAILへの対応
- 決定: Agent.mdフロントエンド実装節のグリッド配置指示を削除（RDD 6章の除外と整合）
- 決定: 許可オリジンの設定源を要件化（RDD 8章）: 環境変数 ALLOWED_ORIGINS。DockerはTerraformが注入、開発モードは.envでViteオリジン(5173)を設定。Agent.md main.tf骨子と.env.exampleに反映
- 決定: waiting-inputパターン /続行/ → /続行しますか/ に厳格化、受け入れ基準に優先順位検証シナリオ④を追加
- 影響フェーズ: backend, frontend, iac-integration

## 2026-07-25 記録

## sparring棚卸し（Phase 5中のbackend横断修正）
- 決定: state-detectorのANSI除去正規表現に2文字ESCシーケンス（ESC= 等）のcatch-all（\x1b.）を追加
- 理由: 実zsh出力の末尾に ESC[K ESC[?1h ESC= ESC[?2004h が付き、ESC=の「=」が残って末尾行となりidle判定不能だった（E2Eで発見）
- エビデンス: 修正前バッファダンプで確認 → 回帰テスト追加（63テストGREEN）→ bash実機でidle→running→idle→waiting-input→idleの全遷移を確認
- 補足: ユーザーのカスタムzshテーマ（プロンプト描画後にcatエラーを出力）では末尾行がプロンプトでなくなりrunning誤判定が残る。RDD 7章の「ヒューリスティック・ベストエフォート」の範囲内（条件表との乖離ではない）
- 影響フェーズ: なし（backendは完了済みフェーズ。テスト・ビルドGREENを再確認済み）

## 2026-07-25 棚卸し（sparring→gate復帰）

- 要約: Phase 5 E2E検証で発見したbackend状態判定バグ（ESC= 2文字シーケンス未除去）を修正。回帰テスト追加・63テストGREEN・build成功・bash実機で全状態遷移確認。詳細はnotes.md参照
- フェーズ外変更:
  - backend/src/monitor/state-detector.ts (phase=frontend, 2026-07-25T04:23:27.185Z)

## 2026-07-25 記録

## v2機能拡張（ユーザー要望 2026-07-25: フォント設定・シェル選択・セッション名変更）
- 決定: v2フェーズ5本（requirements-v2 → backend-v2 → frontend-v2 → integration-v2 → docs-v2）をconfig applyで追加。完了済み7フェーズは不変
- 決定: フォントは等幅プリセット3種（System Mono / Consolas / Courier New）+ サイズ10〜20px整数。任意文字列入力は不可（CSSインジェクション面と挙動安定のため）
- 決定: シェル選択は許可リスト方式。バックエンドが実在検出（bash/zsh/fish/sh + 既定シェル、win32はpowershell.exe）し、POSTは許可リストのidのみ受理・任意パスは400
- 理由: PTYで任意バイナリパスを起動させない（ユーザーは端末内で任意コマンドを実行できるが、API面の入力検証としてはRDD既存方針（境界での検証）に整合させる）
- 決定: rename はPATCH /api/sessions/:id、1〜30文字・制御文字禁止・トリム。RDD 6章の除外から削除
- 影響フェーズ: backend-v2, frontend-v2, integration-v2, docs-v2

## 2026-07-25 記録

## v3機能拡張（ユーザー要望 2026-07-25: 新規ボタンからcmd/PowerShell/WSL zshをVSCode風に）
- 決定: v3フェーズ5本追加（requirements-v3〜docs-v3）。Docker(Linux)構成は残しWindowsホストbackend直接起動を正式サポート
- PoC実証（Windows node-pty@1.1.0 prebuilt）: powershell.exe / cmd.exe / wsl -d Ubuntu-22.04 --cd ~ -- zsh -l が全て対話動作。zshは.zshrc（スライムテーマ出力）読込＝ユーザー環境そのもの。エビデンス: /mnt/c/Temp/ptytest/poc.cjs 実行結果
- 決定: ShellInfoにargsフィールド追加。file/argsはバックエンド検出時の固定値のみ、クライアントは許可リストのidのみ指定（任意パス/引数注入不可）
- 決定: 状態判定にcmd.exeプロンプト /^[A-Za-z]:\\.*>\s*$/ 追加
- 決定: conpty AttachConsole failedは握りつぶす（既知事象・動作影響なし）
- 影響フェーズ: backend-v3, frontend-v3, integration-v3, docs-v3
- 環境事実: Windows Node.js v22.16.0 / WSLディストロ Ubuntu-22.04(使用中,Running)・Ubuntu(Stopped)・docker-desktop / Windows版pwsh(PS7)なし・powershell.exe(5.1)あり

## 2026-07-25 記録

## sparring（ユーザー要望 2026-07-25: UI改善）
- 決定: 新規ターミナルボタンをVSCode風スプリットボタン化。本体クリックで既定シェル、▼でシェル種類を直接選択して作成（NewTerminalButton.tsx新規）。SettingsPanelからシェル選択を削除しフォント設定のみに。handleCreateをshellId引数対応、▼選択時はdefaultShellIdも更新
- 決定: running(青)状態のパルスアニメーション(animate-pulse)を除去。枠・ドットとも静的な青に。waiting-inputドットのみ点滅を残す（入力待ちの注意喚起）。理由: 入力中もrunning判定で脈打つのが目障りとのユーザー指摘。RDD 2章/5章6項「青く脈打つ」も要更新
- 影響: frontend-v3範囲。46テストGREEN・build成功。C:\multiterm（Windows稼働版）にrsync反映・HMR確認
- 未対応（要相談）: Claude Code等のTUIは常時再描画で300ms静止せず、末尾行もシェルプロンプトでないため idle 判定できずrunning(青)のまま。状態判定の限界（RDD 7章でベストエフォート明記済み）。改善するにはalt-screen検知等のbackend変更が必要

## 2026-07-26 記録

## sparring（ユーザー要望 2026-07-26: Alt+数字でターミナル移動）
- 決定: レイアウトツリーのin-order走査(collectSessionIds)で視覚順N番目を求め、Alt+1〜9でその端末をアクティブ化しxterm.focus()。
- 実装: Workspaceにwindow keydownをキャプチャ段階で登録しxtermより先に横取り(preventDefault+stopPropagation)、Alt+数字がシェルへ漏れないようにした。新規作成/分割時は新端末を自動アクティブ化、削除時は解除。TerminalPanelにindex/active/onActivate追加、ヘッダに序数バッジ、アクティブ枠はring表示、クリック(mousedown)でもアクティブ化。
- 検証: frontend build成功・既存46テストGREEN。Windows /mnt/c/multiterm へrsync反映。
- 未反映: RDD 9.6章の記載追加は未実施(docsフェーズで対応)。

## 2026-07-26 記録

## sparring（ユーザー要望 2026-07-27: 分割ボタンのシェル選択 + Claude Code状態判定）
- 要望1: 縦/横分割ボタンでシェル種類を選べるようにした。SplitControls.tsx新設。シェル複数検出時はクリックでシェル選択メニュー、1種類以下は即・既定シェルで分割。onSplitに shellId?を追加、handleSplitで既定シェルも更新。
- 要望2: Claude Code等TUIの入力待ち/実行中を判定。エビデンス: node-pty+実機claudeで生出力を観察。判明=Claude Codeは代替画面バッファ(ESC[?1049h)使用/実行中はスピナー連続再描画で静止しない/入力待ちは出力静止。
- 実装: state-detectorに代替画面トラッキング追加。altScreen中は静止=waiting-input、通常画面は従来の末尾行パターン。TUIはスピナー一時停止のちらつき防止でQUIESCENCEを1000msに延長(TUI_QUIESCENCE_MS)。
- 検証: 本物StateDetectorを実機claude出力に接続し、起動後=waiting/実行中=running維持(ちらつきなし)/完了後=waitingを確認。backend107・frontend46テストGREEN。
- 未反映: RDD 9.6/9.7章と2章の状態表記(青パルス→静的)追記は未実施。
