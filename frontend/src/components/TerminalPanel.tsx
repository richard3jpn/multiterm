import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SplitControls } from './SplitControls';
import { useSettings } from '../contexts/settings-context';
import { useTheme } from '../contexts/theme-context';
import { resolveFontFamily } from '../features/settings/settings';
import { sanitizeTitle } from '../features/session/title';
import { statusDotClasses, statusFrameClasses, statusLabel } from '../features/status/status-style';
import { renameSession } from '../services/api';
import { buildWsUrl, inputMessage, parseServerMessage, resizeMessage } from '../services/ws';
import type { Session, SessionStatus, ShellInfo } from '../types';
import type { SplitDirection } from '../features/layout/layout-tree';

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
  /** この端末をアクティブ化する（クリック・xtermフォーカス時） */
  readonly onActivate: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  /** shellId 未指定は既定シェル、指定時はそのシェルで分割（RDD 9.7章） */
  readonly onSplit: (sessionId: string, direction: SplitDirection, shellId?: string | null) => void;
  readonly onExited: (sessionId: string) => void;
  readonly onRenamed: (session: Session) => void;
}

const XTERM_THEMES = {
  dark: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#e5e5e5' },
  light: { background: '#ffffff', foreground: '#171717', cursor: '#171717' },
} as const;

export function TerminalPanel({
  session,
  shellLabel,
  shells,
  index,
  active,
  onActivate,
  onClose,
  onSplit,
  onExited,
  onRenamed,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<SessionStatus>(session.status);
  const [connected, setConnected] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  const [renameError, setRenameError] = useState(false);
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
    fit.fit();

    const ws = new WebSocket(buildWsUrl(session.id));

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case 'replay':
        case 'data':
          term.write(message.data);
          break;
        case 'status':
          setStatus(message.status);
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
      ws.send(resizeMessage(term.cols, term.rows));
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

  // Alt+数字などでアクティブ化されたら実際のキーボードフォーカスを端末へ移す（RDD 9.6章）
  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  // RDD 9.1章: フォント設定の即時反映（再作成不要。オプション更新+再フィット）
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = resolveFontFamily(settings.fontFamilyId);
    term.options.fontSize = settings.fontSize;
    fitRef.current?.fit();
  }, [settings.fontFamilyId, settings.fontSize]);

  const committingRef = useRef(false);
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

  return (
    <div
      onMouseDown={() => onActivate(session.id)}
      className={`flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border-4 transition-colors ${
        connected ? statusFrameClasses(status) : 'border-gray-500 shadow-none'
      } ${active ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/50 px-2 py-1">
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
        {editing ? (
          <input
            autoFocus
            value={draftTitle}
            maxLength={60}
            onChange={(e) => {
              setDraftTitle(e.target.value);
              setRenameError(false);
            }}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename();
              if (e.key === 'Escape') {
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
            type="button"
            className="cursor-text text-xs font-medium hover:underline"
            title="クリックして名前を変更"
            onClick={() => {
              setDraftTitle(session.title);
              setEditing(true);
            }}
          >
            {session.title}
          </button>
        )}
        <span className="text-xs text-muted-foreground" title={`シェル: ${shellLabel}`}>
          {shellLabel}
        </span>
        <span className="text-xs text-muted-foreground">
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
