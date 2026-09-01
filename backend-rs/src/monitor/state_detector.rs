use crate::types::SessionStatus;
use crate::utf8::trim_broken_prefix;
use regex::Regex;
use std::sync::OnceLock;
use std::time::Duration;

/// RDD.md 7章: 出力静止とみなすまでの時間（通常シェル）
pub const QUIESCENCE_MS: u64 = 300;

/// TUIモード（代替画面）用の静止判定時間。
///
/// Claude Code 等はスピナー再描画が一時的に数百ms途切れることがあり、短い閾値だと
/// 実行中に running⇔waiting-input がちらつく。長めにして一時停止を吸収する（RDD.md 7章）。
pub const TUI_QUIESCENCE_MS: u64 = 1000;

/// 末尾行評価に保持する最大バイト数（大量出力時の軽量化。RDD.md 3章）。
/// Node版は512「文字」だったが、ここではバイト列で保持するためバイト単位。
/// 末尾行（プロンプト）の判定には十分な長さ。
const TAIL_LIMIT: usize = 512;

/// エージェント（Claude Code 等のTUI）を検出したあとに保持する末尾バイト数。
///
/// 承認UIは画面下部に複数行で描画され、罫線が1行200文字を超えることもあるため、
/// 512バイトでは選択肢まで届かない。評価は静止時にしか走らないのでコストは小さい。
const AGENT_TAIL_LIMIT: usize = 8192;

/// ANSIエスケープ（CSI / OSC / 2文字ESC / 制御文字）除去
fn ansi_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b.|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]",
        )
        .expect("ANSI除去パターンは静的に正しい")
    })
}

/// RDD.md 7章 状態判定条件表: シェルプロンプト（idle）
fn idle_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"[$%#]\s*$").unwrap(),  // bash / zsh
            Regex::new(r"^PS .*>\s*$").unwrap(), // powershell
            Regex::new(r">\s*$").unwrap(),       // 汎用（cmd.exe の C:\...> を含む）
        ]
    })
}

/// RDD.md 7章 状態判定条件表: 対話プロンプト（waiting-input）
fn waiting_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"[?？]\s*$").unwrap(),
            Regex::new(r"(?i)\(y/n\)").unwrap(),
            Regex::new(r"(?i)\[y/n\]").unwrap(),
            Regex::new(r"(?i)password.*:\s*$").unwrap(),
            Regex::new(r"続行しますか").unwrap(),
        ]
    })
}

/// ペインで動いているエージェント。
///
/// 代替画面で静止しただけで一律 waiting-input にすると、作業を終えて入力を
/// 待っているだけの状態まで「要対応」に見えてしまう。エージェントを識別できた
/// ときは、そのエージェント専用の画面パターンで判定する。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Agent {
    ClaudeCode,
}

/// 画面に現れるエージェントの目印。一度検出したらそのセッションでは保持する。
fn claude_code_markers() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"Claude Code v[0-9]").unwrap(),
            Regex::new(r"(?i)\bfor shortcuts\b").unwrap(),
            Regex::new(r"auto mode on \(shift\+tab to cycle\)").unwrap(),
        ]
    })
}

/// Claude Code が承認・選択を求めている画面のパターン。
///
/// 出典: Claude Code のパーミッションUI（code.claude.com/docs/en/permissions ほか）。
/// ここに一致したときだけ waiting-input とし、単に入力を待っている状態と区別する。
fn claude_code_blocked_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"(?i)do you want to proceed\?").unwrap(),
            Regex::new(r"(?i)do you want to (?:make|create|allow|run)").unwrap(),
            Regex::new(r"(?i)and don't ask again").unwrap(),
            Regex::new(r"(?i)tell claude what to do differently").unwrap(),
            Regex::new(r"(?i)requires approval").unwrap(),
            Regex::new(r"(?i)waiting for your input").unwrap(),
        ]
    })
}

/// 画面テキストからエージェントを識別する（herdr のスクリーンマニフェスト相当）
pub fn detect_agent(screen: &str) -> Option<Agent> {
    if claude_code_markers().iter().any(|pattern| pattern.is_match(screen)) {
        return Some(Agent::ClaudeCode);
    }
    None
}

/// エージェントの画面から状態を判定する（静止していることが前提）。
///
/// 承認・選択を求めていれば waiting-input、そうでなければ idle（作業を終えて待機）。
pub fn classify_agent_screen(agent: Agent, screen: &str) -> SessionStatus {
    match agent {
        Agent::ClaudeCode => {
            if claude_code_blocked_patterns().iter().any(|pattern| pattern.is_match(screen)) {
                SessionStatus::WaitingInput
            } else {
                SessionStatus::Idle
            }
        }
    }
}

/// 代替画面バッファ切替（DEC private mode 1049/1047/47）の enter シーケンス前半。
///
/// Claude Code・vim・less 等の全画面TUIが起動時に enter(h)、終了時に leave(l) を出す。
const ALT_SCREEN_PREFIXES: &[&[u8]] = &[b"\x1b[?1049", b"\x1b[?1047", b"\x1b[?47"];

/// チャンク内の代替画面切替を走査し、最後の切替を返す（enter=true / leave=false）。
///
/// Node版はチャンク全体に正規表現を掛けていた（O(chunk)の正規表現走査）。
/// ここでは ESC(0x1b) の出現位置だけを memchr で拾い、その周辺のみ照合する。
pub fn scan_alt_screen(chunk: &[u8]) -> Option<bool> {
    let mut last = None;
    for pos in memchr::memchr_iter(0x1b, chunk) {
        let rest = &chunk[pos..];
        for prefix in ALT_SCREEN_PREFIXES {
            if rest.len() > prefix.len() && rest.starts_with(prefix) {
                match rest[prefix.len()] {
                    b'h' => last = Some(true),
                    b'l' => last = Some(false),
                    _ => {}
                }
                break;
            }
        }
    }
    last
}

/// ANSI除去後、末尾の空行を飛ばして最後の非空行を返す
pub fn last_line(text: &str) -> String {
    let stripped = ansi_pattern().replace_all(text, "");
    stripped
        .split(['\r', '\n'])
        .rev()
        .find(|segment| !segment.trim().is_empty())
        .unwrap_or("")
        .to_string()
}

/// 静止時の末尾行から状態を判定する純関数（優先順位: waiting-input > idle > running）
pub fn classify_tail_line(line: &str) -> SessionStatus {
    if waiting_patterns().iter().any(|pattern| pattern.is_match(line)) {
        return SessionStatus::WaitingInput;
    }
    if idle_patterns().iter().any(|pattern| pattern.is_match(line)) {
        return SessionStatus::Idle;
    }
    SessionStatus::Running
}

/// PTY出力ストリームから SessionStatus を判定する（RDD.md 7章）。
///
/// タイマー制御は呼び出し側（session_manager）が行う。ここは同期的な状態遷移のみを持つ。
pub struct StateDetector {
    status: SessionStatus,
    tail: Vec<u8>,
    /// 代替画面バッファ（TUIモード）中か。enter(h)で true、leave(l)で false
    alt_screen: bool,
    /// 画面から識別したエージェント。一度検出したらセッション中は保持する
    agent: Option<Agent>,
}

impl Default for StateDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StateDetector {
    pub fn new() -> Self {
        Self {
            status: SessionStatus::Running,
            tail: Vec::with_capacity(TAIL_LIMIT),
            alt_screen: false,
            agent: None,
        }
    }

    pub fn status(&self) -> SessionStatus {
        self.status
    }

    pub fn alt_screen(&self) -> bool {
        self.alt_screen
    }

    pub fn agent(&self) -> Option<Agent> {
        self.agent
    }

    /// 保持する末尾バイト数。エージェント検出後は承認UIまで届くよう長めにする
    fn tail_limit(&self) -> usize {
        if self.agent.is_some() {
            AGENT_TAIL_LIMIT
        } else {
            TAIL_LIMIT
        }
    }

    /// 保持しているバイト列をANSI除去済みのテキストにする
    fn screen_text(&self) -> String {
        let raw = String::from_utf8_lossy(trim_broken_prefix(&self.tail));
        ansi_pattern().replace_all(&raw, "").into_owned()
    }

    /// 出力の静止とみなすまでの待ち時間。TUIモードでは長くしてちらつきを防ぐ（RDD.md 7章）
    pub fn quiescence(&self) -> Duration {
        Duration::from_millis(if self.alt_screen { TUI_QUIESCENCE_MS } else { QUIESCENCE_MS })
    }

    /// 出力チャンクを取り込む。状態が変化したら true。
    pub fn feed(&mut self, chunk: &[u8]) -> bool {
        if chunk.is_empty() {
            return false;
        }
        if let Some(entered) = scan_alt_screen(chunk) {
            self.alt_screen = entered;
        }
        // 末尾のみ保持して評価コストを一定に保つ（RDD.md 3章: 状態検知の軽量化）
        self.tail.extend_from_slice(chunk);
        let limit = self.tail_limit();
        if self.tail.len() > limit {
            let excess = self.tail.len() - limit;
            self.tail.drain(..excess);
        }
        // 代替画面のTUIだけをエージェント判定の対象にする（通常シェルは対象外）。
        // 一度検出したらそのセッションでは保持し、毎チャンクの走査はしない。
        if self.alt_screen && self.agent.is_none() {
            self.agent = detect_agent(&self.screen_text());
        }
        self.set_status(SessionStatus::Running)
    }

    /// 静止時の状態を判定する。
    ///
    /// エージェントを識別できていれば、その画面パターンで判定する（承認・選択を
    /// 求めているときだけ waiting-input）。識別できないTUIは従来どおり、出力停止を
    /// ユーザー入力待ちとみなす。通常画面では末尾行をシェルプロンプトとして評価する（RDD.md 7章）。
    pub fn evaluate(&self) -> SessionStatus {
        if let Some(agent) = self.agent {
            return classify_agent_screen(agent, &self.screen_text());
        }
        if self.alt_screen {
            return SessionStatus::WaitingInput;
        }
        let tail = String::from_utf8_lossy(trim_broken_prefix(&self.tail)).into_owned();
        classify_tail_line(&last_line(&tail))
    }

    /// 静止判定を適用する。状態が変化したら true。
    pub fn apply_quiescence(&mut self) -> bool {
        let next = self.evaluate();
        self.set_status(next)
    }

    fn set_status(&mut self, next: SessionStatus) -> bool {
        if next == self.status {
            return false;
        }
        self.status = next;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 静止（quiescence 経過）を模したヘルパ。タイマー自体は session_manager が持つ。
    fn quiesce(detector: &mut StateDetector) -> SessionStatus {
        detector.apply_quiescence();
        detector.status()
    }

    #[test]
    fn scenario1_running_while_output_continues() {
        let mut detector = StateDetector::new();
        detector.feed(b"building...\n");
        detector.feed(b"step 1 done\n");
        detector.feed(b"step 2 done\n");
        assert_eq!(detector.status(), SessionStatus::Running);
    }

    #[test]
    fn scenario2_idle_on_bash_prompt() {
        let mut detector = StateDetector::new();
        detector.feed(b"done\nuser@host:~$ ");
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }

    #[test]
    fn idle_on_percent_and_hash_prompts() {
        for symbol in ["%", "#"] {
            let mut detector = StateDetector::new();
            detector.feed(format!("host {symbol} ").as_bytes());
            assert_eq!(quiesce(&mut detector), SessionStatus::Idle, "symbol={symbol}");
        }
    }

    #[test]
    fn idle_on_powershell_prompt() {
        let mut detector = StateDetector::new();
        detector.feed(br"PS C:\Users\dev> ");
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }

    #[test]
    fn idle_on_generic_prompt() {
        let mut detector = StateDetector::new();
        detector.feed(b"node> ");
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }

    /// RDD 9.5章 受け入れ基準4: cmd.exe プロンプトが既存の汎用idleパターンで判定される
    #[test]
    fn idle_on_cmd_prompt() {
        let mut detector = StateDetector::new();
        detector.feed(br"C:\Users\foo>");
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }

    #[test]
    fn scenario3_waiting_on_question_mark() {
        let mut detector = StateDetector::new();
        detector.feed(b"Overwrite file?");
        assert_eq!(quiesce(&mut detector), SessionStatus::WaitingInput);
    }

    #[test]
    fn scenario3_waiting_on_yes_no_prompts() {
        for line in ["Continue? (y/n)", "proceed [Y/N]: yes or no"] {
            let mut detector = StateDetector::new();
            detector.feed(line.as_bytes());
            assert_eq!(quiesce(&mut detector), SessionStatus::WaitingInput, "line={line}");
        }
    }

    #[test]
    fn scenario3_waiting_on_password_prompt() {
        let mut detector = StateDetector::new();
        detector.feed(b"[sudo] password for user: ");
        assert_eq!(quiesce(&mut detector), SessionStatus::WaitingInput);
    }

    #[test]
    fn scenario3_waiting_on_japanese_confirmation() {
        let mut detector = StateDetector::new();
        detector.feed("続行しますか (はい/いいえ)".as_bytes());
        assert_eq!(quiesce(&mut detector), SessionStatus::WaitingInput);
    }

    /// RDD 7章 受け入れ基準④: waiting と idle が同時一致する末尾行は waiting-input 優先
    #[test]
    fn scenario4_waiting_wins_over_idle() {
        let mut detector = StateDetector::new();
        detector.feed(b"continue (y/n) user@host:~$ ");
        assert_eq!(quiesce(&mut detector), SessionStatus::WaitingInput);
    }

    #[test]
    fn stays_running_when_quiescent_without_prompt() {
        let mut detector = StateDetector::new();
        detector.feed(b"long output without prompt\n");
        assert_eq!(quiesce(&mut detector), SessionStatus::Running);
    }

    #[test]
    fn strips_ansi_before_classifying() {
        let mut detector = StateDetector::new();
        detector.feed(b"\x1b[32muser@host\x1b[0m:~$ \x1b[?2004h");
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }

    /// zsh実出力の末尾: "~>" + 改行の後に ESC[K ESC[?1h ESC= ESC[?2004h ESC[K が続く
    #[test]
    fn strips_two_char_escape_sequences() {
        let mut detector = StateDetector::new();
        detector.feed(b"~>\r\n\x1b[K\x1b[?1h\x1b=\x1b[?2004h\x1b[K");
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }

    #[test]
    fn reports_status_change_only_on_transition() {
        let mut detector = StateDetector::new();
        assert!(!detector.feed(b"a$ "), "初期状態が running のため running への遷移は変化なし");
        assert!(detector.apply_quiescence(), "running -> idle は変化");
        assert!(detector.feed(b"cmd output\n"), "idle -> running は変化");
        detector.feed(b"user@host:~$ ");
        assert!(detector.apply_quiescence(), "running -> idle は変化");
        assert!(!detector.apply_quiescence(), "同じ idle の再評価は変化なし");
    }

    // ---- 代替画面バッファ（TUIモード。Claude Code等）の判定（RDD 7章） ----

    #[test]
    fn alt_screen_quiescence_means_waiting_input() {
        let mut detector = StateDetector::new();
        detector.feed(b"\x1b[?1049h"); // 代替画面へ（TUI起動）
        // Claude Code の入力ボックス。シェルプロンプト非一致だが静止する
        detector.feed("╭─ Claude Code ─╮\r\n│ ❯ │\r\n╰────────────────╯".as_bytes());
        assert_eq!(quiesce(&mut detector), SessionStatus::WaitingInput);
    }

    #[test]
    fn alt_screen_keeps_running_while_output_continues() {
        let mut detector = StateDetector::new();
        detector.feed(b"\x1b[?1049h");
        detector.feed("✻ Brewing… esc to interrupt".as_bytes());
        detector.feed("✽".as_bytes());
        detector.feed("✻".as_bytes());
        assert_eq!(detector.status(), SessionStatus::Running);
    }

    /// スピナー一時停止（QUIESCENCE < 空白 < TUI_QUIESCENCE）でwaitingに落ちないための閾値
    #[test]
    fn alt_screen_uses_longer_quiescence() {
        let mut detector = StateDetector::new();
        assert_eq!(detector.quiescence(), Duration::from_millis(QUIESCENCE_MS));
        detector.feed(b"\x1b[?1049h");
        assert_eq!(detector.quiescence(), Duration::from_millis(TUI_QUIESCENCE_MS));
        assert!(TUI_QUIESCENCE_MS > QUIESCENCE_MS);
    }

    #[test]
    fn leaving_alt_screen_restores_prompt_classification() {
        let mut detector = StateDetector::new();
        detector.feed(b"\x1b[?1049h");
        detector.feed(b"tui running");
        detector.feed(b"\x1b[?1049l"); // TUI終了
        detector.feed(b"user@host:~$ ");
        assert!(!detector.alt_screen());
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }

    #[test]
    fn recognizes_all_alt_screen_enter_sequences() {
        for code in ["1049", "1047", "47"] {
            let mut detector = StateDetector::new();
            detector.feed(format!("\x1b[?{code}h").as_bytes());
            detector.feed("❯ some tui prompt without shell symbol".as_bytes());
            assert_eq!(quiesce(&mut detector), SessionStatus::WaitingInput, "code={code}");
        }
    }

    #[test]
    fn bracketed_paste_is_not_mistaken_for_alt_screen() {
        let mut detector = StateDetector::new();
        detector.feed(b"user@host:~$ \x1b[?2004h");
        assert!(!detector.alt_screen());
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }

    #[test]
    fn scan_alt_screen_returns_last_switch_in_chunk() {
        assert_eq!(scan_alt_screen(b"\x1b[?1049h"), Some(true));
        assert_eq!(scan_alt_screen(b"\x1b[?1049l"), Some(false));
        assert_eq!(scan_alt_screen(b"\x1b[?1049h ... \x1b[?1049l"), Some(false));
        assert_eq!(scan_alt_screen(b"no escapes here"), None);
        assert_eq!(scan_alt_screen(b"\x1b[?2004h"), None);
        assert_eq!(scan_alt_screen(b"\x1b[0m"), None);
    }

    #[test]
    fn tail_is_capped_but_still_classifies_prompt() {
        let mut detector = StateDetector::new();
        detector.feed(&vec![b'x'; TAIL_LIMIT * 3]);
        detector.feed(b"\nuser@host:~$ ");
        assert_eq!(quiesce(&mut detector), SessionStatus::Idle);
    }
}

#[cfg(test)]
mod agent_tests {
    use super::*;

    /// 実機の Claude Code 起動直後の画面（入力待ち）。ANSI除去後のテキストを模したもの
    const CLAUDE_IDLE_SCREEN: &str = concat!(
        " ▐▛███▛█   Claude Code v2.1.251\r\n",
        "▝▜██████▀  Opus 5 (1M context) with xhigh effort · Claude Team\r\n",
        "  ▝▝ ▝▝    C:\\Users\\dev\r\n",
        "  ⏵⏵ auto mode on (shift+tab to cycle)\r\n",
        "  ⚠ Transcript saving is off\r\n",
        "───────────────────────────────\r\n",
        "❯ \r\n",
    );

    /// 承認を求めている画面（Claude Code のパーミッションUI）
    const CLAUDE_BLOCKED_SCREEN: &str = concat!(
        " ▐▛███▛█   Claude Code v2.1.251\r\n",
        "  ⏵⏵ auto mode on (shift+tab to cycle)\r\n",
        "───────────────────────────────\r\n",
        "Bash(rm -rf build)\r\n",
        "Do you want to proceed?\r\n",
        "  1. Yes\r\n",
        "  2. Yes, and don't ask again this session (shift+tab)\r\n",
        "  3. No, and tell Claude what to do differently (esc)\r\n",
    );

    #[test]
    fn detects_claude_code_from_screen() {
        assert_eq!(detect_agent(CLAUDE_IDLE_SCREEN), Some(Agent::ClaudeCode));
        assert_eq!(detect_agent(CLAUDE_BLOCKED_SCREEN), Some(Agent::ClaudeCode));
    }

    #[test]
    fn does_not_detect_agent_from_plain_shell() {
        assert_eq!(detect_agent(r"PS C:\Users\dev> "), None);
        assert_eq!(detect_agent("user@host:~$ ls -la"), None);
        assert_eq!(detect_agent(""), None);
    }

    /// 入力を待っているだけの画面は「要対応」にしない（herdr: blocked は承認UIのときだけ）
    #[test]
    fn idle_screen_is_not_blocked() {
        assert_eq!(
            classify_agent_screen(Agent::ClaudeCode, CLAUDE_IDLE_SCREEN),
            SessionStatus::Idle
        );
    }

    #[test]
    fn approval_screen_is_blocked() {
        assert_eq!(
            classify_agent_screen(Agent::ClaudeCode, CLAUDE_BLOCKED_SCREEN),
            SessionStatus::WaitingInput
        );
    }

    #[test]
    fn recognizes_each_approval_wording() {
        for screen in [
            "Do you want to proceed?",
            "Do you want to make this edit to config.ts?",
            "2. Yes, and don't ask again this session",
            "3. No, and tell Claude what to do differently (esc)",
            "This command requires approval",
        ] {
            assert_eq!(
                classify_agent_screen(Agent::ClaudeCode, screen),
                SessionStatus::WaitingInput,
                "screen={screen}"
            );
        }
    }

    /// 検出後は代替画面で静止しても、承認UIが無ければ idle のまま
    #[test]
    fn detector_uses_agent_rules_after_detection() {
        let mut detector = StateDetector::new();
        detector.feed(b"\x1b[?1049h");
        detector.feed(CLAUDE_IDLE_SCREEN.as_bytes());
        assert_eq!(detector.agent(), Some(Agent::ClaudeCode));
        detector.apply_quiescence();
        assert_eq!(detector.status(), SessionStatus::Idle);
    }

    #[test]
    fn detector_blocks_when_approval_appears() {
        let mut detector = StateDetector::new();
        detector.feed(b"\x1b[?1049h");
        detector.feed(CLAUDE_IDLE_SCREEN.as_bytes());
        detector.feed(CLAUDE_BLOCKED_SCREEN.as_bytes());
        detector.apply_quiescence();
        assert_eq!(detector.status(), SessionStatus::WaitingInput);
    }

    /// エージェントを識別できないTUI（vim等）は従来どおり静止＝入力待ち
    #[test]
    fn unknown_tui_keeps_previous_behaviour() {
        let mut detector = StateDetector::new();
        detector.feed(b"\x1b[?1049h");
        detector.feed("~\r\n~\r\n\"file.txt\" 3L, 42B".as_bytes());
        assert_eq!(detector.agent(), None);
        detector.apply_quiescence();
        assert_eq!(detector.status(), SessionStatus::WaitingInput);
    }

    /// 通常シェルはエージェント判定の対象外（代替画面に入っていないため）
    #[test]
    fn plain_shell_is_not_agent_detected() {
        let mut detector = StateDetector::new();
        detector.feed("Claude Code v2.1.251 と書かれただけの出力\r\nuser@host:~$ ".as_bytes());
        assert_eq!(detector.agent(), None);
        detector.apply_quiescence();
        assert_eq!(detector.status(), SessionStatus::Idle);
    }

    /// 承認UIは画面下部に長い罫線とともに出るため、512バイトでは届かない
    #[test]
    fn agent_tail_is_long_enough_for_approval_ui() {
        let mut detector = StateDetector::new();
        detector.feed(b"\x1b[?1049h");
        detector.feed(CLAUDE_IDLE_SCREEN.as_bytes());
        // 罫線だらけの再描画が挟まっても、承認UIが tail に残ること
        let filler = "─".repeat(600);
        detector.feed(filler.as_bytes());
        detector.feed(CLAUDE_BLOCKED_SCREEN.as_bytes());
        detector.apply_quiescence();
        assert_eq!(detector.status(), SessionStatus::WaitingInput);
    }
}
