import type { SessionStatus } from '../types';

/** RDD.md 7章: 出力静止とみなすまでの時間（通常シェル） */
export const QUIESCENCE_MS = 300;

/**
 * TUIモード（代替画面）用の静止判定時間。
 * Claude Code 等はスピナー再描画が一時的に数百ms途切れることがあり、短い閾値だと
 * 実行中に running⇔waiting-input がちらつく。長めにして一時停止を吸収する（RDD.md 7章）。
 */
export const TUI_QUIESCENCE_MS = 1000;

/** 末尾行評価に保持する最大文字数（大量出力時の軽量化。RDD.md 3章） */
const TAIL_LIMIT = 512;

/** ANSIエスケープ（CSI / OSC / 単独ESC）除去 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN =
  /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b.|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * 代替画面バッファ切替（DEC private mode 1049/1047/47）。
 * Claude Code・vim・less 等の全画面TUIが起動時に enter(h)、終了時に leave(l) を出す。
 * TUIでは実行中は再描画が続き、入力待ちになると出力が静止する（RDD.md 7章）。
 */
// eslint-disable-next-line no-control-regex
const ALT_SCREEN_PATTERN = /\x1b\[\?(?:1049|1047|47)[hl]/g;

/** RDD.md 7章 状態判定条件表: シェルプロンプト（idle） */
const IDLE_PATTERNS: readonly RegExp[] = [
  /[$%#]\s*$/, // bash / zsh
  /^PS .*>\s*$/, // powershell
  />\s*$/, // 汎用
];

/** RDD.md 7章 状態判定条件表: 対話プロンプト（waiting-input） */
const WAITING_PATTERNS: readonly RegExp[] = [
  /[?？]\s*$/,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /password.*:\s*$/i,
  /続行しますか/,
];

const lastLine = (text: string): string => {
  const stripped = text.replace(ANSI_PATTERN, '');
  const segments = stripped.split(/[\r\n]/);
  // 末尾の空行（改行終端）を飛ばして最後の非空行を評価する
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment.trim() !== '') return segment;
  }
  return '';
};

const matchesAny = (line: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(line));

/** 静止時の末尾行から状態を判定する純関数（優先順位: waiting-input > idle > running） */
export const classifyTailLine = (line: string): SessionStatus => {
  if (matchesAny(line, WAITING_PATTERNS)) return 'waiting-input';
  if (matchesAny(line, IDLE_PATTERNS)) return 'idle';
  return 'running';
};

/**
 * PTY出力ストリームから SessionStatus を判定する（RDD.md 7章）。
 * - 出力受信中は running
 * - QUIESCENCE_MS 静止後に末尾行をパターン評価
 */
export class StateDetector {
  private currentStatus: SessionStatus = 'running';
  private tail = '';
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(status: SessionStatus) => void> = [];
  private disposed = false;
  /** 代替画面バッファ（TUIモード）中か。enter(h)で true、leave(l)で false */
  private altScreen = false;

  get status(): SessionStatus {
    return this.currentStatus;
  }

  onStatusChange(listener: (status: SessionStatus) => void): void {
    this.listeners = [...this.listeners, listener];
  }

  feed(chunk: string): void {
    if (this.disposed || chunk === '') return;
    this.updateAltScreen(chunk);
    // 末尾のみ保持して評価コストを一定に保つ（RDD.md 3章: 状態検知の軽量化）
    this.tail = (this.tail + chunk).slice(-TAIL_LIMIT);
    this.setStatus('running');
    this.scheduleEvaluation();
  }

  /** チャンク内の代替画面切替を走査し、最後の切替で TUI モード状態を更新する */
  private updateAltScreen(chunk: string): void {
    const matches = chunk.match(ALT_SCREEN_PATTERN);
    if (matches === null) return;
    this.altScreen = matches[matches.length - 1].endsWith('h');
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners = [];
  }

  private scheduleEvaluation(): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = this.altScreen ? TUI_QUIESCENCE_MS : QUIESCENCE_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setStatus(this.evaluate());
    }, delay);
  }

  /**
   * 静止時の状態を判定する。
   * TUIモード（代替画面）では出力停止＝ユーザー入力待ち（実行中は再描画が続くため
   * ここに到達しない）。通常画面では末尾行をシェルプロンプトとして評価する（RDD.md 7章）。
   */
  private evaluate(): SessionStatus {
    if (this.altScreen) return 'waiting-input';
    return classifyTailLine(lastLine(this.tail));
  }

  private setStatus(next: SessionStatus): void {
    if (this.disposed || next === this.currentStatus) return;
    this.currentStatus = next;
    for (const listener of this.listeners) listener(next);
  }
}
