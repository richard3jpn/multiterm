use crate::app::AppState;
use crate::pty::session_manager::SessionError;
use crate::pty::shell_registry::resolve_shell;
use crate::types::{ApiResponse, SessionInfo};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch};
use axum::{Json, Router};
use regex::Regex;
use serde::Deserialize;
use std::sync::OnceLock;

const TITLE_MAX_LENGTH: usize = 30;

fn uuid_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()
    })
}

/// RDD 9.3章: 1〜30文字（コードポイント単位）・制御文字禁止・前後トリム。不正はNone
pub fn sanitize_title(raw: Option<&str>) -> Option<String> {
    let title = raw?.trim();
    let length = title.chars().count();
    if !(1..=TITLE_MAX_LENGTH).contains(&length) {
        return None;
    }
    if title.chars().any(|c| c.is_control() || c == '\u{7f}') {
        return None;
    }
    Some(title.to_string())
}

fn ok<T: serde::Serialize>(status: StatusCode, data: T) -> Response {
    (status, Json(ApiResponse::ok(data))).into_response()
}

fn fail(status: StatusCode, error: &str) -> Response {
    (status, Json(ApiResponse::<()>::fail(error))).into_response()
}

#[derive(Debug, Deserialize)]
pub struct CreateSessionBody {
    pub shell: Option<String>,
}

/// セッション管理 REST API（RDD 5章1項・9章）
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_sessions).post(create_session))
        .route("/{id}", patch(rename_session).delete(delete_session))
}

async fn list_sessions(State(state): State<AppState>) -> Response {
    ok(StatusCode::OK, state.manager.list())
}

async fn create_session(
    State(state): State<AppState>,
    body: Option<Json<CreateSessionBody>>,
) -> Response {
    let requested = body.and_then(|Json(body)| body.shell);
    let shell = match requested {
        Some(id) => {
            // RDD 9.2章: 許可リストのidのみ受理。リスト外・任意パスは400
            let available = state.shells.snapshot();
            match resolve_shell(&id, &available) {
                Some(shell) => Some(shell.clone()),
                None => return fail(StatusCode::BAD_REQUEST, "指定されたシェルは利用できません"),
            }
        }
        None => None,
    };
    match state.manager.create(shell.as_ref()) {
        Ok(session) => ok(StatusCode::CREATED, session),
        Err(SessionError::LimitReached(message)) => {
            fail(StatusCode::TOO_MANY_REQUESTS, &message)
        }
        Err(error) => {
            eprintln!("[multiterm] session create failed: {}", error.message());
            fail(StatusCode::INTERNAL_SERVER_ERROR, "サーバ内部エラーが発生しました")
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RenameBody {
    pub title: Option<String>,
}

async fn rename_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<RenameBody>>,
) -> Response {
    if !uuid_pattern().is_match(&id) {
        return fail(StatusCode::BAD_REQUEST, "セッションIDの形式が不正です");
    }
    let raw = body.and_then(|Json(body)| body.title);
    let Some(title) = sanitize_title(raw.as_deref()) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "セッション名は1〜30文字で、制御文字は使用できません",
        );
    };
    match state.manager.rename(&id, &title) {
        Ok(session) => ok::<SessionInfo>(StatusCode::OK, session),
        Err(SessionError::NotFound(message)) => fail(StatusCode::NOT_FOUND, &message),
        Err(error) => fail(StatusCode::INTERNAL_SERVER_ERROR, error.message()),
    }
}

#[derive(serde::Serialize)]
struct DeletedSession {
    id: String,
}

async fn delete_session(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    if !uuid_pattern().is_match(&id) {
        return fail(StatusCode::BAD_REQUEST, "セッションIDの形式が不正です");
    }
    match state.manager.dispose(&id) {
        Ok(()) => ok(StatusCode::OK, DeletedSession { id }),
        Err(SessionError::NotFound(message)) => fail(StatusCode::NOT_FOUND, &message),
        Err(error) => fail(StatusCode::INTERNAL_SERVER_ERROR, error.message()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_titles() {
        assert_eq!(sanitize_title(Some("  my session  ")).as_deref(), Some("my session"));
        assert_eq!(sanitize_title(Some("あ")).as_deref(), Some("あ"));
    }

    #[test]
    fn rejects_empty_and_too_long() {
        assert!(sanitize_title(Some("")).is_none());
        assert!(sanitize_title(Some("   ")).is_none());
        assert!(sanitize_title(Some(&"a".repeat(31))).is_none());
        assert!(sanitize_title(Some(&"a".repeat(30))).is_some());
        assert!(sanitize_title(None).is_none());
    }

    #[test]
    fn counts_code_points_not_bytes() {
        // 30文字ちょうどの日本語（90バイト）は許可される
        assert!(sanitize_title(Some(&"あ".repeat(30))).is_some());
        assert!(sanitize_title(Some(&"あ".repeat(31))).is_none());
    }

    #[test]
    fn rejects_control_characters() {
        assert!(sanitize_title(Some("bad\u{0}name")).is_none());
        assert!(sanitize_title(Some("bad\u{1b}name")).is_none());
        assert!(sanitize_title(Some("bad\u{7f}name")).is_none());
    }

    #[test]
    fn uuid_pattern_matches_v4_form_only() {
        assert!(uuid_pattern().is_match("2f80d9ee-c69c-4222-b8ba-91de340176f8"));
        assert!(uuid_pattern().is_match("2F80D9EE-C69C-4222-B8BA-91DE340176F8"));
        assert!(!uuid_pattern().is_match("not-a-uuid"));
        assert!(!uuid_pattern().is_match("2f80d9eec69c4222b8ba91de340176f8"));
        assert!(!uuid_pattern().is_match("../etc/passwd"));
    }
}
