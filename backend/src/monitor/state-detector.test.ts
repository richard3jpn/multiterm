import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUIESCENCE_MS, TUI_QUIESCENCE_MS, StateDetector } from './state-detector';
import type { SessionStatus } from '../types';

const collectStatuses = (detector: StateDetector): SessionStatus[] => {
  const statuses: SessionStatus[] = [];
  detector.onStatusChange((status) => statuses.push(status));
  return statuses;
};

describe('StateDetector（RDD 7章 状態判定条件表）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('シナリオ①: 出力継続中は running', () => {
    const detector = new StateDetector();
    const statuses = collectStatuses(detector);

    detector.feed('building...\n');
    vi.advanceTimersByTime(100);
    detector.feed('step 1 done\n');
    vi.advanceTimersByTime(100);
    detector.feed('step 2 done\n');

    expect(detector.status).toBe('running');
    // 初期状態が running のため状態変化は発生しない
    expect(statuses).toEqual([]);
  });

  it('シナリオ②: コマンド完了後にプロンプトで静止すると idle（bash/zsh $）', () => {
    const detector = new StateDetector();
    detector.feed('done\nuser@host:~$ ');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('idle');
  });

  it.each(['%', '#'])('bash/zsh プロンプト記号 %s で idle', (symbol) => {
    const detector = new StateDetector();
    detector.feed(`host ${symbol} `);
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('idle');
  });

  it('powershell プロンプト（PS ...>）で idle', () => {
    const detector = new StateDetector();
    detector.feed('PS C:\\Users\\dev> ');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('idle');
  });

  it('汎用プロンプト（> 終端）で idle', () => {
    const detector = new StateDetector();
    detector.feed('node> ');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('idle');
  });

  it('cmd.exeプロンプト（C:\\Users\\foo>）で idle（RDD 9.5章）', () => {
    const detector = new StateDetector();
    detector.feed('C:\\Users\\foo>');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('idle');
  });

  it('PowerShellプロンプト（PS C:\\...>）で idle（RDD 9.5章）', () => {
    const detector = new StateDetector();
    detector.feed('PS C:\\Users\\foo> ');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('idle');
  });

  it('シナリオ③: 確認プロンプト（? 終端）で waiting-input', () => {
    const detector = new StateDetector();
    detector.feed('Overwrite file?');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('waiting-input');
  });

  it.each(['Continue? (y/n)', 'proceed [Y/N]: yes or no'])(
    'シナリオ③: y/n プロンプト "%s" で waiting-input',
    (line) => {
      const detector = new StateDetector();
      detector.feed(line);
      vi.advanceTimersByTime(QUIESCENCE_MS);
      expect(detector.status).toBe('waiting-input');
    },
  );

  it('シナリオ③: パスワードプロンプトで waiting-input', () => {
    const detector = new StateDetector();
    detector.feed("[sudo] password for user: ");
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('waiting-input');
  });

  it('シナリオ③: 「続行しますか」で waiting-input', () => {
    const detector = new StateDetector();
    detector.feed('続行しますか (はい/いいえ)');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('waiting-input');
  });

  it('シナリオ④: waiting と idle が同時一致する末尾行は waiting-input を優先', () => {
    const detector = new StateDetector();
    // 「?」終端（waiting）かつ「>」を含む…末尾は ? なので waiting、
    // さらに "(y/n)" は行中一致・"$" 終端は idle 一致という複合行で優先順位を検証
    detector.feed('continue (y/n) user@host:~$ ');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('waiting-input');
  });

  it('静止してもプロンプト非一致なら running のまま', () => {
    const detector = new StateDetector();
    detector.feed('long output without prompt\n');
    vi.advanceTimersByTime(QUIESCENCE_MS * 2);
    expect(detector.status).toBe('running');
  });

  it('ANSIエスケープを除去して判定する', () => {
    const detector = new StateDetector();
    detector.feed('\u001b[32muser@host\u001b[0m:~$ \u001b[?2004h');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('idle');
  });

  it('2文字ESCシーケンス（DECKPAM等）がプロンプト後に付いても idle 判定する', () => {
    // zsh実出力の末尾: "~>" + 改行の後に ESC[K ESC[?1h ESC= ESC[?2004h ESC[K が続く
    const detector = new StateDetector();
    detector.feed('~>\r\n\u001b[K\u001b[?1h\u001b=\u001b[?2004h\u001b[K');
    vi.advanceTimersByTime(QUIESCENCE_MS);
    expect(detector.status).toBe('idle');
  });

  it('状態変化時のみ通知する（同一状態の重複通知なし）', () => {
    const detector = new StateDetector();
    const statuses = collectStatuses(detector);

    detector.feed('a$ ');
    vi.advanceTimersByTime(QUIESCENCE_MS); // idle
    detector.feed('cmd output\n');         // running
    detector.feed('user@host:~$ ');
    vi.advanceTimersByTime(QUIESCENCE_MS); // idle
    vi.advanceTimersByTime(QUIESCENCE_MS); // 変化なし

    expect(statuses).toEqual(['idle', 'running', 'idle']);
  });

  describe('代替画面バッファ（TUIモード。Claude Code等）の判定（RDD 7章）', () => {
    it('代替画面に入り出力が静止したら waiting-input（TUIは静止＝ユーザー入力待ち）', () => {
      const detector = new StateDetector();
      detector.feed('[?1049h'); // 代替画面へ（TUI起動）
      // Claude Code の入力ボックス。シェルプロンプト非一致だが静止する
      detector.feed('╭─ Claude Code ─╮\r\n│ ❯ │\r\n╰────────────────╯');
      vi.advanceTimersByTime(TUI_QUIESCENCE_MS);
      expect(detector.status).toBe('waiting-input');
    });

    it('代替画面中でも出力継続中（スピナー再描画）は running', () => {
      const detector = new StateDetector();
      detector.feed('[?1049h');
      detector.feed('✻ Brewing… esc to interrupt');
      vi.advanceTimersByTime(100);
      detector.feed('✽');
      vi.advanceTimersByTime(100);
      detector.feed('✻');
      // 静止していないので running のまま
      expect(detector.status).toBe('running');
    });

    it('TUIモードはスピナー一時停止（QUIESCENCE < 空白 < TUI_QUIESCENCE）でwaitingに落ちない', () => {
      const detector = new StateDetector();
      const statuses: string[] = [];
      detector.onStatusChange((s) => statuses.push(s));
      detector.feed('[?1049h');
      detector.feed('✻ Brewing… esc to interrupt');
      // 通常閾値300msは超えるがTUI閾値1000ms未満の停止では running維持（ちらつき防止）
      vi.advanceTimersByTime(QUIESCENCE_MS + 200);
      expect(detector.status).toBe('running');
      detector.feed('✽'); // スピナー再開
      vi.advanceTimersByTime(QUIESCENCE_MS + 200);
      expect(detector.status).toBe('running');
      // この間 waiting-input への遷移が一度も起きていないこと
      expect(statuses).not.toContain('waiting-input');
    });

    it('代替画面を抜けたら（?1049l）通常のプロンプト判定に戻る', () => {
      const detector = new StateDetector();
      detector.feed('[?1049h');
      detector.feed('tui running');
      detector.feed('[?1049l'); // TUI終了
      detector.feed('user@host:~$ ');
      vi.advanceTimersByTime(QUIESCENCE_MS);
      expect(detector.status).toBe('idle');
    });

    it.each(['1049', '1047', '47'])('代替画面 enter シーケンス ?%sh を認識する', (code) => {
      const detector = new StateDetector();
      detector.feed(`[?${code}h`);
      detector.feed('❯ some tui prompt without shell symbol');
      vi.advanceTimersByTime(TUI_QUIESCENCE_MS);
      expect(detector.status).toBe('waiting-input');
    });

    it('bracketed paste（?2004h）は代替画面と誤認しない', () => {
      const detector = new StateDetector();
      detector.feed('user@host:~$ [?2004h');
      vi.advanceTimersByTime(QUIESCENCE_MS);
      expect(detector.status).toBe('idle');
    });
  });

  it('dispose 後はタイマー発火・通知が起きない', () => {
    const detector = new StateDetector();
    const statuses = collectStatuses(detector);
    detector.feed('user@host:~$ ');
    detector.dispose();
    vi.advanceTimersByTime(QUIESCENCE_MS * 2);
    expect(statuses).toEqual([]);
  });
});
