use serde::Serialize;

/// RDD.md 7章: セッション状態
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionStatus {
    Running,
    Idle,
    WaitingInput,
}

impl SessionStatus {
    /// WSバイナリフレーム用のタグ値（0x03 status のペイロード1バイト）
    pub fn as_byte(self) -> u8 {
        match self {
            SessionStatus::Running => 0,
            SessionStatus::Idle => 1,
            SessionStatus::WaitingInput => 2,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub shell: String,
    pub created_at: String,
    pub status: SessionStatus,
}

/// RDD.md 4章パターン準拠のAPIレスポンス envelope
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None }
    }

    pub fn fail(error: impl Into<String>) -> Self {
        Self { success: false, data: None, error: Some(error.into()) }
    }
}

/// 利用可能シェルの許可リストエントリ（RDD 9.2章 / 9.5章）
///
/// `args` はオプショナル。None のときはJSONに出力せず、既存の
/// レスポンス契約 `{ id, label, path }` を壊さない（RDD 9.5章）。
#[derive(Debug, Clone, Serialize)]
pub struct ShellInfo {
    pub id: String,
    pub label: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
}

impl ShellInfo {
    pub fn new(id: &str, label: &str, path: &str, args: Option<Vec<String>>) -> Self {
        Self { id: id.to_string(), label: label.to_string(), path: path.to_string(), args }
    }

    /// PTY起動時に渡す引数。未指定は空配列扱い（RDD 9.5章）
    pub fn spawn_args(&self) -> &[String] {
        self.args.as_deref().unwrap_or(&[])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_status_serializes_to_rdd_names() {
        assert_eq!(serde_json::to_string(&SessionStatus::Running).unwrap(), "\"running\"");
        assert_eq!(serde_json::to_string(&SessionStatus::Idle).unwrap(), "\"idle\"");
        assert_eq!(
            serde_json::to_string(&SessionStatus::WaitingInput).unwrap(),
            "\"waiting-input\""
        );
    }

    #[test]
    fn shell_info_omits_args_when_absent() {
        let shell = ShellInfo::new("bash", "Bash", "/bin/bash", None);
        let json = serde_json::to_string(&shell).unwrap();
        assert!(!json.contains("args"), "argsなしのエントリはJSONにargsを含めない: {json}");
    }

    #[test]
    fn shell_info_keeps_args_when_present() {
        let shell = ShellInfo::new("powershell", "Windows PowerShell", "powershell.exe", Some(vec!["-NoLogo".into()]));
        let json = serde_json::to_string(&shell).unwrap();
        assert!(json.contains("\"args\":[\"-NoLogo\"]"), "{json}");
        assert_eq!(shell.spawn_args(), ["-NoLogo"]);
    }

    #[test]
    fn session_info_uses_camel_case() {
        let info = SessionInfo {
            id: "id".into(),
            title: "Terminal 1".into(),
            shell: "bash".into(),
            created_at: "2026-08-28T00:00:00Z".into(),
            status: SessionStatus::Idle,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"createdAt\""), "{json}");
    }
}
