use crate::app::AppState;
use crate::pty::session_manager::{SessionEvent, SessionManager};
use crate::security::origin::is_origin_allowed;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{RawQuery, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;

/// クライアントからの入力1メッセージの最大長（暴走防止）
const MAX_INPUT_LENGTH: usize = 8192;

/// PTY出力をまとめて1フレームで送る時間窓。
/// WSフレーム数と xterm の write 呼び出しを削減する（RDD.md 3章: 描画性能）。
const COALESCE_WINDOW: Duration = Duration::from_millis(5);

// --- サーバ → クライアント ---
const TAG_DATA: u8 = 0x01;
const TAG_REPLAY: u8 = 0x02;
const TAG_STATUS: u8 = 0x03;
const TAG_EXIT: u8 = 0x04;
const TAG_ERROR: u8 = 0x05;

// --- クライアント → サーバ ---
const CLIENT_TAG_INPUT: u8 = 0x01;
const CLIENT_TAG_RESIZE: u8 = 0x02;

/// クエリ文字列から sessionId を取り出す。存在しなければ None。
fn extract_session_id(query: Option<&str>) -> Option<&str> {
    query?
        .split('&')
        .find_map(|pair| pair.strip_prefix("sessionId="))
        .filter(|value| !value.is_empty())
}

/// タグ1バイト + ペイロードのバイナリフレームを組み立てる
fn frame(tag: u8, payload: &[u8]) -> Message {
    let mut buf = Vec::with_capacity(1 + payload.len());
    buf.push(tag);
    buf.extend_from_slice(payload);
    Message::Binary(buf.into())
}

#[derive(Debug, PartialEq, Eq)]
enum ClientFrame {
    Input(Vec<u8>),
    Resize { cols: u16, rows: u16 },
}

/// クライアントフレームを検証してパースする。不正はNone（外部データを信頼しない）
fn parse_client_frame(bytes: &[u8]) -> Option<ClientFrame> {
    let (tag, rest) = bytes.split_first()?;
    match *tag {
        CLIENT_TAG_INPUT if !rest.is_empty() && rest.len() <= MAX_INPUT_LENGTH => {
            Some(ClientFrame::Input(rest.to_vec()))
        }
        CLIENT_TAG_RESIZE if rest.len() == 4 => {
            let cols = u16::from_le_bytes([rest[0], rest[1]]);
            let rows = u16::from_le_bytes([rest[2], rest[3]]);
            if cols == 0 || rows == 0 {
                return None;
            }
            Some(ClientFrame::Resize { cols, rows })
        }
        _ => None,
    }
}

/// WebSocketハンドシェイク（RDD.md 5章3項・9項）。
///
/// upgrade時にOriginをホワイトリスト検証し、不一致は403で拒否する。
/// セッションが存在しない場合は404。
pub async fn ws_route(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Response {
    let origin = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok());
    if !is_origin_allowed(origin, &state.allowed_origins) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(session_id) = extract_session_id(query.as_deref()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !state.manager.exists(session_id) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let session_id = session_id.to_string();
    let manager = Arc::clone(&state.manager);
    ws.on_upgrade(move |socket| handle_socket(socket, session_id, manager))
}

async fn handle_socket(socket: WebSocket, session_id: String, manager: Arc<SessionManager>) {
    // 再接続時の画面復元（RDD.md 5章4項: バッファ再生）
    let Some(subscription) = manager.subscribe(&session_id) else {
        let mut socket = socket;
        let _ = socket.send(frame(TAG_ERROR, "セッションが見つかりません".as_bytes())).await;
        let _ = socket.close().await;
        return;
    };

    let (mut sink, mut stream) = socket.split();
    if !subscription.replay.is_empty() {
        if sink.send(frame(TAG_REPLAY, &subscription.replay)).await.is_err() {
            return;
        }
    }
    if sink.send(frame(TAG_STATUS, &[subscription.status.as_byte()])).await.is_err() {
        return;
    }

    // PTY出力 → クライアント（5ms窓でコアレッシング）
    let mut receiver = subscription.receiver;
    let mut send_task = tokio::spawn(async move {
        loop {
            let first = match receiver.recv().await {
                Ok(event) => event,
                // 受信が追いつかず取りこぼした場合も接続は維持し、次のフレームから再開する
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            };

            let mut data = Vec::new();
            let mut trailing: Option<SessionEvent> = None;
            match first {
                SessionEvent::Data(chunk) => {
                    data.extend_from_slice(&chunk);
                    let window = tokio::time::sleep(COALESCE_WINDOW);
                    tokio::pin!(window);
                    loop {
                        tokio::select! {
                            _ = &mut window => break,
                            event = receiver.recv() => match event {
                                Ok(SessionEvent::Data(more)) => data.extend_from_slice(&more),
                                Ok(other) => { trailing = Some(other); break; }
                                Err(RecvError::Lagged(_)) => continue,
                                Err(RecvError::Closed) => break,
                            }
                        }
                    }
                }
                other => trailing = Some(other),
            }

            if !data.is_empty() && sink.send(frame(TAG_DATA, &data)).await.is_err() {
                break;
            }
            match trailing {
                Some(SessionEvent::Status(status)) => {
                    if sink.send(frame(TAG_STATUS, &[status.as_byte()])).await.is_err() {
                        break;
                    }
                }
                Some(SessionEvent::Exit(code)) => {
                    let _ = sink.send(frame(TAG_EXIT, &code.to_le_bytes())).await;
                    let _ = sink.close().await;
                    break;
                }
                Some(SessionEvent::Data(_)) | None => {}
            }
        }
    });

    // クライアント → PTY
    let input_manager = Arc::clone(&manager);
    let input_session = session_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(message)) = stream.next().await {
            let payload = match message {
                Message::Binary(bytes) => bytes,
                Message::Close(_) => break,
                // テキスト・Ping/Pong は無視（プロトコルはバイナリのみ）
                _ => continue,
            };
            let Some(parsed) = parse_client_frame(&payload) else {
                continue;
            };
            let result = match parsed {
                ClientFrame::Input(data) => input_manager.write(&input_session, &data),
                ClientFrame::Resize { cols, rows } => {
                    input_manager.resize(&input_session, cols, rows)
                }
            };
            if result.is_err() {
                break;
            }
        }
    });

    // どちらかが終わったら両方を畳む
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}

#[cfg(test)]
mod tests {
    use crate::types::SessionStatus;
    use super::*;

    #[test]
    fn parses_input_frame() {
        let mut bytes = vec![CLIENT_TAG_INPUT];
        bytes.extend_from_slice(b"ls -la\r");
        assert_eq!(parse_client_frame(&bytes), Some(ClientFrame::Input(b"ls -la\r".to_vec())));
    }

    #[test]
    fn rejects_oversized_input() {
        let mut bytes = vec![CLIENT_TAG_INPUT];
        bytes.extend_from_slice(&vec![b'a'; MAX_INPUT_LENGTH]);
        assert!(parse_client_frame(&bytes).is_some(), "上限ちょうどは受理");

        let mut oversized = vec![CLIENT_TAG_INPUT];
        oversized.extend_from_slice(&vec![b'a'; MAX_INPUT_LENGTH + 1]);
        assert!(parse_client_frame(&oversized).is_none(), "上限超過は拒否");
    }

    #[test]
    fn parses_resize_frame_as_little_endian() {
        // cols=120, rows=40
        let bytes = vec![CLIENT_TAG_RESIZE, 120, 0, 40, 0];
        assert_eq!(parse_client_frame(&bytes), Some(ClientFrame::Resize { cols: 120, rows: 40 }));
    }

    #[test]
    fn rejects_malformed_frames() {
        assert!(parse_client_frame(&[]).is_none(), "空フレーム");
        assert!(parse_client_frame(&[CLIENT_TAG_INPUT]).is_none(), "ペイロードなしのinput");
        assert!(parse_client_frame(&[CLIENT_TAG_RESIZE, 1, 0, 1]).is_none(), "resizeの長さ不足");
        assert!(parse_client_frame(&[CLIENT_TAG_RESIZE, 0, 0, 40, 0]).is_none(), "cols=0");
        assert!(parse_client_frame(&[CLIENT_TAG_RESIZE, 80, 0, 0, 0]).is_none(), "rows=0");
        assert!(parse_client_frame(&[0xff, 1, 2]).is_none(), "未知のタグ");
    }

    #[test]
    fn frame_prefixes_payload_with_tag() {
        let Message::Binary(bytes) = frame(TAG_DATA, b"hi") else {
            panic!("バイナリフレームであること");
        };
        assert_eq!(&bytes[..], &[TAG_DATA, b'h', b'i']);
    }

    #[test]
    fn status_bytes_match_protocol() {
        assert_eq!(SessionStatus::Running.as_byte(), 0);
        assert_eq!(SessionStatus::Idle.as_byte(), 1);
        assert_eq!(SessionStatus::WaitingInput.as_byte(), 2);
    }

    #[test]
    fn exit_code_is_little_endian_i32() {
        let Message::Binary(bytes) = frame(TAG_EXIT, &(-1i32).to_le_bytes()) else {
            panic!("バイナリフレームであること");
        };
        assert_eq!(bytes[0], TAG_EXIT);
        assert_eq!(i32::from_le_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]), -1);
    }
}
