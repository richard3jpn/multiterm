import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// Preact は React 互換レイヤーを使わない。JSX の変換先は tsconfig.app.json の
// jsxImportSource: "preact" を Vite（oxc）が読むため、プラグインは不要。
//
// 注意: 非ASCII文字を含むパス（このプロジェクトの OneDrive 配下）では rolldown が
// node_modules の bare import を解決できず、全依存が external 化された壊れた
// バンドルが出力される。ビルドは ASCII パスへ退避してから実行すること
// （scripts/start-windows.ps1 が自動化している）。
export default defineConfig({
  plugins: [tailwindcss()],
})
