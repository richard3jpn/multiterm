# MultiTerm（マルチターム）

ブラウザ上で動作するマルチターミナルアプリケーション。任意の数のターミナルを動的に立ち上げ、二分木レイアウトで自由に分割・リサイズできる。Claude Code等のAIエージェントとの協働を想定し、各ターミナルの状態（実行中 / 待機 / 入力待ち）を枠色でひと目で把握できる。

- 実行中（running）: 青いパルス境界線
- 入力待ち（waiting-input）: 黄色の発光
- 待機（idle）: 落ち着いた緑の境界線

要件定義は [RDD.md](./RDD.md)、開発ログは [BUILDLOG.md](./BUILDLOG.md) を参照。

## 主な機能

- ターミナルの任意数起動・破棄（上限16、REST API + WebSocket）
- OS自動判定シェル（Windows: powershell.exe / Linux・macOS: $SHELL または bash）
- プロセス永続化: ブラウザをリロードしても既存セッションへ再接続し、画面バッファ（200KB/セッション）を復元
- 二分木レイアウト: 縦横分割・パネル削除・境界線ドラッグでのサイズ調整（localStorage保存、バックエンドをSSOTとして復元）
- 状態判定: バックエンドがPTY出力を監視（300ms静止 + 末尾行パターン）し、WebSocketで状態を配信
- テーマ: dark / light のプリセット切替（xterm配色も連動)
- 描画: xterm.js + WebGLアドオン（非対応環境は自動フォールバック）
- **フォント設定（v2）**: 等幅プリセット（System Mono / Consolas / Courier New）とサイズ（10〜20px）をヘッダーの設定（⚙）から変更。全ターミナルへ即時反映、localStorageに保存
- **シェル選択（v2/v3）**: 設定で新規ターミナルの起動シェルを選択。バックエンドが検出した許可リストから選ぶ。Docker環境ではbash / sh、**Windowsホスト起動時（v3）は cmd / PowerShell / WSL各ディストロ(zsh等・dotfile込み)**（下記「Windowsホストで起動」参照）
- **セッション名変更（v2）**: パネルのタイトルをクリックしてインライン編集（Enter確定 / Escキャンセル）。リロード後も維持

## セキュリティ

本アプリはPTYへの任意コマンド実行を提供するため、ローカル個人利用専用。

- WebSocket / REST ともに `Origin` ヘッダをホワイトリスト（環境変数 `ALLOWED_ORIGINS`）で検証
- 公開はループバック（127.0.0.1）限定。LANへの公開は禁止

## セットアップ

### 1. インフラ構築（Terraform + Docker）

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

バックエンド（127.0.0.1:3001）とフロントエンド（127.0.0.1:3000）がコンテナとして起動する。

ブラウザで http://localhost:3000 を開く。

```bash
# 破棄（コンテナ・ネットワークを全削除）
terraform destroy
```

### 2. 開発モードで起動する場合（任意）

```bash
cd backend
cp .env.example .env   # ALLOWED_ORIGINS にViteのオリジン（5173）を設定
npm install
npm run dev            # 127.0.0.1:3001
```

```bash
cd frontend
cp .env.example .env   # VITE_WS_URL / VITE_API_URL を設定
npm install
npm run dev            # http://localhost:5173
```

### 3. Windowsホストで起動する場合（Windowsマルチシェル対応・v3）

VSCodeの統合ターミナルのように、新規ターミナルボタンから **コマンドプロンプト(cmd) / Windows PowerShell / WSLの各ディストロ（zsh・bash、あなたのdotfile込み）** を選んで開けるようにするための構成。Docker/WSL構成ではLinuxコンテナ内のbash/shしか使えないため、Windows系シェルとWSLディストロを扱うにはbackendをWindowsホスト上で起動する。

**前提と重要な制約**:
- Windows側に Node.js（v22系）が導入済みであること（node-pty は prebuilt でビルド不要）
- **プロジェクトをWindows側に配置**する必要がある（例: `C:\multiterm` に git clone / コピー）。WSLファイルシステム上の `backend/node_modules` は Linux版 node-pty のため、Windowsのnodeから直接実行するとOS不一致でロード失敗する。Windows配置後に **Windowsの** PowerShell/cmd で `npm install` すること

```powershell
# Windows配置後、PowerShellから
cd C:\multiterm\scripts
.\start-windows.ps1      # 初回は自動でnpm install/build。backend(127.0.0.1:3001)+frontend(127.0.0.1:5173)起動
```

ブラウザで http://127.0.0.1:5173 を開き、設定（⚙）→「新規ターミナルのシェル」で cmd / PowerShell / WSL Ubuntu(zsh) を選択して新規ターミナルを作成する。停止は Ctrl+C。

選択できるシェルは実行環境で自動検出される:
- `cmd.exe`（コマンドプロンプト）/ `powershell.exe`（Windows PowerShell）/ `pwsh.exe`（導入時）
- `wsl.exe -l -v` で列挙した各WSLディストロ × ログインシェル（例: Ubuntu-22.04 の zsh、あなたの `.zshrc` 込み）

セキュリティ（許可リスト方式・許可リスト外400・Origin検証・127.0.0.1限定バインド）はWindowsホスト起動時も維持される。

### テスト

```bash
cd backend && npm test && npm run coverage
cd frontend && npm test && npm run coverage
```

## API（抜粋）

すべてWebSocket / RESTともに `Origin` ホワイトリスト検証・127.0.0.1限定公開の対象。

| メソッド・パス | 用途 |
|---------------|------|
| `GET /api/sessions` | セッション一覧（バックエンドがSSOT） |
| `POST /api/sessions` | セッション作成。ボディ `{ shell?: string }` は許可リストの `id` のみ受理（許可リスト外・任意パスは400） |
| `PATCH /api/sessions/:id` | セッション名変更。ボディ `{ title: string }`（1〜30文字・制御文字禁止、違反400・不存在404） |
| `DELETE /api/sessions/:id` | セッション破棄 |
| `GET /api/shells` | 利用可能シェルの許可リスト（`{ id, label, path }` の配列） |
| WebSocket `/ws?sessionId=<id>` | PTY入出力の同期（input / resize / replay / status / exit） |

`GET /api/shells` が返す `ShellInfo` は `{ id, label, path, args? }`。`args` はWindowsのwsl/powershell等の起動引数（バックエンドが検出時に構築する固定値。クライアントは `id` のみ指定でき、path/argsは注入できない）。

## 技術スタック

| 層 | 技術 |
|----|------|
| フロントエンド | React 19 (TypeScript) + Vite 8 |
| UI・スタイリング | shadcn/ui + Tailwind CSS v4（状態別の動的クラス切替） |
| ターミナル描画 | @xterm/xterm + @xterm/addon-webgl + @xterm/addon-fit |
| バックエンド | Node.js 22 (TypeScript) + Express 5 + ws |
| PTY管理 | node-pty |
| テスト | Vitest（backend 99 / frontend 46、カバレッジ80%閾値） |
| IaC | Terraform + kreuzwerker/docker provider（ローカル2コンテナ構築） |

## 既知の制限

- バックエンドプロセス（コンテナ）再起動後のセッション復元は非対応（ディスク永続化なし）
- 状態判定はヒューリスティック。プロンプト描画後に追加出力するカスタムシェルテーマでは誤判定がありうる
- Windows（powershell.exe）経路はWindowsホスト上での開発モード起動により手動確認する（Dockerコンテナ内はLinux/bash）
- シェル選択の候補はバックエンドの実行環境に依存する。Dockerコンテナ（Debian）ではbash / shのみ。zsh等を使うには開発モード（ホスト直接起動）またはコンテナへのシェル追加が必要

---
最終更新: 2026-07-25 13:49 JST
