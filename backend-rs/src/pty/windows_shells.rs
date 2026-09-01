use crate::types::ShellInfo;

/// WSLのシステムディストロ（ユーザー用でないため除外）判定
fn is_system_distro(name: &str) -> bool {
    name.to_ascii_lowercase().starts_with("docker-desktop")
}

/// `wsl.exe -l -v` の出力からユーザー用ディストロ名を抽出する（RDD 9.5章）。
///
/// 出力はUTF-16LE・カレントディストロの `*` マーカ・空白整形を含む前提でデコード済み文字列を受け取る。
/// パースできない行は無視し、失敗しても panic しない。
pub fn parse_wsl_distros(raw: &str) -> Vec<String> {
    raw.split('\n')
        .map(|line| line.replace('\u{0}', ""))
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            // 先頭の `*`（カレント）を除き、最初の空白区切りトークン＝ディストロ名
            let without_marker = line.strip_prefix('*').unwrap_or(&line).trim_start();
            without_marker.split_whitespace().next().map(|name| name.to_string())
        })
        // ヘッダ行（NAME）を除外
        .filter(|name| !name.eq_ignore_ascii_case("NAME"))
        .filter(|name| !name.is_empty() && !is_system_distro(name))
        .collect()
}

#[derive(Debug, Clone)]
pub struct WslShell {
    pub distro: String,
    pub login_shell: String,
}

/// Windows用シェル許可リストを構築する（RDD 9.5章）。
///
/// path・args はここで構築した固定値のみ。クライアント入力は一切混入しない。
pub fn build_windows_shells(has_pwsh: bool, wsl_shells: &[WslShell]) -> Vec<ShellInfo> {
    let mut shells = vec![
        ShellInfo::new("cmd", "コマンドプロンプト", "cmd.exe", Some(vec![])),
        ShellInfo::new(
            "powershell",
            "Windows PowerShell",
            "powershell.exe",
            Some(vec!["-NoLogo".to_string()]),
        ),
    ];
    if has_pwsh {
        shells.push(ShellInfo::new(
            "pwsh",
            "PowerShell",
            "pwsh.exe",
            Some(vec!["-NoLogo".to_string()]),
        ));
    }
    for WslShell { distro, login_shell } in wsl_shells {
        shells.push(ShellInfo::new(
            &format!("wsl-{distro}"),
            &format!("{distro} ({login_shell})"),
            "wsl.exe",
            Some(vec![
                "-d".to_string(),
                distro.clone(),
                "--cd".to_string(),
                "~".to_string(),
                "--".to_string(),
                login_shell.clone(),
                "-l".to_string(),
            ]),
        ));
    }
    shells
}

#[cfg(test)]
mod tests {
    use super::*;

    // wsl -l -v は UTF-16LE。デコード後の文字列を渡す想定
    const SAMPLE: &str = concat!(
        "  NAME              STATE           VERSION\n",
        "* Ubuntu-22.04      Running         2\n",
        "  docker-desktop    Stopped         2\n",
        "  Ubuntu            Stopped         2"
    );

    #[test]
    fn extracts_distro_names_and_strips_current_marker() {
        assert_eq!(parse_wsl_distros(SAMPLE), vec!["Ubuntu-22.04", "Ubuntu"]);
    }

    #[test]
    fn excludes_docker_desktop_system_distros() {
        let with_data = format!("{SAMPLE}\n  docker-desktop-data  Stopped         2");
        let result = parse_wsl_distros(&with_data);
        assert!(!result.iter().any(|name| name == "docker-desktop"));
        assert!(!result.iter().any(|name| name == "docker-desktop-data"));
    }

    #[test]
    fn header_only_and_empty_yield_nothing() {
        assert!(parse_wsl_distros("  NAME   STATE   VERSION").is_empty());
        assert!(parse_wsl_distros("").is_empty());
    }

    #[test]
    fn tolerates_nul_and_carriage_return() {
        let dirty = "NAME\r\n* Ubuntu-22.04\u{0}  Running  2\r";
        assert_eq!(parse_wsl_distros(dirty), vec!["Ubuntu-22.04"]);
    }

    #[test]
    fn always_includes_cmd_and_powershell_with_spec_args() {
        let shells = build_windows_shells(false, &[]);
        let cmd = shells.iter().find(|s| s.id == "cmd").unwrap();
        assert_eq!(cmd.label, "コマンドプロンプト");
        assert_eq!(cmd.path, "cmd.exe");
        assert_eq!(cmd.spawn_args(), &[] as &[String]);

        let ps = shells.iter().find(|s| s.id == "powershell").unwrap();
        assert_eq!(ps.label, "Windows PowerShell");
        assert_eq!(ps.path, "powershell.exe");
        assert_eq!(ps.spawn_args(), ["-NoLogo"]);
    }

    #[test]
    fn pwsh_only_when_present() {
        assert!(!build_windows_shells(false, &[]).iter().any(|s| s.id == "pwsh"));
        let with_pwsh = build_windows_shells(true, &[]);
        let pwsh = with_pwsh.iter().find(|s| s.id == "pwsh").unwrap();
        assert_eq!(pwsh.label, "PowerShell");
        assert_eq!(pwsh.path, "pwsh.exe");
        assert_eq!(pwsh.spawn_args(), ["-NoLogo"]);
    }

    #[test]
    fn builds_wsl_entry_with_expected_args() {
        let shells = build_windows_shells(
            false,
            &[WslShell { distro: "Ubuntu-22.04".into(), login_shell: "zsh".into() }],
        );
        let wsl = shells.iter().find(|s| s.id == "wsl-Ubuntu-22.04").unwrap();
        assert_eq!(wsl.label, "Ubuntu-22.04 (zsh)");
        assert_eq!(wsl.path, "wsl.exe");
        assert_eq!(wsl.spawn_args(), ["-d", "Ubuntu-22.04", "--cd", "~", "--", "zsh", "-l"]);
    }

    #[test]
    fn lists_multiple_wsl_distros_in_order() {
        let shells = build_windows_shells(
            false,
            &[
                WslShell { distro: "Ubuntu-22.04".into(), login_shell: "zsh".into() },
                WslShell { distro: "Ubuntu".into(), login_shell: "bash".into() },
            ],
        );
        let ids: Vec<&str> = shells.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["cmd", "powershell", "wsl-Ubuntu-22.04", "wsl-Ubuntu"]);
    }
}
