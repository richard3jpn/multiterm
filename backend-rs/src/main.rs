//! `multiterm-backend`: サーバだけを起動する実行ファイル（RDD 16章）。
//!
//! 画面はブラウザで開く。デスクトップの窓を持つ版は `multiterm-app`。
//! 本体は `lib.rs` の `serve` にあり、ここは停止条件を Ctrl+C / SIGTERM に
//! 決めているだけの入口。

#[tokio::main]
async fn main() {
    // 待ち受け開始のログは serve が出すので、ここで受け取っても足すことは無い
    if let Err(error) = multiterm_backend::serve(|_| {}, multiterm_backend::shutdown_signal()).await
    {
        eprintln!("[multiterm] {error}");
        std::process::exit(1);
    }
}
