/// ConPTY がシェル起動時に送る DSR（Device Status Report / カーソル位置問い合わせ）。
///
/// ConPTY はこの問い合わせに応答があるまでシェルの出力を開始しない。
/// Node版はブラウザの xterm が応答し、それが WS 経由で PTY に返ることで先へ進んでいたため、
/// クライアント未接続のセッションは起動しなかった。ここではバックエンドが応答する。
const DSR_QUERY: &[u8] = b"\x1b[6n";

/// DSR への応答（カーソル位置 1行1列）。ConPTY にとっては起動シグナルとして機能する。
pub const DSR_RESPONSE: &[u8] = b"\x1b[1;1R";

/// チャンクから DSR 問い合わせを取り除く。
///
/// 含まれない場合は None を返し、大量出力時に無駄なコピーを発生させない。
pub fn strip_dsr(chunk: &[u8]) -> Option<Vec<u8>> {
    let first = memchr::memmem::find(chunk, DSR_QUERY)?;
    let mut out = Vec::with_capacity(chunk.len());
    out.extend_from_slice(&chunk[..first]);
    let mut rest = &chunk[first + DSR_QUERY.len()..];
    while let Some(pos) = memchr::memmem::find(rest, DSR_QUERY) {
        out.extend_from_slice(&rest[..pos]);
        rest = &rest[pos + DSR_QUERY.len()..];
    }
    out.extend_from_slice(rest);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_without_dsr() {
        assert!(strip_dsr(b"hello world").is_none());
        assert!(strip_dsr(b"").is_none());
        // 他のエスケープは除去しない
        assert!(strip_dsr(b"\x1b[32mgreen\x1b[0m").is_none());
        assert!(strip_dsr(b"\x1b[6m").is_none());
        // ESC 単独（チャンク末尾で切れたケース）も落とさない
        assert!(strip_dsr(b"tail\x1b").is_none());
    }

    #[test]
    fn keeps_other_escapes_around_dsr() {
        assert_eq!(strip_dsr(b"\x1b[?25l\x1b[6n\x1b[?25h"), Some(b"\x1b[?25l\x1b[?25h".to_vec()));
    }

    #[test]
    fn strips_lone_dsr() {
        assert_eq!(strip_dsr(b"\x1b[6n"), Some(Vec::new()));
    }

    #[test]
    fn strips_dsr_keeping_surrounding_output() {
        assert_eq!(strip_dsr(b"before\x1b[6nafter"), Some(b"beforeafter".to_vec()));
    }

    #[test]
    fn strips_multiple_dsr_occurrences() {
        assert_eq!(strip_dsr(b"\x1b[6na\x1b[6nb\x1b[6n"), Some(b"ab".to_vec()));
    }

    #[test]
    fn keeps_prompt_output_intact() {
        // cmd.exe 起動時の実出力を模した形（\x5c はバックスラッシュ）
        let chunk = b"\x1b[6nMicrosoft Windows [Version 10.0]\r\nC:\x5cUsers\x5cdev>";
        assert_eq!(
            strip_dsr(chunk),
            Some(b"Microsoft Windows [Version 10.0]\r\nC:\x5cUsers\x5cdev>".to_vec())
        );
    }

    #[test]
    fn response_is_cursor_position_report() {
        assert_eq!(DSR_RESPONSE, b"\x1b[1;1R");
    }
}
