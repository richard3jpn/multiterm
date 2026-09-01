use crate::utf8::trim_broken_prefix;
use std::collections::VecDeque;

/// 出力バッファ（RDD.md 7章: リングバッファ、上限200KB/セッション）。
///
/// Node版（`ring-buffer.ts`）は毎チャンクで `(buffer + chunk).slice(-limit)` を実行し、
/// 上限サイズの文字列を都度コピーしていた（O(limit) × チャンク数）。
/// ここでは `VecDeque<u8>` の真のリングバッファにして追記を O(chunk) にする。
pub struct RingBuffer {
    buf: VecDeque<u8>,
    limit: usize,
}

impl RingBuffer {
    pub fn new(limit: usize) -> Self {
        Self { buf: VecDeque::with_capacity(limit.min(64 * 1024)), limit }
    }

    /// 追記する。上限を超えた分は先頭から捨てる。
    pub fn append(&mut self, chunk: &[u8]) {
        if chunk.is_empty() || self.limit == 0 {
            return;
        }
        // チャンク単体が上限を超える場合は末尾 limit バイトだけを残す
        let chunk =
            if chunk.len() > self.limit { &chunk[chunk.len() - self.limit..] } else { chunk };
        let overflow = (self.buf.len() + chunk.len()).saturating_sub(self.limit);
        self.buf.drain(..overflow);
        self.buf.extend(chunk.iter().copied());
    }

    /// 再接続時のreplay用スナップショット。
    ///
    /// バイト単位で切っているため先頭がUTF-8の途中になりうる。不完全な
    /// 先頭バイト列は削ってから返す（末尾の不完全分は後続のdataフレームで補完される）。
    pub fn snapshot(&self) -> Vec<u8> {
        let bytes: Vec<u8> = self.buf.iter().copied().collect();
        trim_broken_prefix(&bytes).to_vec()
    }

    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_everything_under_limit() {
        let mut buf = RingBuffer::new(16);
        buf.append(b"abc");
        buf.append(b"def");
        assert_eq!(buf.snapshot(), b"abcdef");
        assert_eq!(buf.len(), 6);
    }

    #[test]
    fn drops_oldest_bytes_over_limit() {
        let mut buf = RingBuffer::new(4);
        buf.append(b"abcdef");
        assert_eq!(buf.snapshot(), b"cdef");
        assert_eq!(buf.len(), 4);
    }

    #[test]
    fn appending_across_calls_respects_limit() {
        let mut buf = RingBuffer::new(4);
        buf.append(b"ab");
        buf.append(b"cd");
        buf.append(b"ef");
        assert_eq!(buf.snapshot(), b"cdef");
    }

    #[test]
    fn ignores_empty_chunk() {
        let mut buf = RingBuffer::new(4);
        buf.append(b"ab");
        buf.append(b"");
        assert_eq!(buf.snapshot(), b"ab");
    }

    #[test]
    fn snapshot_skips_broken_leading_multibyte() {
        // "あいう" は 3バイト×3。上限7で入れると先頭1文字の1バイト目が欠ける
        let mut buf = RingBuffer::new(7);
        buf.append("あいう".as_bytes());
        assert_eq!(buf.len(), 7);
        assert_eq!(std::str::from_utf8(&buf.snapshot()).unwrap(), "いう");
    }

    #[test]
    fn zero_limit_keeps_nothing() {
        let mut buf = RingBuffer::new(0);
        buf.append(b"abc");
        assert!(buf.is_empty());
    }
}
