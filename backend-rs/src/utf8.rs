/// UTF-8 の継続バイト（0b10xxxxxx）か
fn is_continuation(byte: u8) -> bool {
    byte & 0b1100_0000 == 0b1000_0000
}

/// 先頭が UTF-8 の途中で切れている場合、その不完全なバイト列を落とす。
///
/// PTY出力をバイト単位で切り詰める箇所（リングバッファ・末尾行バッファ）で共通に使う。
pub fn trim_broken_prefix(bytes: &[u8]) -> &[u8] {
    let start = bytes.iter().position(|byte| !is_continuation(*byte)).unwrap_or(bytes.len());
    &bytes[start..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_valid_utf8_intact() {
        assert_eq!(trim_broken_prefix("あいう".as_bytes()), "あいう".as_bytes());
        assert_eq!(trim_broken_prefix(b"abc"), b"abc");
        assert_eq!(trim_broken_prefix(b""), b"");
    }

    #[test]
    fn drops_leading_continuation_bytes() {
        let bytes = "あいう".as_bytes();
        // 先頭1バイトを削った状態（残り2バイトは継続バイト）
        let broken = &bytes[1..];
        assert_eq!(std::str::from_utf8(trim_broken_prefix(broken)).unwrap(), "いう");
    }

    #[test]
    fn all_continuation_bytes_yield_empty() {
        assert!(trim_broken_prefix(&[0x81, 0x82, 0x83]).is_empty());
    }
}
