import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { X } from './icons';
import { Button } from './primitives/Button';
import { SplitControls } from './SplitControls';
import { useSettings } from '../contexts/settings-context';
import { useTheme } from '../contexts/theme-context';
import { resolveFontFamily } from '../features/settings/settings';
import { sanitizeTitle } from '../features/session/title';
import {
  statusDotClasses,
  statusFrameClasses,
  statusHeaderClasses,
  statusLabel,
} from '../features/status/status-style';
import { renameSession } from '../services/api';
import { buildWsUrl, inputMessage, parseServerMessage, resizeMessage } from '../services/ws';
import { DRAG_MIME, resolveDropPosition } from '../features/layout/layout-tree';
import type { Session, SessionStatus, ShellInfo } from '../types';
import type { DropPosition, SplitDirection } from '../features/layout/layout-tree';

interface TerminalPanelProps {
  readonly session: Session;
  /** シェルの表示ラベル（RDD 9.5章。許可リストのlabel。未解決時はshell id） */
  readonly shellLabel: string;
  /** 分割時に選択可能なシェル一覧（RDD 9.7章） */
  readonly shells: readonly ShellInfo[];
  /** Alt+数字で移動する際の序数（1〜9）。10番目以降・対象外は null（RDD 9.6章） */
  readonly index: number | null;
  /** アクティブ（フォーカス対象）端末か（RDD 9.6章） */
  readonly active: boolean;
  /**
   * 表示中のウィンドウに属するか（RDD 14章）。
   *
   * 非表示のウィンドウは display:none で DOM に残すため、この端末はマウントされたまま
   * サイズが 0 になる。その状態で PTY へサイズを送ると 80×24 などに縮んで
   * 実行中の画面が崩れるので、非表示の間はフィットもリサイズ通知も行わない。
   */
  readonly visible: boolean;
  /** この端末をアクティブ化する（クリック・xtermフォーカス時） */
  readonly onActivate: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  /** shellId 未指定は既定シェル、指定時はそのシェルで分割（RDD 9.7章） */
  readonly onSplit: (sessionId: string, direction: SplitDirection, shellId?: string | null) => void;
  readonly onExited: (sessionId: string) => void;
  readonly onRenamed: (session: Session) => void;
  /** サイドバーで一覧表示するため、状態の変化を親へ伝える */
  readonly onStatusChange: (sessionId: string, status: SessionStatus) => void;
  /** ドラッグで運ばれてきたペインを、このペインの指定した側へ置く（RDD 15章） */
  readonly onMove: (sessionId: string, targetSessionId: string, position: DropPosition) => void;
}

/** 落とす位置のハイライト。落とした後にペインが占める側を半分だけ塗る */
const DROP_OVERLAY: Readonly<Record<DropPosition, string>> = {
  left: 'inset-y-0 left-0 w-1/2',
  right: 'inset-y-0 right-0 w-1/2',
  top: 'inset-x-0 top-0 h-1/2',
  bottom: 'inset-x-0 bottom-0 h-1/2',
};

/**
 * ConPTY を使っていることを xterm へ伝えるオプション（RDD 10.7章）。
 *
 * ConPTY は行が増えたときに自分の見え方で画面を描き直し、一度 scrollback へ入った行は
 * そこに残したままにする。これを伝えないと xterm は行が増えるたびに scrollback から
 * 行を引き戻し、ConPTY の描き直しと重なって表示が崩れる。
 *
 * `buildNumber` は reflow を切るかどうかの判定にしか使われず、21376 以上では
 * 指定の有無で結果が変わらない（@xterm/xterm の Buffer.ts）。OS判定を増やさないため渡さない。
 */
const WINDOWS_PTY_OPTION = navigator.userAgent.includes('Windows')
  ? { windowsPty: { backend: 'conpty' as const } }
  : {};

/**
 * ANSI 16色。Windows Terminal の既定スキーム「Campbell」に合わせる。
 *
 * xterm.js の既定パレットは Tango（GNOME Terminal 由来）で、緑 #4e9a06 や
 * シアン #06989a のように暗い。ダーク背景では沈んで「色が付いていない」ように見えるため、
 * 普段使っているターミナルと同じ発色にする。
 * 出典: https://learn.microsoft.com/en-us/windows/terminal/customize-settings/color-schemes
 */
const CAMPBELL_ANSI = {
  black: '#0C0C0C',
  red: '#C50F1F',
  green: '#13A10E',
  yellow: '#C19C00',
  blue: '#0037DA',
  magenta: '#881798',
  cyan: '#3A96DD',
  white: '#CCCCCC',
  brightBlack: '#767676',
  brightRed: '#E74856',
  brightGreen: '#16C60C',
  brightYellow: '#F9F1A5',
  brightBlue: '#3B78FF',
  brightMagenta: '#B4009E',
  brightCyan: '#61D6D6',
  brightWhite: '#F2F2F2',
} as const;

const XTERM_THEMES = {
  // 背景・前景はアプリの配色に合わせたまま、16色だけ Campbell を使う
  dark: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#e5e5e5', ...CAMPBELL_ANSI },
  // ライトテーマは白背景。Campbellの明色は視認性が落ちるため既定パレットのまま
  light: { background: '#ffffff', foreground: '#171717', cursor: '#171717' },
} as const;

export function TerminalPanel({
  session,
  shellLabel,
  shells,
  index,
  active,
  visible,
  onActivate,
  onClose,
  onSplit,
  onExited,
  onRenamed,
  onStatusChange,
  onMove,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<SessionStatus>(session.status);
  // WS購読のEffectはsession.idだけで張り直すため、最新のコールバックをrefで参照する
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  // 同じ理由で、表示中かどうかもrefで参照する（RDD 14章）
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [connected, setConnected] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  const [renameError, setRenameError] = useState(false);
  // ドラッグ中のペインを、このペインのどちら側へ落とすか（null はドラッグが乗っていない）
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const { theme } = useTheme();
  const { settings } = useSettings();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: settings.fontSize,
      fontFamily: resolveFontFamily(settings.fontFamilyId),
      theme: XTERM_THEMES[theme === 'light' ? 'light' : 'dark'],
      ...WINDOWS_PTY_OPTION,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(container);
    // RDD.md 3章・5章8項: WebGLアドオン有効化。非対応環境はデフォルトレンダラへフォールバック
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // フォールバック: xterm標準レンダラのまま継続
    }
    // 代替画面バッファ（Claude Code等のTUI）ではホイールをPTYへ転送しない。
    // 転送するとTUI側がホイールスクロールを自前処理して再描画し、
    // バッジ（例: Jump to bottom）が本文行へ上書きされて表示が崩れる。
    // 代替画面ではxterm自身のスクロールバックも存在しないため、抑止しても失う機能はない。
    term.attachCustomWheelEventHandler(() => term.buffer.active.type !== 'alternate');
    fit.fit();

    // Ctrl+V はブラウザのペースト（xtermのpasteハンドラ→ブラケットペースト）に任せる。
    // xtermに処理させると Ctrl+Vの制御文字 が送られるだけで、Claude Code等のTUIはこれを無視する。
    // falseを返すとxtermはこのキーを扱わずpreventDefaultもしないため、
    // ネイティブのpasteイベントが発火する（Windows Terminal と同じ挙動）。
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key === 'v'
      ) {
        return false;
      }
      return true;
    });

    const ws = new WebSocket(buildWsUrl(session.id));
    wsRef.current = ws;
    // PTY出力は生バイトで受け取り、xtermへ直接書き込む（JSONパースを挟まない）
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case 'replay':
        case 'data':
          term.write(message.data);
          break;
        case 'resync':
          // 配信の取りこぼし後にサーバが送り直した画面（RDD 10.6章）。
          // 取りこぼした分もこの中に入っているので、書き足すと二重になる。消してから書く
          term.reset();
          term.write(message.data);
          break;
        case 'status':
          setStatus(message.status);
          onStatusChangeRef.current(session.id, message.status);
          break;
        case 'exit':
          onExited(session.id);
          break;
        case 'error':
          term.writeln(`\r\n\u001b[31m[multiterm] ${message.error}\u001b[0m`);
          break;
      }
    };
    ws.onopen = () => {
      setConnected(true);
      // 非表示ウィンドウでは fit が効かず cols/rows が既定値（80×24）のままなので送らない。
      // 送るとバックエンドのPTYがその値に縮む（RDD 14章）。表示された時点で送り直す
      if (visibleRef.current) ws.send(resizeMessage(term.cols, term.rows));
    };
    // 予期しない切断は可視化する（黙って入力を捨てない）。意図的なクリーンアップ時は抑止
    let disposed = false;
    ws.onclose = () => {
      if (!disposed) {
        setConnected(false);
        term.writeln('\r\n[90m[multiterm] 接続が切断されました。リロードで再接続します[0m');
      }
    };
    ws.onerror = () => {
      if (!disposed) setConnected(false);
    };

    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(inputMessage(data));
    });

    const observer = new ResizeObserver(() => {
      // display:none になると 0×0 で発火する。そのままフィットするとPTYが潰れる（RDD 14章）
      if (!visibleRef.current) return;
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) ws.send(resizeMessage(term.cols, term.rows));
    });
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      dataDisposable.dispose();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
    // セッションごとに端末・WSを1度だけ生成する（テーマ・フォントは別Effectで反映）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    const term = termRef.current;
    if (term) {
      term.options.theme = XTERM_THEMES[theme === 'light' ? 'light' : 'dark'];
    }
  }, [theme]);

  /**
   * 表示に戻ったら測り直してPTYへ通知する（RDD 14章）。
   *
   * 隠れている間はフィットを止めているため cols/rows が古い。display の反映後でないと
   * 親のサイズが取れないので次のフレームで実行し、それでも測れない場合は送らない
   * （FitAddon は非表示要素に対して NaN を返す）。
   */
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      const fit = fitRef.current;
      const term = termRef.current;
      const ws = wsRef.current;
      if (!fit || !term) return;
      const dims = fit.proposeDimensions();
      if (!dims || Number.isNaN(dims.cols) || Number.isNaN(dims.rows)) return;
      fit.fit();
      if (ws?.readyState === WebSocket.OPEN) ws.send(resizeMessage(term.cols, term.rows));
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  // Alt+数字などでアクティブ化されたら実際のキーボードフォーカスを端末へ移す（RDD 9.6章）
  useEffect(() => {
    if (!active) return;
    // 名前編集中は端末へフォーカスを移さない。移すと入力欄がblurして編集が中断される
    // （サイドバーで未選択の行をダブルクリックしたとき、選択と編集開始が同時に起きる）
    if (document.activeElement instanceof HTMLInputElement) return;
    termRef.current?.focus();
  }, [active]);

  // RDD 9.1章: フォント設定の即時反映（再作成不要。オプション更新+再フィット）
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = resolveFontFamily(settings.fontFamilyId);
    term.options.fontSize = settings.fontSize;
    // 非表示のウィンドウでは測れない。表示に戻るEffectが測り直して送る（RDD 14章）
    if (!visibleRef.current) return;
    fitRef.current?.fit();
    // フィットで桁数・行数が変わるので、PTYへ通知しないと折り返し位置が食い違い、
    // 実行中のTUIの表示が崩れる（サイズ変更を伴う設定変更では必ず送る）
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(resizeMessage(term.cols, term.rows));
  }, [settings.fontFamilyId, settings.fontSize]);

  const committingRef = useRef(false);
  // Escapeで閉じるとinputがDOMから外れてblurが走る。state更新は非同期で間に合わないため、
  // フラグでblur側の保存を止める
  const cancelledRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // 編集開始時にフォーカスを入力欄へ移す。autoFocusだけでは
  // 直前にアクティブ化されたxtermがフォーカスを保持したままになる
  useEffect(() => {
    if (editing) titleInputRef.current?.focus();
  }, [editing]);
  const commitRename = async () => {
    if (committingRef.current) return; // Enter + blur の二重発火を抑止
    const title = sanitizeTitle(draftTitle);
    if (title === null) {
      setRenameError(true);
      return;
    }
    if (title === session.title) {
      setEditing(false);
      setRenameError(false);
      return;
    }
    committingRef.current = true;
    try {
      const updated = await renameSession(session.id, title);
      onRenamed(updated);
      setEditing(false);
      setRenameError(false);
    } catch {
      setRenameError(true);
    } finally {
      committingRef.current = false;
    }
  };

  /**
   * ドラッグが自分たちのペインのものか（RDD 15章）。
   * `dragover` の時点では `getData` が読めないため、型の有無だけで判定する。
   */
  const isPaneDrag = (transfer: DataTransfer | null): transfer is DataTransfer =>
    transfer !== null && transfer.types.includes(DRAG_MIME);

  /** ポインタ位置から落とす側を決める。ペイン全体の矩形で測る */
  const positionFromEvent = (event: JSX.TargetedDragEvent<HTMLDivElement>): DropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    return resolveDropPosition(
      rect.width,
      rect.height,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  };

  return (
    <div
      onMouseDown={() => onActivate(session.id)}
      onDragOver={(event) => {
        const transfer = event.dataTransfer;
        if (!isPaneDrag(transfer)) return;
        // preventDefault しないとブラウザが drop を発火させない
        event.preventDefault();
        transfer.dropEffect = 'move';
        setDropPosition(positionFromEvent(event));
      }}
      // 子要素へ移っただけの dragleave でハイライトが消えないよう、外へ出たときだけ消す
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropPosition(null);
      }}
      onDrop={(event) => {
        setDropPosition(null);
        const dragged = event.dataTransfer?.getData(DRAG_MIME);
        if (!dragged || dragged === session.id) return;
        event.preventDefault();
        onMove(dragged, session.id, positionFromEvent(event));
      }}
      className={`relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border-4 transition-colors ${
        connected ? statusFrameClasses(status) : 'border-gray-500 shadow-none'
      } ${active ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
    >
      {dropPosition !== null && (
        <div
          className={`pointer-events-none absolute z-10 rounded-sm bg-primary/30 ring-2 ring-primary ${DROP_OVERLAY[dropPosition]}`}
          aria-hidden
        />
      )}
      <div
        // 名前を編集している間はドラッグさせない（テキスト選択と競合する）
        draggable={!editing}
        onDragStart={(event) => {
          event.dataTransfer?.setData(DRAG_MIME, session.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDropPosition(null)}
        title="ドラッグして配置を変更"
        className={`flex shrink-0 items-center gap-2 border-b px-2 py-1 transition-colors ${
          editing ? '' : 'cursor-grab active:cursor-grabbing'
        } ${connected ? statusHeaderClasses(status) : 'bg-muted/50'}`}
      >
        {index !== null && (
          <span
            className={`inline-flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums ${
              active ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'
            }`}
            title={`Alt+${index} で移動`}
            aria-label={`ターミナル${index}（Alt+${index}で移動）`}
          >
            {index}
          </span>
        )}
        <span
          className={`inline-block size-2 rounded-full ${connected ? statusDotClasses(status) : 'bg-gray-500'}`}
        />
        {/* keyを分けないと、Preactが入力欄と表示ボタンの子要素を再利用して壊す */}
        {editing ? (
          <input
            key="editor"
            ref={titleInputRef}
            autoFocus
            value={draftTitle}
            maxLength={60}
            onInput={(e) => {
              setDraftTitle(e.currentTarget.value);
              setRenameError(false);
            }}
            onBlur={() => {
              if (cancelledRef.current) {
                cancelledRef.current = false;
                return;
              }
              void commitRename();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename();
              if (e.key === 'Escape') {
                cancelledRef.current = true;
                setDraftTitle(session.title);
                setEditing(false);
                setRenameError(false);
              }
            }}
            className={`h-5 w-40 rounded border bg-background px-1 text-xs font-medium outline-none ${
              renameError ? 'border-destructive' : 'border-input'
            }`}
            aria-label="セッション名を編集"
          />
        ) : (
          <button
            key="title"
            type="button"
            className="cursor-text truncate text-xs font-medium hover:underline"
            title="ダブルクリックして名前を変更"
            // mousedownで開くと後続のmouseup/clickが元のボタン位置に届いて
            // inputがblurし即座に閉じる。マウス操作の最後に来るdblclickで開く
            onDblClick={() => {
              cancelledRef.current = false; // 前回の編集で立ったフラグを持ち越さない
              setDraftTitle(session.title);
              setEditing(true);
            }}
          >
            {session.title}
          </button>
        )}
        {/* パネルが狭いときは折り返さずに省略する（サイドバー表示時に幅が減るため） */}
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={`シェル: ${shellLabel}`}
        >
          {shellLabel}
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {connected ? statusLabel(status) : '切断'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <SplitControls
            shells={shells}
            onSplit={(direction, shellId) => onSplit(session.id, direction, shellId)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            title="閉じる"
            onClick={() => onClose(session.id)}
          >
            <X />
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 bg-background p-1" />
    </div>
  );
}
