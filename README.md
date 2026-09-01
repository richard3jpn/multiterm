# MultiTerm（マルチターム）

ブラウザ上で動作するマルチターミナルアプリケーション。任意の数のターミナルを動的に立ち上げ、二分木レイアウトで自由に分割・リサイズできる。Claude Code等のAIエージェントとの協働を想定し、各ターミナルの状態をひと目で把握できる。

**単一の実行ファイルで動く。** Rust バイナリが PTY・WebSocket・画面配信をすべて担うため、起動するプロセスは1つ、使うポートも1つだけ（既定 127.0.0.1:3001）。実行時に Node.js は不要。

- 実行中（running）: 青い境界線
- 入力待ち（waiting-input）: 黄色の発光
- 待機（idle）: 落ち着いた緑の境界線

要件定義は [RDD.md](./RDD.md)、開発ログは [BUILDLOG.md](./BUILDLOG.md) を参照。

## 主な機能

- ターミナルの任意数起動・破棄（上限16、REST API + WebSocket）
- OS自動判定シェル（Windows: powershell.exe / Linux・macOS: $SHELL または bash）
- プロセス永続化: ブラウザをリロードしても既存セッションへ再接続し、画面バッファ（200KB/セッション）を復元
- 二分木レイアウト: 縦横分割・パネル削除・境界線ドラッグでのサイズ調整（localStorage保存、バックエンドをSSOTとして復元）
- 状態判定: バックエンドがPTY出力を監視（300ms静止 + 末尾行パターン）し、WebSocketで状態を配信
- **左サイドバー**: 開いているターミナルの一覧と、それぞれの状態を常時表示。行をクリックで切替、行から閉じる。上部に「入力待ち N / 実行中 N / 完了 N」を集約（下記「サイドバー」参照）
- テーマ: dark / light のプリセット切替（xterm配色も連動）
- 描画: xterm.js + WebGLアドオン（非対応環境は自動フォールバック）
- **フォント設定**: 等幅プリセット（System Mono / Consolas / Courier New）とサイズ（10〜20px）をヘッダーの設定（⚙）から変更。全ターミナルへ即時反映、localStorageに保存
- **シェル選択**: 新規ターミナルボタンの ▼、および分割ボタンから起動シェルを選択。バックエンドが検出した許可リストから選ぶ。Windows では cmd / PowerShell / WSL各ディストロ（zsh等・dotfile込み）
- **セッション名変更**: パネルのタイトルをクリックしてインライン編集（Enter確定 / Escキャンセル）。リロード後も維持
- **Alt+1〜9**: レイアウト上の並び順でターミナルへフォーカス移動

## サイドバー

分割が増えるとどのペインが入力待ちか見落としやすいため、ペインを切り替えずに全体を見渡せる一覧を左に置いている。各行は状態ドット・Alt番号・タイトル・シェル・状態ラベルを表示する。

| 表示 | 意味 |
|---|---|
| 黄（点滅） 入力待ち | 入力・承認を待っている。すぐ対応が必要 |
| 青 実行中 | コマンドが動いている |
| シアン 完了（未確認） | 実行が終わったが、そのターミナルをまだ見ていない |
| 緑 待機 | 確認済み、または最初から待機 |

「完了（未確認）」はそのターミナルを開くまで残る。別のペインを見ている間に終わった処理を見落とさないための表示で、行をクリックすると「待機」に戻る。ヘッダーにも最も注意が必要な状態が集約表示される。

なお「完了」と数えるのは、実行中から待機へ変わり、かつ実行が1秒以上続いた場合のみ。再接続時のリサイズ等による一瞬の再描画は対象外。

## セキュリティ

本アプリはPTYへの任意コマンド実行を提供するため、ローカル個人利用専用。

- WebSocket / REST ともに `Origin` ヘッダをホワイトリスト（環境変数 `ALLOWED_ORIGINS`）で検証
- 公開はループバック（127.0.0.1）限定。LANへの公開は禁止
- シェルは許可リストの `id` のみ受理。任意パス・任意引数はクライアントから注入できない（許可リスト外は400）

## セットアップ

### 前提

- **Rust**（stable-x86_64-pc-windows-msvc）と MSVC Build Tools — バックエンドのビルドに使用
- **Node.js** — フロントエンドのビルドにのみ使用。アプリの実行時には不要

### 起動

プロジェクト直下の `MultiTerm起動.bat` をダブルクリックする。フロントをビルドし、Rust バイナリをビルドして起動し、待ち受け開始した時点でブラウザを自動で開く。

PowerShell から実行する場合:

```powershell
cd scripts
.\start-windows.ps1              # 差分ビルドして起動
.\start-windows.ps1 -Rebuild     # フロントの npm ci からやり直す
.\start-windows.ps1 -SkipBuild   # ビルドを飛ばして起動だけ
```

ブラウザで http://127.0.0.1:3001 を開く。画面・REST API・WebSocket はすべてこのポートから配信される。停止は Ctrl+C、または `MultiTerm停止.bat`。

初回の release ビルド（LTO有効）は数分かかる。

### 選択できるシェル

実行環境から自動検出される。

- `cmd.exe`（コマンドプロンプト）/ `powershell.exe`（Windows PowerShell）/ `pwsh.exe`（導入時のみ）
- `wsl.exe -l -v` で列挙した各WSLディストロ × ログインシェル（例: Ubuntu-22.04 の zsh、`.zshrc` 込み）
- Linux / macOS では bash / zsh / fish / sh のうち実在するもの + `$SHELL`

### 開発モード（フロントのホットリロードが必要な場合）

フロントを編集しながら確認したい場合のみ、Vite の開発サーバを併用する。この場合だけ2プロセス・2ポートになる。

```powershell
# バックエンド（別ウィンドウ）
cd backend-rs
$env:PORT="3001"; $env:HOST="127.0.0.1"
$env:ALLOWED_ORIGINS="http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:5174,http://localhost:5174"
cargo run
```

```powershell
# フロント（別ウィンドウ）
cd frontend
$env:VITE_WS_URL="ws://127.0.0.1:3001"; $env:VITE_API_URL="http://127.0.0.1:3001"
npm install
npx vite --host 127.0.0.1 --port 5174 --strictPort
```

http://127.0.0.1:5174 を開く。`VITE_WS_URL` / `VITE_API_URL` を設定しない場合、フロントは配信元と同じオリジンへ接続する。

### ビルドについての注意

フロントのビルドは `scripts\build-frontend.ps1` が **ASCIIパス（`C:\Temp\multiterm-frontend-build`）へ退避してから**実行する。Vite 8 / rolldown は非ASCII文字を含むパス（本プロジェクトは OneDrive 配下で日本語を含む）で node_modules の bare import を解決できず、全依存が external 化された壊れたバンドルを出力するため。スクリプトは生成物に未解決の import が残っていないか検査してから `frontend\dist` へ戻す。

`start-windows.ps1` はこれを自動で呼ぶので、通常は意識しなくてよい。

### テスト

```powershell
cd backend-rs && cargo test
cd frontend && npm test && npm run coverage
```

## API（抜粋）

すべてWebSocket / RESTともに `Origin` ホワイトリスト検証・127.0.0.1限定公開の対象。

| メソッド・パス | 用途 |
|---------------|------|
| `GET /` | 画面（バイナリに埋め込まれたフロントを配信。未知のパスは index.html を返すSPAフォールバック） |
| `GET /api/health` | 死活確認 |
| `GET /api/sessions` | セッション一覧（バックエンドがSSOT） |
| `POST /api/sessions` | セッション作成。ボディ `{ shell?: string }` は許可リストの `id` のみ受理（許可リスト外・任意パスは400、上限超過は429） |
| `PATCH /api/sessions/:id` | セッション名変更。ボディ `{ title: string }`（1〜30文字・制御文字禁止、違反400・不存在404） |
| `DELETE /api/sessions/:id` | セッション破棄 |
| `GET /api/shells` | 利用可能シェルの許可リスト（`{ id, label, path, args? }` の配列） |
| WebSocket `/ws?sessionId=<id>` | PTY入出力の同期 |

`args` はWindowsのwsl/powershell等の起動引数（バックエンドが検出時に構築する固定値。クライアントは `id` のみ指定でき、path/argsは注入できない）。

### WebSocket プロトコル

タグ1バイト + ペイロードのバイナリフレーム。PTY出力をJSONでエスケープせず生バイトのまま流すため、大量出力時のオーバーヘッドが小さい。

**サーバ → クライアント**

| タグ | 種別 | ペイロード |
|---|---|---|
| `0x01` | data | PTY出力の生UTF-8バイト |
| `0x02` | replay | 再接続時のバッファ |
| `0x03` | status | 1バイト（0=running / 1=idle / 2=waiting-input） |
| `0x04` | exit | i32 LE |
| `0x05` | error | UTF-8メッセージ |

**クライアント → サーバ**

| タグ | 種別 | ペイロード |
|---|---|---|
| `0x01` | input | 生UTF-8バイト（8KB上限） |
| `0x02` | resize | u16 LE cols + u16 LE rows |

PTY出力は5ms窓でまとめて1フレームにして送る（WSフレーム数と xterm の write 呼び出しを削減）。

## 技術スタック

| 層 | 技術 |
|----|------|
| バックエンド | Rust + axum 0.8 + tokio |
| PTY管理 | portable-pty（Windows ConPTY / Unix openpty を同一APIで扱う） |
| 静的配信 | rust-embed（フロントのビルド成果物をバイナリへ埋め込み） |
| フロントエンド | Preact 10 (TypeScript) + Vite 8 |
| UI・スタイリング | Tailwind CSS v4 + 自前コンポーネント（状態別の動的クラス切替） |
| ターミナル描画 | @xterm/xterm + @xterm/addon-webgl + @xterm/addon-fit |
| テスト | cargo test（backend 78） / Vitest（frontend 69、カバレッジ80%閾値） |

## 実測値

Node.js 版（Express + node-pty + React、Vite常駐）からの移行結果。

| 指標 | 移行前 | 移行後 |
|---|---|---|
| 常駐メモリ（Private） | 233.8MB（node × 2プロセス） | **2.1MB（1プロセス）** |
| 使用ポート | 2（3001 + 5174） | **1（3001）** |
| 初回転送量（gzip換算） | 283.66 kB | **133.84 kB** |
| JSバンドル | 708.66 kB（gzip 198.70 kB） | 501.76 kB（gzip 135.03 kB） |
| npmパッケージ数 | 581 | 251 |
| 実行時の依存 | Node.js 22 が必要 | **不要（exe単体）** |

## 既知の制限

- バックエンドプロセス再起動後のセッション復元は非対応（ディスク永続化なし）
- 状態判定はヒューリスティック。プロンプト描画後に追加出力するカスタムシェルテーマでは誤判定がありうる
- WSLディストロの初回起動（コールドスタート）は約10秒かかるため、シェル検出のタイムアウトを20秒に設定している。起動直後の `GET /api/shells` が遅くなる場合がある
- フロントのビルドは非ASCIIパスで壊れるため、ASCIIパスへの退避が必須（上記「ビルドについての注意」）

---
最終更新: 2026-08-31
