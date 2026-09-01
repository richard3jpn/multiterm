use crate::security::origin::parse_allowed_origins;

/// RDD.md 7章: 同時セッション上限
pub const MAX_SESSIONS: usize = 16;
/// RDD.md 7章: 出力バッファ上限（200KB/セッション）
pub const BUFFER_LIMIT: usize = 200 * 1024;
/// RDD.md 8章: 開発モードは127.0.0.1バインド。コンテナのみ HOST=0.0.0.0 を明示注入
const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3001;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub port: u16,
    pub host: String,
    pub allowed_origins: Vec<String>,
    pub max_sessions: usize,
    pub buffer_limit: usize,
    pub shell: String,
}

/// RDD.md 5章2項: OS自動判定によるシェル選択
pub fn select_shell(is_windows: bool, env_shell: Option<&str>) -> String {
    if is_windows {
        return "powershell.exe".to_string();
    }
    match env_shell.filter(|value| !value.is_empty()) {
        Some(shell) => shell.to_string(),
        None => "bash".to_string(),
    }
}

/// 環境変数から設定を読み込む。不正値は起動を止める（RDD.md 5章9項: Origin検証は必須）
pub fn load_config(
    get_env: &dyn Fn(&str) -> Option<String>,
    is_windows: bool,
) -> Result<AppConfig, String> {
    let port = match get_env("PORT") {
        Some(raw) => raw
            .trim()
            .parse::<u16>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| format!("PORT が不正です: {raw}"))?,
        None => DEFAULT_PORT,
    };

    let allowed_origins = parse_allowed_origins(get_env("ALLOWED_ORIGINS").as_deref());
    if allowed_origins.is_empty() {
        return Err("ALLOWED_ORIGINS が未設定です（RDD.md 5章9項: Origin検証は必須）".to_string());
    }

    Ok(AppConfig {
        port,
        host: get_env("HOST").unwrap_or_else(|| DEFAULT_HOST.to_string()),
        allowed_origins,
        max_sessions: MAX_SESSIONS,
        buffer_limit: BUFFER_LIMIT,
        shell: select_shell(is_windows, get_env("SHELL").as_deref()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> =
            pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |key: &str| map.get(key).cloned()
    }

    #[test]
    fn select_shell_uses_powershell_on_windows() {
        assert_eq!(select_shell(true, None), "powershell.exe");
        assert_eq!(select_shell(true, Some("/usr/bin/zsh")), "powershell.exe");
    }

    #[test]
    fn select_shell_prefers_env_shell_on_unix() {
        assert_eq!(select_shell(false, Some("/usr/bin/zsh")), "/usr/bin/zsh");
    }

    #[test]
    fn select_shell_falls_back_to_bash() {
        assert_eq!(select_shell(false, None), "bash");
        assert_eq!(select_shell(false, Some("")), "bash");
    }

    #[test]
    fn defaults_follow_rdd() {
        let env = env_of(&[("ALLOWED_ORIGINS", "http://localhost:5173")]);
        let config = load_config(&env, false).unwrap();
        assert_eq!(config.port, 3001);
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.max_sessions, MAX_SESSIONS);
        assert_eq!(config.buffer_limit, BUFFER_LIMIT);
        assert_eq!(MAX_SESSIONS, 16);
        assert_eq!(BUFFER_LIMIT, 200 * 1024);
    }

    #[test]
    fn missing_allowed_origins_is_startup_error() {
        let env = env_of(&[]);
        let error = load_config(&env, false).unwrap_err();
        assert!(error.contains("ALLOWED_ORIGINS"), "{error}");
    }

    #[test]
    fn invalid_port_is_startup_error() {
        for raw in ["abc", "0", "70000"] {
            let env = env_of(&[("ALLOWED_ORIGINS", "http://localhost:5173"), ("PORT", raw)]);
            let error = load_config(&env, false).unwrap_err();
            assert!(error.contains("PORT"), "raw={raw}, error={error}");
        }
    }

    #[test]
    fn host_can_be_overridden_for_containers() {
        let env = env_of(&[("ALLOWED_ORIGINS", "http://localhost:5173"), ("HOST", "0.0.0.0")]);
        assert_eq!(load_config(&env, false).unwrap().host, "0.0.0.0");
    }
}
