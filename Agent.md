
# プロジェクト README（AI Agent 実行用）

このフォルダで **AI Agent** に本ドキュメントを読ませ、要件定義書（RDD.md）に基づいて、フルスタックWebアプリケーションを0から自動生成します。

## 基本設定
- **プロジェクト名**: RDD.md に記載（MultiTerm）
- **フロントエンド**: React (TypeScript)
- **UI・スタイリング**: shadcn/ui + Tailwind CSS（状態に応じた動的なクラス切り替えでエフェクトを制御）
- **ターミナル描画**: xterm.js（WebGLアドオン併用。npm パッケージは `@xterm/xterm` / `@xterm/addon-webgl`）
- **バックエンド**: Node.js (TypeScript) + Express.js
- **PTY管理**: node-pty（OS自動判定でシェルを起動。Windows: powershell.exe / Ubuntu・macOS: bash または zsh）
- **通信プロトコル**: WebSocket（`ws`。バックエンドのPTYとフロントエンドの入出力を同期）
- **データベース**: 不要（RDD.md にデータ永続化要件なし。セッション状態・プロセスはバックエンドプロセス内で保持）
- **IaC**: Terraform + Docker provider（バックエンド・フロントエンドをコンテナとしてローカルに構築。`terraform/` で管理）
- **生成先ディレクトリ名**: RDD.md に記載（未指定の場合はプロジェクト名をケバブケースに変換）
- **グローバルインストールや sudo は使わないでください。ホーム配下の設定も変更しないでください。**
- **作業ログは BUILDLOG.md に残してください。**

> 重要方針: **ユーザ環境を汚さない**（グローバルインストール禁止・ホーム配下の設定ファイルに変更禁止・sudo 使用禁止）。すべて **現在のプロジェクト配下だけ** で完結させてください。
>
> **例外**: Node.js・Docker・Terraform 等の **環境構築に必要なツールのインストールのみ**、グローバルインストール・sudo の使用を許可する。
>
> **クロスプラットフォーム要件（RDD.md 非機能要件）**: バックエンドは Windows と Ubuntu の双方で **同一コード** で動作すること。コンテナ（Linux）だけでなく、Windows 上での直接起動（開発モード）でも動くよう、node-pty のシェル判定を `os.platform()` で分岐させる。
>
> **クラウド対応**: 現時点ではローカル（Docker）構築のみ。クラウド化の要望が出た場合に `terraform/envs/prod` 等として拡張する。

---

## 1. ゴール

RDD.md に定義された要件を実装し、起動可能な状態で引き渡す。

### 実装範囲（MVP）
RDD.md の「実装範囲」「MVP」セクションに従う。記載がない場合は Agent がユーザーに確認する。

### 除外機能
RDD.md の「除外機能」「スコープ外」セクションに従う。記載がない場合は Agent がユーザーに確認する。

---

## 2. プロジェクト構成

```
<project-slug>/
├── frontend/          # React (TypeScript) + Vite
│   ├── src/
│   │   ├── components/   # 再利用可能なコンポーネント（shadcn/ui ベース）
│   │   │   └── ui/       # shadcn/ui 生成コンポーネント
│   │   ├── features/     # ターミナル・レイアウト等の機能単位モジュール
│   │   ├── services/     # WebSocket 通信
│   │   ├── types/        # TypeScript型定義
│   │   ├── contexts/     # Context API（セッション・レイアウト・テーマ状態管理）
│   │   └── App.tsx
│   ├── Dockerfile        # フロントエンド用コンテナ定義
│   └── package.json
├── backend/           # Node.js (TypeScript)
│   ├── src/
│   │   ├── routes/       # REST APIルート（セッション作成等）
│   │   ├── controllers/  # コントローラー
│   │   ├── pty/          # node-pty セッション管理（生成・永続化・破棄）
│   │   ├── ws/           # WebSocket ハンドラ（PTY入出力の中継）
│   │   ├── monitor/      # 出力ストリーム監視・状態判定（Running / Idle / Waiting Input）
│   │   └── server.ts
│   ├── Dockerfile        # バックエンド用コンテナ定義
│   └── package.json
├── terraform/         # IaC（Terraform + Docker provider、ローカル構築）
│   ├── main.tf           # コンテナ・ネットワーク定義
│   ├── variables.tf      # 変数定義
│   ├── outputs.tf        # 各サービスURL等の出力
│   └── terraform.tfvars.example  # 変数サンプル（terraform.tfvars 本体はコミット禁止）
├── BUILDLOG.md
└── README.md
```

---

## 3. 実行前チェック（Agent のやること）

### 3.1. 環境チェック（必須）

以下のツールを **インストールコマンドで確認・インストールする**（既にインストール済みならスキップされる）。

```bash
sudo apt install -y nodejs npm

# Docker（コンテナ実行基盤）
sudo apt install -y docker.io
sudo service docker start       # WSL2 等でデーモンが起動していない場合
sudo usermod -aG docker $USER   # docker.sock の権限エラーが出る場合のみ（再ログインが必要）

# node-pty のビルドに必要なツールチェーン（ネイティブモジュール）
sudo apt install -y build-essential python3

# Terraform（HashiCorp 公式 APT リポジトリから。https://developer.hashicorp.com/terraform/install 参照）
wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install -y terraform
```

> この環境チェックでのインストールのみ、グローバルインストール・sudo の使用を許可する。

### 3.2. プロジェクト準備

1. **RDD.md を読み込み、要件を把握する**
2. **作業ディレクトリを固定**: 現在のフォルダをルートとし、生成物はプロジェクトディレクトリ以下に作る。
3. **禁止事項を遵守**（環境構築を除く）:
   - `npm i -g ...` / `yarn global add ...` の禁止
   - `sudo` の禁止
   - `~/.zshrc`、`~/.bashrc`、`~/.npmrc` などホーム配下の編集禁止
   - OS やシェルのグローバル設定変更禁止
4. **ログ**: `BUILDLOG.md` を新規作成し、以降のコマンドと結果要約を逐次追記。

---

## 3.5. 開発前チェックリスト（Agent が必ず確認）

RDD.md を読んだ後、以下の項目がすべて揃っているか確認する。
**不足がある場合はユーザーに質問し、すべて埋まってから開発を開始すること。**

| # | チェック項目 | 確認内容 |
|---|---|---|
| 1 | プロジェクト名・ディレクトリ名 | 生成先のディレクトリ名が決まっているか |
| 2 | アプリの概要・目的 | 何をするアプリか明確か |
| 3 | MVP範囲（実装する機能リスト） | どの機能を実装するか具体的に列挙されているか |
| 4 | 除外機能（やらないこと） | スコープ外が明示されているか |
| 5 | セッション・状態モデル | ターミナルセッション・レイアウト・状態（Running / Idle / Waiting Input）のデータ構造が定義できるか |
| 6 | 画面構成（ページ一覧） | どんな画面が必要か一覧があるか |
| 7 | 認証の有無と方式 | 認証が必要か、必要なら方式（JWT等）は何か |
| 8 | ユーザー権限・ロール | 権限の種類と各権限でできることが明確か |
| 9 | 技術スタックの変更希望 | デフォルト構成（React + shadcn/ui + Tailwind CSS + xterm.js + Express + node-pty + WebSocket）でよいか |
| 10 | 外部サービス連携 | 外部API・サービスとの連携が必要か |
| 11 | デプロイ先 | ローカル（Terraform + Docker、デフォルト）でよいか。クラウド化の要望がある場合はユーザーと構成を相談する |

### 運用フロー

1. Agent が RDD.md を読み込む
2. 上記チェックリストと照合し、不足項目を洗い出す
3. 不足がある場合 → ユーザーに質問して情報を収集する
4. すべて揃ったら → 開発を開始する

---

## 4. プロジェクト生成手順

### ステップ1: プロジェクトルート作成

```bash
mkdir <project-slug>
cd <project-slug>
```

### ステップ2: フロントエンド生成

shadcn/ui は Vite 構成を公式サポートしているため、Vite で React + TypeScript プロジェクトを作成する。

```bash
# React + TypeScript プロジェクト作成（Vite）
npm create vite@latest frontend -- --template react-ts

cd frontend
npm install

# Tailwind CSS をインストール（Vite プラグイン方式）
npm i tailwindcss @tailwindcss/vite

# shadcn/ui を初期化（コンポーネントは必要に応じて npx shadcn@latest add <name> で追加）
npx shadcn@latest init

# ターミナル描画: xterm.js + WebGLアドオン + フィットアドオン
npm i @xterm/xterm @xterm/addon-webgl @xterm/addon-fit

# 開発補助
npm i -D eslint prettier eslint-config-prettier
```

> セットアップの詳細手順（tsconfig のパスエイリアス設定等）は shadcn/ui 公式ドキュメント（https://ui.shadcn.com/docs/installation/vite）で確認すること。

### ステップ3: バックエンド生成

```bash
cd ../
mkdir backend
cd backend

# package.json 初期化
npm init -y

# 基本ライブラリ: Express + WebSocket + PTY
npm i express cors dotenv ws node-pty
npm i -D typescript @types/node @types/express @types/cors @types/ws ts-node nodemon

# TypeScript 設定
npx tsc --init
```

> node-pty はネイティブモジュールのため、ビルドツールチェーン（build-essential / python3、Windows は windows-build-tools 相当）が必要。RDD.md のクロスプラットフォーム要件に従い、シェルの選択は `os.platform() === 'win32' ? 'powershell.exe' : (bash または zsh)` のように OS 判定で分岐させる。

#### tsconfig.json 設定
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

#### package.json スクリプト追加
```json
{
  "scripts": {
    "dev": "nodemon src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  }
}
```

### ステップ4: Dockerfile と Terraform 構成の作成

#### backend/Dockerfile

node-pty のビルドに必要なツールチェーンを含めるため、alpine ではなく Debian ベースのイメージを使用する。

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

#### frontend/Dockerfile

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_WS_URL
ARG VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

#### terraform/main.tf（骨子）

ポート等は RDD.md の要件に応じて調整する。リソースの詳細構文はプロバイダ公式ドキュメント（https://registry.terraform.io/providers/kreuzwerker/docker）で確認すること。

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 4.0" # 2026-07 時点の最新は 4.5.0
    }
  }
}

provider "docker" {}

resource "docker_network" "app" {
  name = "${var.project_slug}-net"
}

# --- バックエンド（PTY管理 + WebSocket）---
resource "docker_image" "backend" {
  name = "${var.project_slug}-backend:latest"
  build {
    context = abspath("${path.module}/../backend")
  }
}

resource "docker_container" "backend" {
  name  = "${var.project_slug}-backend"
  image = docker_image.backend.image_id
  env = [
    "PORT=${var.backend_port}",
    "ALLOWED_ORIGINS=http://localhost:${var.frontend_port},http://127.0.0.1:${var.frontend_port}", # RDD.md 5章9項: Origin検証ホワイトリスト
  ]
  ports {
    internal = var.backend_port
    external = var.backend_port
    ip       = "127.0.0.1" # RDD.md 8章: ループバック限定公開（LAN公開禁止）
  }
  networks_advanced {
    name    = docker_network.app.name
    aliases = ["backend"]
  }
}

# --- フロントエンド ---
resource "docker_image" "frontend" {
  name = "${var.project_slug}-frontend:latest"
  build {
    context = abspath("${path.module}/../frontend")
    build_args = {
      VITE_WS_URL  = "ws://localhost:${var.backend_port}"
      VITE_API_URL = "http://localhost:${var.backend_port}"
    }
  }
}

resource "docker_container" "frontend" {
  name  = "${var.project_slug}-frontend"
  image = docker_image.frontend.image_id
  ports {
    internal = 80
    external = var.frontend_port
    ip       = "127.0.0.1" # RDD.md 8章: ループバック限定公開
  }
  networks_advanced {
    name = docker_network.app.name
  }
  depends_on = [docker_container.backend]
}
```

#### terraform/variables.tf

```hcl
variable "project_slug" {
  type = string
}

variable "backend_port" {
  type    = number
  default = 3001
}

variable "frontend_port" {
  type    = number
  default = 3000
}
```

#### terraform/outputs.tf

```hcl
output "frontend_url" {
  value = "http://localhost:${var.frontend_port}"
}

output "backend_ws_url" {
  value = "ws://localhost:${var.backend_port}"
}
```

#### terraform/terraform.tfvars.example

```hcl
project_slug = "<project-slug>"
```

> **注意**: コンテナ内で起動するシェルは Linux（bash）になる。RDD.md の Windows シェル（powershell.exe）対応を検証する場合は、開発モード（後述）で Windows ホスト上から直接バックエンドを起動すること。

---

## 5. バックエンド実装

### ディレクトリ構造

RDD.md の機能一覧に応じて、以下のような構成でモジュールを作成する。

```
backend/src/
├── server.ts              # エントリーポイント（HTTP + WebSocket サーバ起動）
├── config/
│   └── index.ts           # ポート・シェル判定等の設定
├── pty/
│   └── session-manager.ts # node-pty セッションの生成・保持・破棄（リロード時の復元用に永続化）
├── ws/
│   └── handler.ts         # WebSocket ↔ PTY の入出力中継
├── monitor/
│   └── state-detector.ts  # stdout 監視・プロンプト検知（> や ?）による状態判定
├── routes/                # セッション一覧・作成・削除等の REST API
├── controllers/           # 各ルートのコントローラー
└── types/
    └── index.ts           # 型定義
```

### 主要機能

RDD.md の機能要件に対応して実装する。

- **セッション管理**: 任意数のターミナルセッションを動的に作成・破棄。バックエンドでプロセスを維持し、ブラウザリロード時に既存セッションへ再接続できる
- **マルチOS・マルチシェル対応**: `os.platform()` による OS 自動判定で powershell.exe / bash / zsh を起動
- **PTY通信**: WebSocket 経由で PTY の入出力をフロントエンドと同期
- **状態判定**: stdout ストリームを監視し、プロンプトパターン（例: `>`、`?`）から Running / Idle / Waiting Input を判定してフロントエンドへ通知
- **状態検知の軽量化（RDD.md 非機能要件)**: 大量ログ出力時にボトルネックにならないよう、正規表現による検知を最適化する（出力末尾のみの評価・デバウンス等）

---

## 6. フロントエンド実装

### 画面構成

RDD.md の画面構成・機能一覧に基づいてコンポーネントを作成する。

- **ターミナルパネル**: xterm.js（`@xterm/xterm` + `@xterm/addon-webgl`）で描画。WebGLアドオンにより大量ログ出力時の描画遅延を防ぐ（RDD.md 非機能要件）
- **レイアウト管理**: 縦横分割（二分木モデル）の動的切り替え、境界線ドラッグによるパネルサイズ調整（グリッド配置は RDD.md 6章によりスコープ外）
- **状態可視化**: バックエンドから通知される状態に応じ、Tailwind CSS の動的クラス切り替えでスタイリング
  - 実行中（Running）: 境界線が青く脈打つ（パルス効果）
  - 入力待ち（Waiting）: 全体が黄色く発光
  - 完了/待機（Idle）: 落ち着いた緑色の境界線
- **テーマ切替**: プリセットテーマ（dark / light）の一括切替UI（shadcn/ui コンポーネントを使用。背景画像・透明度カスタマイズは RDD.md 6章によりスコープ外）

### コンポーネント

shadcn/ui をベースに、RDD.md の要件に応じて再利用可能なコンポーネントを作成する。

### 状態管理

Context APIを使用（RDD.md で別途指定がある場合はそちらに従う）。

---

## 7. 環境変数設定

コンテナ実行時の環境変数は Terraform（main.tf の `env` / `build_args`）が注入する。以下の `.env` は開発モード（ローカル直接起動）用。

### backend/.env.example
```
PORT=<任意のポート番号>
NODE_ENV=development
# RDD.md 5章9項: WS Origin検証・CORSのホワイトリスト（カンマ区切り。開発モードはVite開発サーバのオリジン）
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### frontend/.env.example
```
VITE_WS_URL=ws://localhost:<バックエンドのポート番号>
VITE_API_URL=http://localhost:<バックエンドのポート番号>
```

---

## 8. 必須検証手順（完成前に必ず実行）

### インフラ構築（Terraform）
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # 値を設定（コミット禁止）
terraform init
terraform validate
terraform plan
terraform apply -auto-approve

docker ps   # backend / frontend の2コンテナが Up であることを確認
```

### バックエンド確認
```bash
curl http://localhost:<backend_port>/api/sessions
# セッション管理 API が応答することを確認

# WebSocket 接続確認（例: wscat やブラウザ DevTools で ws://localhost:<backend_port> に接続）
```

### フロントエンド確認
ブラウザで `http://localhost:<frontend_port>` を開き、以下を確認する。

1. ターミナルが表示され、コマンド入力・出力が反映される
2. ターミナルを複数起動でき、レイアウト分割・パネルサイズ変更が動作する
3. コマンド実行中・入力待ち・待機で枠の色（青パルス / 黄発光 / 緑）が切り替わる
4. ブラウザをリロードしてもセッションが復元される

### 動作テスト
RDD.md に記載された主要機能が正常に動作することを確認する。

### 開発モード（ホットリロードが必要な場合）
```bash
cd backend && npm run dev
cd frontend && npm run dev    # Vite 開発サーバ
```

> Windows シェル（powershell.exe）対応の検証は、Windows ホスト上でこの開発モードを直接起動して行う。

### クリーンアップ
```bash
cd terraform
terraform destroy -auto-approve   # コンテナ・ネットワークを全削除
```

---

## 9. 期待される成果物

```
<project-slug>/
├── frontend/              # フロントエンド（起動可能）
├── backend/               # バックエンド（PTY管理 + WebSocket、起動可能）
├── terraform/             # IaC（terraform apply で全体起動可能）
├── BUILDLOG.md           # 開発ログ
└── README.md             # セットアップ手順
```

---

## 10. DO / DON'T

**DO**
- RDD.md を最初に読み、要件を正確に把握する
- ローカルのみで完結するコマンドを使用
- ロックファイル（`package-lock.json`、`.terraform.lock.hcl`）をコミット
- `terraform fmt` と `terraform validate` を通してからコミット
- 依存追加・スクリプト変更は `BUILDLOG.md` に都度記録
- エラーハンドリングを適切に実装
- TypeScriptの型定義を厳密に

**DON'T**
- グローバルインストール（`-g`）や `sudo` の使用
- ホーム配下や他プロジェクトの設定変更
- 秘密情報のコミット（`.env`・`terraform.tfvars` の直コミット禁止）
- `*.tfstate`・`.terraform/` のコミット（`.gitignore` に追加する）
- RDD.md に記載のない機能の過剰実装（MVPに集中）

---

## 11. README.md の雛形（自動生成して配置）

```md
# <プロジェクト名>

<RDD.md から概要を記載>

## セットアップ

### 1. インフラ構築（Terraform + Docker）
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集して設定
terraform init
terraform apply
```
バックエンド・フロントエンドがコンテナとして起動する。

### 2. 開発モードで起動する場合（任意）
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

## 技術スタック
<RDD.md の指定に基づき記載>
```

---

## 12. トラブルシュート

- **node-pty のビルドエラー**: build-essential / python3（Windows は Visual Studio Build Tools）がインストールされているか確認。Node.js のバージョンと prebuilt バイナリの対応も確認
- **Docker デーモン未起動**: `sudo service docker start`（WSL2）または Docker Desktop を起動
- **docker.sock の権限エラー**: `sudo usermod -aG docker $USER` 後に再ログイン
- **ポート競合**: `terraform.tfvars` のポート番号を変更して `terraform apply`
- **WebSocket 接続エラー**: `VITE_WS_URL` がバックエンドのポートと一致しているか確認。ブラウザ DevTools の Network タブで WS ハンドシェイクを確認
- **ターミナル描画の遅延**: WebGLアドオン（`@xterm/addon-webgl`）が有効化されているか確認。非対応環境ではフォールバック（canvas / DOM レンダラ）を検討
- **状態判定が誤動作する**: `monitor/state-detector.ts` のプロンプト検知パターンと対象シェル・ツールのプロンプト形式が一致しているか確認
- **CORS エラー**: バックエンドの CORS 設定を確認
- **ビルドエラー**: TypeScript型エラーを確認

---

**文書バージョン**: 3.0（RDD.md（MultiTerm）の技術スタックに準拠: shadcn/ui + Tailwind CSS / xterm.js / node-pty / WebSocket、DBレス構成）
**対応要件定義**: RDD.md（MultiTerm）
