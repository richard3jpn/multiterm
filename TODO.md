# TODO（2026-09-03 更新・配色を赤黄青へ作り直し）

作業を中断した地点と、次にやることの記録。

---

## 現在の状態

**3点の見た目の修正は実装済み・テスト通過。ただし画面未確認・未コミット。**

| 項目 | 状態 |
|---|---|
| コード変更 | 完了（7ファイル / +105 / -40） |
| `tsc -b` 型チェック | **通過** |
| `npm test` | **80件 GREEN**（既存77 + 新規3） |
| フロント `dist` | **ビルド済み**（732.7 KB） |
| release exe への反映 | **未反映** ← ここで止まっている（dist 09/03 10:34 に対し exe は 09/02 23:39） |
| 画面での確認 | 未実施 |
| コミット | **していない**（最後のコミットは `0b746a5` Ctrl+V 修正） |

`TODO.md` 自体も未追跡（`??`）。コミットするかは要判断。

### なぜ release exe へ反映できていないか

`rust-embed` が `frontend/dist` を実行ファイルへ埋め込む構成のため、
**dist を更新したら `cargo build --release` が必要**。
しかし**バックエンドが稼働中だと exe を置き換えられない**:

```
error: failed to remove file `...\target\release\multiterm-backend.exe`
Caused by: アクセスが拒否されました。 (os error 5)
```

再起動すると稼働中のセッションが失われるため、ユーザー判断で「ビルドだけしておく」を選択し、
フロントの dist 生成までで停止した。**Rust 側のソースは今回無変更**（変更はすべてフロント）。

---

## 次にやること

### 1. セッションを閉じてよいタイミングで、反映して画面確認

2026-09-03 10:34 時点で **5セッション稼働中（うち4つが実行中）**。
作成は 09/02 14:41〜14:49 で、昨日から動き続けている。
再起動するとすべて失われるため、閉じてよいタイミングをユーザーに確認すること。

反映するだけなら `MultiTerm起動.bat` を使うのが簡単。
`start-windows.ps1` が **build-frontend → cargo build --release → 起動**まで自動で行う
（Rust のビルドに2分ほどかかる）。

手動でやる場合:

```powershell
Get-Process multiterm-backend | Stop-Process -Force
cd backend-rs
cargo build --release
$env:PORT='3001'; $env:HOST='127.0.0.1'
$env:ALLOWED_ORIGINS='http://127.0.0.1:3001,http://localhost:3001'
Start-Process -FilePath '.\target\release\multiterm-backend.exe' -WindowStyle Minimized
```

確認する項目:

- [ ] ヘッダー帯が状態色で染まる。**不透明度40%でタイトルとシェル名が読めるか**（読みにくければ 25〜30% に下げる）
- [ ] 実行中の黄と待機の青が見分けられるか（**これが今回の主目的**）
- [ ] 入力待ちの赤が、実行中の黄と紛れないか
- [ ] 待機（青）が大半のとき、画面がうるさくないか
- [ ] サイドバーの2行目が `待機 · Windows PowerShell` の順になっているか
- [ ] 未接続時はヘッダーが従来のグレーのままか
- [ ] ライトテーマでも文字が読めるか（40%は暗いテーマ前提で選んでいる）
- [ ] サイドバー上部の集約カウント「完了 N」が出たとき、色では区別できない点が気にならないか
      （気になるなら done の機能ごと削除する選択肢がある）

### 2. 問題なければコミット・push

BUILDLOG.md に **Phase 30** として記録してからコミットする。

### 3. ウィンドウ切り替え機能（未着手）

**依頼内容**: 「今は一画面で分割でやってるけどウィンドウ切り替えも欲しい。
左のサイドバーでウィンドウ追加ボタンをおしたらあたらしいウィンドウがつくれるみたいな」

データモデルの変更を伴うため、着手前に下の「未確定事項」を潰す。

---

## 実装した内容（詳細）

### ① 配色を赤・黄・青の3系統へ

**経緯**: 当初は「実行中を紫に」で進めたが、ユーザーから
「色、赤系と黄色系と青」「今の緑と青の状態がほとんどでわかりにくい」との指摘があり、
**紫案は破棄して3系統に組み直した**。待機が大半を占めるため、待機を落ち着いた青にして
実行中（黄）・入力待ち（赤）だけが視界に飛び込むようにしている。

| 状態 | 色 |
|---|---|
| 入力待ち | **赤 `red-500`** + 点滅 |
| 実行中 | **黄 `amber-400`** |
| 完了（未確認） | **青 `blue-500`**（待機と同色） |
| 待機 | **青 `blue-500`** |

「完了（未確認）」はユーザー判断で**色だけ待機と同じ**にした。
判定ロジック・ラベル・サイドバー上部の集約カウント（`完了 N`）は残っているため、
**色では区別できないが数だけは分かる**という状態になっている。

| ファイル | 変更 |
|---|---|
| `features/status/status-style.ts` | 枠・ドット・ヘッダー帯を赤/黄/青へ。発光の rgba も対応する色に差し替え |
| `features/status/pane-state.ts` | `blocked`=赤+点滅 / `working`=黄 / `done`=青 / `idle`=青 |
| `components/Sidebar.tsx` | 集約カウントを `text-red-400` / `text-amber-400` / `text-blue-400` |
| `components/Workspace.tsx` | ヘッダー集約バッジを赤/黄/青へ |

### ② ターミナルヘッダー帯を状態色で染める

`features/status/status-style.ts` に `statusHeaderClasses()` を新規追加。

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

### ③ サイドバーの状態とシェル名の順序を入れ替え

`components/Sidebar.tsx`:

```diff
- {item.shellLabel} · {paneStateLabel(item.state)}
+ {paneStateLabel(item.state)} · {item.shellLabel}
```

### テストの更新

| ファイル | 内容 |
|---|---|
| `features/status/status-style.test.ts` | 枠・ドット・ヘッダーの検証を赤/黄/青へ。**新規3件**: `statusHeaderClasses` の検証、「実行中と待機が別色相」、「緑・紫・シアンを使わない」 |
| `features/status/pane-state.test.ts` | `blocked`=赤 / `working`=黄 / `idle`=青 / `done`=青（待機と同色であることを明示的に検証） |

---

## ウィンドウ切り替え機能の未確定事項

着手前に AskUserQuestion で確認する。

### 確認したいこと

1. **セッションの帰属**
   セッションは1つのウィンドウに属する？ それとも全ウィンドウで共有して、
   ウィンドウごとに「どれを並べるか」を選ぶだけ？

2. **ウィンドウを閉じたとき**
   中のセッション（シェルプロセス）も終了させる？ それとも残す？

3. **サイドバーの見せ方**
   - ウィンドウごとにグループ化して全部並べる
   - アクティブなウィンドウのセッションだけ出し、上部でウィンドウを切り替える
   - 上部にウィンドウのタブ、下にそのウィンドウのセッション一覧

4. **ウィンドウの名前**
   自動採番（Window 1, 2…）でよい？ ダブルクリックで改名できるようにする？

5. **Alt+数字の割り当て**
   現状はレイアウト上のペイン移動（RDD 9.6章）。
   ウィンドウ切り替えにも割り当てる？（例: Ctrl+数字 でウィンドウ、Alt+数字 でペイン）

6. **バックエンドに持たせるか**
   ウィンドウの構成をサーバー側で保持する？
   （現状レイアウトは localStorage のみ。別ブラウザ・別PCから開くと再現されない）

### 影響範囲の見積もり

| ファイル | 変更内容 |
|---|---|
| `features/layout/persistence.ts` | localStorage の構造を `LayoutNode` 単体 → ウィンドウ配列へ。**既存データのマイグレーションが必要**（現ユーザーのレイアウトを壊さない） |
| `features/layout/build-layout.ts` | 初期構築をウィンドウ単位に |
| `components/Workspace.tsx` | `layout` 単体 → `windows[]` + `activeWindowId`。分割・削除・Alt+数字の処理が全部この単位になる |
| `components/Sidebar.tsx` | ウィンドウの一覧表示、追加ボタン、切り替え |
| バックエンド | **仕様6で「持たせる」と決めた場合のみ** 変更。現状セッションはフラット管理なので、持たせないなら無変更 |

新規に純関数モジュール（例 `features/window/windows.ts`）を作り、
ウィンドウの追加・削除・切り替え・マイグレーションをテスト可能にするのが既存パターンに沿う。

---

## この環境で踏んだ罠（再発しやすいもの）

- **稼働中は `cargo build --release` ができない**（exe を置き換えられず os error 5）。
  dist を変えたら Rust の再ビルドが要るので、フロントだけの変更でも再起動が必要になる。
- `scripts/build-frontend.ps1` を **`2>&1` 付きで呼ぶと、ビルド成功でも失敗する**。
  PowerShell 5.1 が native コマンドの stderr を `NativeCommandError` に包み、
  スクリプトの `$ErrorActionPreference = 'Stop'` が発火して dist 反映前に中断する。
- `npx tsc -b` と `npm test` を同一コマンドで連続実行すると vitest が失敗しやすい。
  別々に実行する。
- Vite 8 / rolldown は非ASCIIパスで bare import を解決できない。
  そのため `build-frontend.ps1` が `C:\Temp\multiterm-frontend-build` へ退避してビルドする。
- ファイル削除は `Remove-Item -Force` 禁止。
  `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile/DeleteDirectory` で
  `SendToRecycleBin` を使う（CLAUDE.md）。

### 環境負荷について

2026-09-03 朝の計測: メモリ空き **0.62 GB** / 15.63 GB、node **63プロセス**（合計 774 MB）。
前日夜（CPU 97%・空き 1.51 GB）のときは vitest がワーカーを起動できず
`[vitest-pool]: Failed to start forks worker` で全11ファイルが失敗した。
朝の再実行では 79件 GREEN で通ったため、**恒常的な問題ではなく負荷次第**
（その後の配色作り直しで 80件に増え、これも通っている）。
node の大半は 09/02 23:35 頃から存在しており、vitest の残留ではない。
