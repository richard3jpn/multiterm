use crate::monitor::state_detector::StateDetector;
use crate::pty::dsr::{strip_dsr, DSR_RESPONSE};
use crate::pty::ring_buffer::RingBuffer;
use crate::types::{SessionInfo, SessionStatus, ShellInfo};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex, Weak};
use tokio::sync::{broadcast, Notify};

/// PTY起動サイズの既定値（フロントの初回resizeで上書きされる）
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;

/// PTY読み取りバッファ長
const READ_CHUNK: usize = 64 * 1024;

/// 1セッションあたりのブロードキャスト容量。詰まった購読者は Lagged として扱う。
const CHANNEL_CAPACITY: usize = 512;

/// セッション購読者へ配信するイベント
#[derive(Debug, Clone)]
pub enum SessionEvent {
    /// PTY出力（生バイト）。複数購読者で共有するため Arc で包む
    Data(Arc<Vec<u8>>),
    Status(SessionStatus),
    Exit(i32),
}

#[derive(Debug)]
pub enum SessionError {
    /// 同時セッション数の上限超過（RDD 7章）
    LimitReached(String),
    NotFound(String),
    InvalidSize(String),
    Spawn(String),
}

impl SessionError {
    pub fn message(&self) -> &str {
        match self {
            SessionError::LimitReached(m)
            | SessionError::NotFound(m)
            | SessionError::InvalidSize(m)
            | SessionError::Spawn(m) => m,
        }
    }
}

/// 再接続時に必要な情報一式（replayバッファ・現在状態・以降のイベント受信機）
pub struct SessionSubscription {
    pub replay: Vec<u8>,
    pub status: SessionStatus,
    pub receiver: broadcast::Receiver<SessionEvent>,
}

/// PTYへの書き込み・リサイズ・強制終了。portable-pty の型を Mutex で共有する。
struct PtyHandle {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

struct ManagedSession {
    id: String,
    /// rename（RDD 9.3章）のため可変
    title: Mutex<String>,
    shell: String,
    created_at: String,
    pty: PtyHandle,
    detector: Mutex<StateDetector>,
    buffer: Mutex<RingBuffer>,
    sender: broadcast::Sender<SessionEvent>,
    /// 出力があったことを静止判定タスクへ伝える
    output_signal: Notify,
}

impl ManagedSession {
    fn to_info(&self) -> SessionInfo {
        SessionInfo {
            id: self.id.clone(),
            title: self.title.lock().unwrap().clone(),
            shell: self.shell.clone(),
            created_at: self.created_at.clone(),
            status: self.detector.lock().unwrap().status(),
        }
    }
}

pub struct SessionManagerOptions {
    pub max_sessions: usize,
    pub buffer_limit: usize,
    pub default_shell: Option<ShellInfo>,
}

/// PTYセッションの生成・保持・破棄（RDD.md 7章）。
///
/// セッション実体はプロセス寿命の間メモリ上に維持され、リロード後の再接続を可能にする。
pub struct SessionManager {
    sessions: Mutex<HashMap<String, Arc<ManagedSession>>>,
    sequence: Mutex<u64>,
    options: SessionManagerOptions,
}

impl SessionManager {
    pub fn new(options: SessionManagerOptions) -> Arc<Self> {
        Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            sequence: Mutex::new(0),
            options,
        })
    }

    /// セッションを作成する。shell（許可リスト解決済み）省略時はサーバ既定シェル（RDD 9.2章）
    pub fn create(
        self: &Arc<Self>,
        shell: Option<&ShellInfo>,
    ) -> Result<SessionInfo, SessionError> {
        {
            let sessions = self.sessions.lock().unwrap();
            if sessions.len() >= self.options.max_sessions {
                return Err(SessionError::LimitReached(format!(
                    "セッション数が上限（{}）に達しています",
                    self.options.max_sessions
                )));
            }
        }

        let chosen = shell.or(self.options.default_shell.as_ref());
        let shell_id = chosen.map(|s| s.id.clone()).unwrap_or_else(|| "unknown".to_string());
        let shell_path = chosen.map(|s| s.path.clone()).unwrap_or_else(|| "bash".to_string());
        let shell_args: Vec<String> = chosen.map(|s| s.spawn_args().to_vec()).unwrap_or_default();

        let (pty, reader) = spawn_pty(&shell_path, &shell_args)?;

        let sequence = {
            let mut sequence = self.sequence.lock().unwrap();
            *sequence += 1;
            *sequence
        };
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        let session = Arc::new(ManagedSession {
            id: id.clone(),
            title: Mutex::new(format!("Terminal {sequence}")),
            shell: shell_id,
            created_at: now_iso8601(),
            pty,
            detector: Mutex::new(StateDetector::new()),
            buffer: Mutex::new(RingBuffer::new(self.options.buffer_limit)),
            sender,
            output_signal: Notify::new(),
        });

        let info = session.to_info();
        self.sessions.lock().unwrap().insert(id, Arc::clone(&session));

        spawn_reader(Arc::clone(&session), reader, Arc::downgrade(self));
        spawn_quiescence_watcher(Arc::downgrade(&session));

        Ok(info)
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.lock().unwrap();
        let mut list: Vec<SessionInfo> = sessions.values().map(|s| s.to_info()).collect();
        // Mapの反復順に依存しないよう作成順で安定させる
        list.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        list
    }

    pub fn get(&self, id: &str) -> Option<SessionInfo> {
        self.sessions.lock().unwrap().get(id).map(|s| s.to_info())
    }

    pub fn exists(&self, id: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(id)
    }

    /// セッション名を変更する。バリデーションは呼び出し側（ルート層）で実施済みであること
    pub fn rename(&self, id: &str, title: &str) -> Result<SessionInfo, SessionError> {
        let session = self.require(id)?;
        *session.title.lock().unwrap() = title.to_string();
        Ok(session.to_info())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), SessionError> {
        let session = self.require(id)?;
        let mut writer = session.pty.writer.lock().unwrap();
        writer
            .write_all(data)
            .and_then(|_| writer.flush())
            .map_err(|error| SessionError::Spawn(format!("入力の書き込みに失敗しました: {error}")))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), SessionError> {
        if cols == 0 || rows == 0 {
            return Err(SessionError::InvalidSize(
                "cols / rows は正の整数である必要があります".to_string(),
            ));
        }
        let session = self.require(id)?;
        let master = session.pty.master.lock().unwrap();
        master
            .resize(portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|error| SessionError::Spawn(format!("リサイズに失敗しました: {error}")))
    }
}

impl SessionManager {
    /// 再接続用の購読を開始する。
    ///
    /// バッファのロックを保持したまま受信機を作ることで、replay とそれ以降の
    /// data フレームの間に取りこぼし・重複が生じないようにする。
    pub fn subscribe(&self, id: &str) -> Option<SessionSubscription> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(id)?;
        let buffer = session.buffer.lock().unwrap();
        let receiver = session.sender.subscribe();
        // DSR は spawn_reader がバックエンドで応答して取り除いているため、
        // バッファには入っていない（replayでxtermが二重応答することはない）。
        let replay = buffer.snapshot();
        let status = session.detector.lock().unwrap().status();
        Some(SessionSubscription { replay, status, receiver })
    }

    pub fn dispose(&self, id: &str) -> Result<(), SessionError> {
        let session = self.sessions.lock().unwrap().remove(id).ok_or_else(|| not_found(id))?;
        let _ = session.pty.child.lock().unwrap().kill();
        Ok(())
    }

    pub fn dispose_all(&self) {
        let sessions: Vec<Arc<ManagedSession>> =
            self.sessions.lock().unwrap().drain().map(|(_, session)| session).collect();
        for session in sessions {
            let _ = session.pty.child.lock().unwrap().kill();
        }
    }

    fn require(&self, id: &str) -> Result<Arc<ManagedSession>, SessionError> {
        self.sessions.lock().unwrap().get(id).cloned().ok_or_else(|| not_found(id))
    }
}

fn not_found(id: &str) -> SessionError {
    SessionError::NotFound(format!("セッションが見つかりません: {id}"))
}

fn now_iso8601() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// PTY出力を読み続けるスレッド。
///
/// portable-pty の reader は同期I/Oのため専用スレッドで回す。1チャンクにつき
/// バッファ追記・状態検知・購読者への配信を行う（Node版 session-manager.ts の wire 相当）。
fn spawn_reader(
    session: Arc<ManagedSession>,
    mut reader: Box<dyn Read + Send>,
    manager: Weak<SessionManager>,
) {
    std::thread::spawn(move || {
        let mut buf = vec![0u8; READ_CHUNK];
        loop {
            let read = match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(size) => size,
                Err(_) => break,
            };

            // ConPTY はシェル起動前に DSR（カーソル位置問い合わせ）を送り、応答があるまで
            // シェルの出力を始めない。バックエンドが応答することで、クライアント未接続でも
            // セッションが起動する。応答済みの問い合わせはクライアントへ送らない
            // （xterm が二重に応答し、その応答がプロンプトへ入力されるのを防ぐ）。
            let chunk = match strip_dsr(&buf[..read]) {
                Some(stripped) => {
                    let mut writer = session.pty.writer.lock().unwrap();
                    let _ = writer.write_all(DSR_RESPONSE).and_then(|_| writer.flush());
                    drop(writer);
                    if stripped.is_empty() {
                        continue;
                    }
                    Arc::new(stripped)
                }
                None => Arc::new(buf[..read].to_vec()),
            };

            // バッファのロックを保持したまま配信し、subscribe との整合性を保つ
            {
                let mut buffer = session.buffer.lock().unwrap();
                buffer.append(&chunk);
                let _ = session.sender.send(SessionEvent::Data(Arc::clone(&chunk)));
            }

            let changed = session.detector.lock().unwrap().feed(&chunk);
            if changed {
                let status = session.detector.lock().unwrap().status();
                let _ = session.sender.send(SessionEvent::Status(status));
            }
            session.output_signal.notify_one();
        }

        // EOF: シェル終了。終了コードを拾って通知し、セッションを片付ける
        let exit_code = session
            .pty
            .child
            .lock()
            .unwrap()
            .wait()
            .map(|status| status.exit_code() as i32)
            .unwrap_or(-1);
        if let Some(manager) = manager.upgrade() {
            manager.sessions.lock().unwrap().remove(&session.id);
        }
        let _ = session.sender.send(SessionEvent::Exit(exit_code));
    });
}

/// 出力が静止したら状態を再評価するタスク（RDD.md 7章）。
///
/// 出力が続く間は再評価せず、静止したときだけ1回評価する。評価後は次の出力まで
/// 完全に待機するため、アイドル時のCPU消費はゼロになる。
fn spawn_quiescence_watcher(session: Weak<ManagedSession>) {
    tokio::spawn(async move {
        loop {
            // 次の出力を待つ（この間はCPUを使わない）
            {
                let Some(current) = session.upgrade() else { return };
                let notified = current.output_signal.notified();
                notified.await;
            }
            // 出力が続く間はループ、静止したら1回だけ評価する
            loop {
                let Some(current) = session.upgrade() else { return };
                let quiescence = current.detector.lock().unwrap().quiescence();
                let notified = current.output_signal.notified();
                tokio::select! {
                    _ = notified => continue,
                    _ = tokio::time::sleep(quiescence) => {
                        let changed = current.detector.lock().unwrap().apply_quiescence();
                        if changed {
                            let status = current.detector.lock().unwrap().status();
                            let _ = current.sender.send(SessionEvent::Status(status));
                        }
                        break;
                    }
                }
            }
        }
    });
}

/// PTYを起動する。args は配列で渡し、シェル文字列補間を発生させない（RDD 9.5章セキュリティ要件）
fn spawn_pty(
    shell_path: &str,
    args: &[String],
) -> Result<(PtyHandle, Box<dyn Read + Send>), SessionError> {
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(portable_pty::PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| SessionError::Spawn(format!("PTYの作成に失敗しました: {error}")))?;

    let mut command = portable_pty::CommandBuilder::new(shell_path);
    for arg in args {
        command.arg(arg);
    }
    command.env("TERM", "xterm-256color");
    // 24bit色を使えることをアプリへ伝える（Windows Terminal も同じ値を設定する）
    command.env("COLORTERM", "truecolor");
    // 親プロセスが NO_COLOR を設定していると、その値を継承したアプリが色出力をやめてしまう。
    // ターミナルとして起動する以上、色は出せる前提にする（https://no-color.org/）
    command.env_remove("NO_COLOR");
    if let Some(home) = home_dir() {
        command.cwd(home);
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| SessionError::Spawn(format!("シェルの起動に失敗しました: {error}")))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| SessionError::Spawn(format!("PTY出力の取得に失敗しました: {error}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| SessionError::Spawn(format!("PTY入力の取得に失敗しました: {error}")))?;

    Ok((
        PtyHandle {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
        },
        reader,
    ))
}

/// ホームディレクトリ（Node版 os.homedir() 相当）
fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
}
