import { NewTerminalButton } from './NewTerminalButton';
import { SplitPane } from './SplitPane';
import { TerminalPanel } from './TerminalPanel';
import { collectSessionIds } from '../features/layout/layout-tree';
import { resolveShellLabel } from '../features/settings/shell-label';
import type { SplitDirection, SplitPath } from '../features/layout/layout-tree';
import type { TermWindow } from '../features/window/window-model';
import type { Session, SessionStatus, ShellInfo } from '../types';

interface WindowViewProps {
  readonly termWindow: TermWindow;
  /** 表示中のウィンドウか。非表示でもDOMには残す（RDD 14章） */
  readonly visible: boolean;
  readonly sessions: readonly Session[];
  readonly shells: readonly ShellInfo[];
  readonly defaultShellId: string | null;
  readonly onCreate: (shellId?: string | null) => void;
  readonly onActivate: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  readonly onSplit: (sessionId: string, direction: SplitDirection, shellId?: string | null) => void;
  readonly onExited: (sessionId: string) => void;
  readonly onRenamed: (session: Session) => void;
  readonly onStatusChange: (sessionId: string, status: SessionStatus) => void;
  readonly onRatioChange: (path: SplitPath, ratio: number) => void;
}

/**
 * 1つのウィンドウの中身（分割されたターミナル群）。
 *
 * Alt+数字の序数はウィンドウごとに1から振る。数字は「いま見ているウィンドウの
 * N番目」を指すため、ウィンドウをまたいで通し番号にはしない。
 */
export function WindowView({
  termWindow,
  visible,
  sessions,
  shells,
  defaultShellId,
  onCreate,
  onActivate,
  onClose,
  onSplit,
  onExited,
  onRenamed,
  onStatusChange,
  onRatioChange,
}: WindowViewProps) {
  const orderedIds = termWindow.layout === null ? [] : collectSessionIds(termWindow.layout);

  const renderLeaf = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    const order = orderedIds.indexOf(sessionId);
    return (
      <TerminalPanel
        session={session}
        shellLabel={resolveShellLabel(session.shell, shells)}
        shells={shells}
        index={order >= 0 && order < 9 ? order + 1 : null}
        // 隠れているウィンドウの端末にはフォーカスを渡さない。表示に戻った時点で
        // false→true と変わり、フォーカス移動のEffectが走る
        active={visible && sessionId === termWindow.activeSessionId}
        visible={visible}
        onActivate={onActivate}
        onClose={onClose}
        onSplit={onSplit}
        onExited={onExited}
        onRenamed={onRenamed}
        onStatusChange={onStatusChange}
      />
    );
  };

  if (termWindow.layout === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">ターミナルがありません</p>
        <NewTerminalButton shells={shells} defaultShellId={defaultShellId} onCreate={onCreate} />
      </div>
    );
  }

  return (
    <SplitPane
      node={termWindow.layout}
      path={[]}
      renderLeaf={renderLeaf}
      onRatioChange={onRatioChange}
    />
  );
}
