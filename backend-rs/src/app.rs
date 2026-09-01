use crate::pty::session_manager::SessionManager;
use crate::routes::sessions;
use crate::security::origin::is_origin_allowed;
use crate::static_files;
use crate::types::{ApiResponse, ShellInfo};
use crate::ws;
use axum::extract::{Request, State};
use axum::http::{header, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// シェル検出がまだ動いているかをクライアントへ伝えるヘッダ。
/// `detecting` の間は一覧が増える可能性があるため、クライアントは後で取り直す。
pub const SHELL_DETECTION_HEADER: &str = "x-shell-detection";

/// 利用可能シェルの許可リスト。
///
/// WSLディストロの検出はコールドスタートで10秒以上かかることがある。
/// サーバの起動を待たせないよう、まず即座に使えるシェル（cmd / powershell 等）で
/// 公開し、検出が終わったら差し替える。
#[derive(Clone)]
pub struct ShellRegistry {
    shells: Arc<RwLock<Vec<ShellInfo>>>,
    /// 時間のかかる検出（WSL等）がまだ動いているか。クライアントの再取得判断に使う
    detecting: Arc<AtomicBool>,
}

impl ShellRegistry {
    pub fn new(initial: Vec<ShellInfo>, detecting: bool) -> Self {
        Self {
            shells: Arc::new(RwLock::new(initial)),
            detecting: Arc::new(AtomicBool::new(detecting)),
        }
    }

    pub fn snapshot(&self) -> Vec<ShellInfo> {
        self.shells.read().unwrap().clone()
    }

    pub fn is_detecting(&self) -> bool {
        self.detecting.load(Ordering::SeqCst)
    }

    /// 検出結果で置き換え、検出中フラグを下ろす
    pub fn finish(&self, shells: Vec<ShellInfo>) {
        *self.shells.write().unwrap() = shells;
        self.detecting.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub allowed_origins: Arc<Vec<String>>,
    pub shells: ShellRegistry,
}

/// サーバ側Origin強制（RDD.md 5章9項）。
///
/// CORSヘッダ付与とは別に、非許可Originからの単純リクエスト（CSRF経由のセッション量産等）を
/// 403で遮断する。Originヘッダなし（同一オリジン・curl等）は許可。
async fn enforce_origin(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let origin = request.headers().get(header::ORIGIN).and_then(|value| value.to_str().ok());
    if origin.is_some() && !is_origin_allowed(origin, &state.allowed_origins) {
        return (
            StatusCode::FORBIDDEN,
            Json(ApiResponse::<()>::fail("許可されていないオリジンです")),
        )
            .into_response();
    }
    next.run(request).await
}

async fn health() -> Response {
    (StatusCode::OK, Json(ApiResponse::ok("ok"))).into_response()
}

/// RDD 9.2章: 利用可能シェルの許可リスト
async fn shells(State(state): State<AppState>) -> Response {
    let detecting = if state.shells.is_detecting() { "detecting" } else { "complete" };
    (
        StatusCode::OK,
        [(SHELL_DETECTION_HEADER, detecting)],
        Json(ApiResponse::ok(state.shells.snapshot())),
    )
        .into_response()
}

/// RDD.md 5章12項: CORSはホワイトリストのオリジンのみ許可
pub fn create_app(state: AppState) -> Router {
    let origins: Vec<HeaderValue> = state
        .allowed_origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE])
        // 開発モード（別オリジンのVite）からも検出状況を読めるようにする
        .expose_headers([HeaderName::from_static(SHELL_DETECTION_HEADER)]);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/shells", get(shells))
        .nest("/api/sessions", sessions::router())
        .route("/ws", get(ws::handler::ws_route))
        // 画面もこのバイナリから配信する（フロント用の別プロセス・別ポートは不要）
        .fallback(static_files::serve)
        .layer(cors)
        .layer(middleware::from_fn_with_state(state.clone(), enforce_origin))
        .with_state(state)
}
