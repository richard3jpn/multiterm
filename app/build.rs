//! Windows の実行ファイルへアイコンを埋め込む（RDD 16章）。
//!
//! タスクバー・エクスプローラー・ウィンドウのアイコンは、Windows では exe の
//! リソースから取られる。ウィンドウ側で個別に指定しなくても、これだけで全部に反映される。

fn main() {
    #[cfg(windows)]
    {
        // フロントの favicon をそのまま使う。7サイズ入りの ICO なので、
        // タスクバー（32px）・エクスプローラーの大アイコン（256px）まで賄える
        let mut resource = winresource::WindowsResource::new();
        resource.set_icon("../frontend/public/favicon.ico");
        if let Err(error) = resource.compile() {
            // アイコンが無くてもアプリ自体は動く。ビルドは止めない
            println!("cargo:warning=アイコンの埋め込みに失敗しました: {error}");
        }
    }
    // ICO を差し替えたときに再ビルドされるようにする
    println!("cargo:rerun-if-changed=../frontend/public/favicon.ico");
}
