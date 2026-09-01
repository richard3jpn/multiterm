use crate::types::ShellInfo;

/// Linux / macOS で検出を試みるシェル候補（RDD 9.2章）
const UNIX_CANDIDATES: &[(&str, &str, &[&str])] = &[
    ("bash", "Bash", &["/bin/bash", "/usr/bin/bash"]),
    ("zsh", "Zsh", &["/bin/zsh", "/usr/bin/zsh"]),
    ("fish", "Fish", &["/usr/bin/fish", "/usr/local/bin/fish"]),
    ("sh", "sh", &["/bin/sh"]),
];

fn basename(path: &str) -> &str {
    path.rsplit('/').find(|part| !part.is_empty()).unwrap_or(path)
}

/// Unix系（Linux / macOS）で利用可能なシェルを検出し許可リストを返す（RDD 9.2章）。
///
/// `exists` は注入可能（テスト用）。実在しない候補は含めない。
/// Windows（win32）のシェル検出は `windows_shells::build_windows_shells` を使う（RDD 9.5章）。
pub fn detect_shells(env_shell: Option<&str>, exists: &dyn Fn(&str) -> bool) -> Vec<ShellInfo> {
    let mut detected: Vec<ShellInfo> = UNIX_CANDIDATES
        .iter()
        .filter_map(|(id, label, paths)| {
            paths
                .iter()
                .find(|path| exists(path))
                .map(|path| ShellInfo::new(id, label, path, None))
        })
        .collect();

    // $SHELL（サーバ既定）が候補一覧外でも許可リストに含める
    if let Some(default_shell) = env_shell.filter(|path| !path.is_empty() && exists(path)) {
        let id = basename(default_shell);
        if !detected.iter().any(|shell| shell.id == id) {
            detected.push(ShellInfo::new(id, id, default_shell, None));
        }
    }
    detected
}

/// 許可リストのidのみ解決する。リスト外・パス文字列はNone（RDD 9.2章セキュリティ要件）
pub fn resolve_shell<'a>(id: &str, registry: &'a [ShellInfo]) -> Option<&'a ShellInfo> {
    registry.iter().find(|shell| shell.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exists_in(paths: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |path: &str| paths.contains(&path)
    }

    #[test]
    fn detects_only_existing_shells() {
        let exists = exists_in(&["/bin/bash", "/usr/bin/zsh"]);
        let shells = detect_shells(Some("/usr/bin/zsh"), &exists);
        let ids: Vec<&str> = shells.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["bash", "zsh"]);
        assert_eq!(shells.iter().find(|s| s.id == "bash").unwrap().path, "/bin/bash");
    }

    #[test]
    fn absent_candidates_are_excluded() {
        let exists = exists_in(&["/bin/bash", "/bin/sh"]);
        let shells = detect_shells(None, &exists);
        let ids: Vec<&str> = shells.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["bash", "sh"]);
        assert!(shells.iter().all(|s| s.id != "fish"));
    }

    #[test]
    fn env_shell_outside_candidates_is_included_without_duplicates() {
        let exists = exists_in(&["/bin/bash", "/opt/custom/mysh"]);
        let shells = detect_shells(Some("/opt/custom/mysh"), &exists);
        let ids: Vec<&str> = shells.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"mysh"), "{ids:?}");
        assert_eq!(shells.iter().filter(|s| s.id == "bash").count(), 1);
    }

    #[test]
    fn resolve_shell_accepts_ids_only() {
        let exists = exists_in(&["/bin/bash", "/usr/bin/zsh"]);
        let registry = detect_shells(None, &exists);
        assert_eq!(resolve_shell("bash", &registry).unwrap().path, "/bin/bash");
        assert!(resolve_shell("fish", &registry).is_none());
        // RDD 9.2章 セキュリティ要件: 任意パス指定は解決しない
        assert!(resolve_shell("/bin/evil", &registry).is_none());
        assert!(resolve_shell("../bash", &registry).is_none());
    }
}
