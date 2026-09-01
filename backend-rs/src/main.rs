mod app;
mod config;
mod monitor;
mod pty;
mod routes;
mod security;
mod static_files;
mod types;
mod utf8;
mod ws;

use crate::app::{create_app, AppState, ShellRegistry};
use crate::config::load_config;
use crate::pty::session_manager::{SessionManager, SessionManagerOptions};
use crate::pty::shell_registry::detect_shells;
use crate::pty::windows_shells::{build_windows_shells, parse_wsl_distros, WslShell};
use crate::types::ShellInfo;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

/// 外部コマンド（WSL検出等）のタイムアウト。
///
/// 停止中のWSLディストロを起動する初回コマンドは実測で約10秒かかる
/// （ウォーム状態なら約0.3秒）。Node版と同じ5秒ではコールドスタート時に
/// 必ず失敗し、ログインシェルがzsh→bash等へ誤検出されていた。
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);

/// 外部コマンドを実行して stdout を返す。失敗・タイムアウトは None。
async fn run_command(program: &str, args: &[&str]) -> Option<Vec<u8>> {
    let future = tokio::process::Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    match tokio::time::timeout(COMMAND_TIMEOUT, future).await {
        Ok(Ok(output)) if output.status.success() => Some(output.stdout),
        _ => None,
    }
}

/// WSLディストロのログインシェル名を取得（RDD 9.5章。失敗時はzsh→bash→shで在否確認）
async fn resolve_wsl_login_shell(distro: &str) -> String {
    if let Some(stdout) =
        run_command("wsl.exe", &["-d", distro, "--", "sh", "-lc", "echo $SHELL"]).await
    {
        let text = String::from_utf8_lossy(&stdout);
        if let Some(name) = text.trim().rsplit('/').find(|part| !part.is_empty()) {
            return name.to_string();
        }
    }
    for candidate in ["zsh", "bash", "sh"] {
        if run_command("wsl.exe", &["-d", distro, "--", "which", candidate]).await.is_some() {
            return candidate.to_string();
        }
    }
    "bash".to_string()
}

/// Windows用シェル許可リストの構築（RDD 9.5章。副作用: wsl/pwsh検出）
async fn detect_windows_shells() -> Vec<ShellInfo> {
    let has_pwsh = run_command("pwsh.exe", &["-NoLogo", "-Command", "exit"]).await.is_some();

    let mut wsl_shells = Vec::new();
    if let Some(stdout) = run_command("wsl.exe", &["-l", "-v"]).await {
        // wsl -l -v の出力は UTF-16LE
        let (decoded, _, _) = encoding_rs::UTF_16LE.decode(&stdout);
        // ディストロごとのコールドスタート（各約10秒）を直列に積み上げないよう並列に解決する
        wsl_shells = futures_util::future::join_all(parse_wsl_distros(&decoded).into_iter().map(
            |distro| async move {
                let login_shell = resolve_wsl_login_shell(&distro).await;
                WslShell { distro, login_shell }
            },
        ))
        .await;
    }
    // WSL未導入・パース失敗 → WSLシェルは追加しない（cmd/powershellは維持）
    build_windows_shells(has_pwsh, &wsl_shells)
}

async fn detect_available_shells(is_windows: bool) -> Vec<ShellInfo> {
    if is_windows {
        detect_windows_shells().await
    } else {
        let env_shell = std::env::var("SHELL").ok();
        detect_shells(env_shell.as_deref(), &|path: &str| std::path::Path::new(path).exists())
    }
}

/// 外部コマンドを起動せずに用意できるシェル一覧。
///
/// WSLディストロの検出はコールドスタートで10秒以上かかるため、
/// サーバはまずこの一覧で起動し、検出が終わってから差し替える。
fn immediate_shells(is_windows: bool) -> Vec<ShellInfo> {
    if is_windows {
        // pwsh / WSL は実在確認に外部コマンドが要るのでここでは含めない
        build_windows_shells(false, &[])
    } else {
        let env_shell = std::env::var("SHELL").ok();
        detect_shells(env_shell.as_deref(), &|path: &str| std::path::Path::new(path).exists())
    }
}

/// Ctrl+C / SIGTERM を待つ
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}

#[tokio::main]
async fn main() {
    let is_windows = cfg!(windows);
    let config = match load_config(&|key: &str| std::env::var(key).ok(), is_windows) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("[multiterm] 設定エラー: {error}");
            std::process::exit(1);
        }
    };

    // RDD 9.2章 / 9.5章: 利用可能シェルの許可リスト。
    // WSL検出は時間がかかるため、まず外部コマンド不要な分だけで起動する。
    let initial_shells = immediate_shells(is_windows);
    let default_shell = initial_shells
        .iter()
        .find(|shell| shell.path == config.shell || shell.id == config.shell)
        .or_else(|| initial_shells.first())
        .cloned();
    if default_shell.is_none() {
        eprintln!("[multiterm] 利用可能なシェルが見つかりません");
        std::process::exit(1);
    }

    let manager = SessionManager::new(SessionManagerOptions {
        max_sessions: config.max_sessions,
        buffer_limit: config.buffer_limit,
        default_shell,
    });

    // Windows では pwsh / WSL の検出が後から走るため、その間は detecting とする
    let registry = ShellRegistry::new(initial_shells.clone(), is_windows);
    let state = AppState {
        manager: Arc::clone(&manager),
        allowed_origins: Arc::new(config.allowed_origins.clone()),
        shells: registry.clone(),
    };
    let app = create_app(state);

    let address = format!("{}:{}", config.host, config.port);
    let listener = match tokio::net::TcpListener::bind(&address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("[multiterm] {address} にバインドできません: {error}");
            std::process::exit(1);
        }
    };
    let shell_ids: Vec<&str> = initial_shells.iter().map(|shell| shell.id.as_str()).collect();
    println!(
        "[multiterm] backend listening on {address} (shells: {})",
        shell_ids.join(", ")
    );

    // 残りのシェル（pwsh / WSLディストロ）は背後で検出し、終わり次第 許可リストへ反映する
    if is_windows {
        tokio::spawn(async move {
            let detected = detect_available_shells(true).await;
            let ids: Vec<&str> = detected.iter().map(|shell| shell.id.as_str()).collect();
            println!("[multiterm] shell detection finished (shells: {})", ids.join(", "));
            registry.finish(detected);
        });
    }

    if let Err(error) =
        axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await
    {
        eprintln!("[multiterm] server error: {error}");
    }
    manager.dispose_all();
}
