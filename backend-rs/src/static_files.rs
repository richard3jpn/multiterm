use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

/// フロントエンドのビルド成果物。
///
/// release ビルドではバイナリへ埋め込まれ、単一exeで完結する。
/// debug ビルドでは実ファイルを読むため、`npm run build` し直せば再起動なしで反映される。
///
/// 注意: このフォルダが存在しないと **コンパイルが通らない**。
/// 先に `scripts\build-frontend.ps1` を実行すること。
#[derive(RustEmbed)]
#[folder = "../frontend/dist"]
struct Assets;

fn serve_asset(path: &str) -> Option<Response> {
    let asset = Assets::get(path)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    Some(([(header::CONTENT_TYPE, mime.as_ref())], asset.data).into_response())
}

/// 静的ファイル配信（axum の fallback）。
///
/// 単一ページアプリのため、実ファイルが無いパスは index.html を返す。
pub async fn serve(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(response) = serve_asset(path) {
        return response;
    }
    match serve_asset("index.html") {
        Some(response) => response,
        None => (StatusCode::NOT_FOUND, "フロントエンドがビルドされていません").into_response(),
    }
}
