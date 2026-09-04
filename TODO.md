# TODO（2026-09-04 更新・ウィンドウ切り替えまで完了）

作業の記録と、この環境で踏んだ罠。

---

## 現在の状態

**すべてコミット・push 済み**（`origin/main`）。

| コミット | 内容 |
|---|---|
| `5890249` | 実行中を青・待機を黄へ入れ替え、画面全体の外枠を追加 |
| `561d484` | 待機・完了の色をオレンジ（`orange-300`）へ |
| `a153f4b` | ウィンドウ切り替えの純関数レイヤ |
| `8d7345e` | ウィンドウ切り替えをUIへ接続 |

vitest 140件 GREEN / `tsc -b` 通過 / oxlint は既存の警告2件のみ。
実機確認まで完了（詳細は BUILDLOG.md Phase 31〜33、要件は RDD.md 14章）。

---

## 未決

**リポジトリ直下の `MultiTerm起動.bat` の削除が未コミットのまま残っている。**

`README.md:60` が「プロジェクト直下の `MultiTerm起動.bat` をダブルクリックする」と
参照しているため、削除するなら README も直す必要がある。

`C:\Users\hirokiasano\scripts\MultiTerm起動.bat` はこのPCの Acronis 回避専用で
（`multiterm-start.ps1` を呼び、`C:\dev\multiterm-target` へビルドする）、
リポジトリ版は汎用の `scripts\start-windows.ps1` を呼ぶ別物。**復元を推奨。**

---

## 次にやれること（未着手。要望が出てから）

- **ウィンドウ間のセッション移動**（ドラッグ&ドロップ等）。RDD 14.7 でスコープ外にしている。
  `build-windows.test.ts` の重複除去テストで排他所属の不変条件を固定してあるので、
  後から足しても壊れない
- **ウィンドウ構成のサーバ保存**（RDD 14.7 でスコープ外）。
  別ブラウザ・別PCで同じ配置を再現したくなったとき

---

## この環境で踏んだ罠（再発しやすいもの）

- **稼働中は `cargo build --release` ができない**（exe を置き換えられず os error 5）。
  `rust-embed` が `frontend/dist` を実行ファイルへ焼き込む構成のため、
  フロントだけの変更でも反映には再起動が要る
- **`frontend/node_modules` は存在しない**。Vite 8 / rolldown が非ASCIIパス（OneDrive配下の
  日本語・全角中黒）で bare import を解決できないため、`scripts/build-frontend.ps1` が
  `C:\Temp\multiterm-frontend-build` へ robocopy してビルドする。
  **テストもそちらで実行する**（`cd /c/Temp/multiterm-frontend-build && ./node_modules/.bin/vitest run`）
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
