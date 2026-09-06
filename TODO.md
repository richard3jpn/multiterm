# TODO（2026-09-07 更新・アプリ化とリソースモニタまで完了）

作業の記録と、この環境で踏んだ罠。

---

## 現在の状態

**すべてコミット・push 済み**（`origin/main`、最新 `9c483f1`）。

| Phase | 内容 | 主な変更先 |
|---|---|---|
| 34 | Alt+数字の序数を全ウィンドウ通しへ | `window-model.ts` / `Workspace.tsx` / `WindowView.tsx` / RDD 14.5 |
| 35 | ウィンドウ内のペイン配置変更（D&D） | `layout-tree.ts` / `TerminalPanel.tsx` / `use-workspace-windows.ts` / RDD 15章 |
| 36 | デスクトップアプリ化（workspace 分割 + wry） | ルート `Cargo.toml` / `backend-rs/src/lib.rs` / `app/` / RDD 16章 |
| 37 | リソースモニタ（sysinfo） | `metrics.rs` / `session_manager.rs` / `Sidebar.tsx` / RDD 17章 |
| 38 | OSのタイトルバーを消し、カスタムタイトルバーとアイコンを入れる | `app/src/main.rs` / `WindowControls.tsx` / `window-controls/ipc.ts` / RDD 16.6〜16.8 |
| 39 | タスクバーのアイコン（ICON_BIG）と、起動時のコンソール窓を修正 | `app/src/main.rs` / `backend-rs/src/lib.rs` / RDD 16.7〜16.9 |

`Sidebar.tsx` と `TerminalPanel.tsx` にあった前セッション由来の変更
（サイドバーの文字サイズを em 基準にしてフォント設定へ連動、フォント変更時に
非表示ウィンドウで `fit()` せず表示中は PTY へ resize を送る）は、
同じファイルに混在していて分離できなかったため Phase 34〜37 のコミットに含めた。

vitest 169件 GREEN（開始時140） / `tsc -b` 通過 / oxlint は既存の警告2件のみ /
`cargo build --release` はエラーなし（既存の dead_code 警告3件のみ）。
実機確認まで完了（詳細は BUILDLOG.md Phase 34〜39）。

---

## 未決

**リポジトリ直下の `MultiTerm起動.bat` の削除が未コミットのまま残っている。**

`README.md` が「プロジェクト直下の `MultiTerm起動.bat` をダブルクリックする」と
参照しているため、削除するなら README も直す必要がある。

`C:\Users\hirokiasano\scripts\` 配下の起動系はこのPCの Acronis 回避専用で、
リポジトリ版は汎用の `scripts\start-windows.ps1` を呼ぶ別物。**復元を推奨。**

---

## 起動

### アプリとして開く（Phase 36 で追加）

```
C:\dev\multiterm-target\release\multiterm-app.exe
```

独立した窓が開き、ブラウザは要らない。サーバも同じプロセスに同居する。
ビルドは `CARGO_TARGET_DIR=C:\dev\multiterm-target cargo build --release -p multiterm-app`。

### ブラウザで開く（従来）

| 方法 | 挙動 |
|---|---|
| `~\scripts\MultiTerm起動.vbs` | コンソール窓なし。ビルド後にブラウザが自動で開く。**停止は `multiterm\MultiTerm停止.bat`**（Ctrl+C する窓が無い） |
| `~\scripts\MultiTerm起動.bat` | コンソール窓が残り、ビルド進捗とエラーが見える |
| `~\scripts\multiterm-start.ps1` | 上2つが呼ぶ本体。`-SkipBuild` / `-Rebuild` / `-DebugBuild` |

ログは `~\scripts\logs\multiterm-start-<日時>.log`。

---

## 次にやれること

- **`build-frontend.ps1` の ASCIIパス退避を撤去する**（下記の罠を参照。効果は実証済み、未着手）
- **ウィンドウ間のセッション移動**（RDD 14.7 でスコープ外）。
  `build-windows.test.ts` の重複除去テストで排他所属の不変条件を固定してあるので、後から足しても壊れない
- **ウィンドウ構成のサーバ保存**（RDD 14.7 でスコープ外）
### Ubuntu機で `multiterm-app` を確認する（未着手・次にUbuntu機を触るとき）

コードは cfg 分岐済み（Linux では `WebViewBuilderExtUnix::build_gtk` で GTK のコンテナへ
WebView を入れる）だが、**Linux 上でビルド・起動した実績がまだ無い**。
Windows では動作確認済み（BUILDLOG Phase 36）。

**必要な開発パッケージ**（`multiterm-app` をビルドする場合のみ。backend だけなら不要）:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev pkg-config build-essential
```

**手順**:

```bash
cd frontend && npm ci && npm run build && cd ..   # rust-embed が dist を焼き込むので先に必要
cargo build --release -p multiterm-backend        # まずサーバだけ（gtk 無しで通るはず）
cargo build --release -p multiterm-app            # 窓つき
./target/release/multiterm-app
```

**確認すること**:

1. **`cargo build -p multiterm-backend` が gtk 系パッケージ無しで通る**（RDD 16.6 受け入れ基準1）。
   これが通らないなら、workspace の依存分離ができていない
2. 窓が開き、その中でターミナルが動く（シェルは `$SHELL` または bash / zsh）
3. 窓を閉じたあとに PTY の子プロセスが残らない（`ps -ef | grep bash` 等で確認）
4. リソースモニタの値が出る。**Linux では ConPTY と違い、シェルがバックエンドの直接の子として
   現れるはず**。和集合方式なのでどちらでも動くが、`app` の値がセッション分を二重計上して
   いないか見ておく（`sum_forest` の訪問済みチェックが効いていれば問題ない）
5. `build_gtk` の分岐が実際に通るか。X11 と Wayland の両方で試せるとなお良い
   （wry の Linux サポートは X11 が主。Wayland は `WebViewBuilderExtUnix` 経由が必要）

---

## この環境で踏んだ罠（再発しやすいもの）

- **稼働中は `cargo build --release` ができない**（exe を置き換えられず os error 5）。
  `rust-embed` が `frontend/dist` を実行ファイルへ焼き込む構成のため、
  フロントだけの変更でも反映には再起動が要る
- **Acronis Cyber Protect が `backend-rs\target\` 配下の exe をブロックする**（2026-09-03 確認）。
  release ビルドの exe は生成直後に削除され、起動時 0x800700E1、再ビルド時 LNK1104 になる。
  `CARGO_TARGET_DIR=C:\dev\multiterm-target` へ逃がすこと。
  **`cargo build` を直接叩くなら必ずこの環境変数を付ける**
- **ConPTY ではシェルがバックエンドの直接の子として現れない**（2026-09-07 確認）。
  `Win32_Process` で親を辿っても PowerShell は出てこない。
  リソース計測で「自分の子孫を辿るだけ」にすると、ターミナル分が丸ごと抜ける
- **ASCIIパス退避はこのPCではもう要らない**（2026-09-07 検証）。旧PCでは OneDrive 配下の
  日本語・全角中黒を含むパスだったが、移行後は `C:\Users\hirokiasano\multiterm` で全てASCII。
  `frontend` 直下で直接ビルドした生成物が、退避してビルドした dist とハッシュ・サイズまで一致した。
  **テストは `cd frontend && ./node_modules/.bin/vitest run` でよい**（`C:\Temp` へ行く必要はない）
- **workspace ではメンバー側の `[profile]` が無視される**。`[profile.release]` はルートの
  `Cargo.toml` にある。`backend-rs/Cargo.toml` に書き戻しても効かない
- `scripts/build-frontend.ps1` を **`2>&1` 付きで呼ぶと、ビルド成功でも失敗する**。
  PowerShell 5.1 が native コマンドの stderr を `NativeCommandError` に包み、
  スクリプトの `$ErrorActionPreference = 'Stop'` が発火して dist 反映前に中断する
- `npx tsc` は **TypeScript ではない別パッケージ（tsc@2.0.4）を落としてくる**。
  `./node_modules/.bin/tsc -b` を使うこと
- `npx tsc -b` と `npm test` を同一コマンドで連続実行すると vitest が失敗しやすい。別々に実行する
- ファイル削除は `Remove-Item -Force` 禁止。
  `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile/DeleteDirectory` で
  `SendToRecycleBin` を使う（CLAUDE.md）
- **git の user.name が未設定**。コミットすると author が `unknown` になる。
  `git -c user.name='浅野寛貴' -c user.email='h_asano@sas-com.com' commit` で揃える
