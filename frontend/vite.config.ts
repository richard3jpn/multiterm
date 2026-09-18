import { readFileSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// ヘッダーに出すバージョン。package.json を唯一の出どころにして、二重管理を避ける
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

// Preact は React 互換レイヤーを使わない。JSX の変換先は tsconfig.app.json の
// jsxImportSource: "preact" を Vite（oxc）が読むため、プラグインは不要。
//
// 注意: 非ASCII文字を含むパス（このプロジェクトの OneDrive 配下）では rolldown が
// node_modules の bare import を解決できず、全依存が external 化された壊れた
// バンドルが出力される。ビルドは ASCII パスへ退避してから実行すること
// （scripts/start-windows.ps1 が自動化している）。
export default defineConfig({
  plugins: [tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
})
