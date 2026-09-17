import { useRef, useState } from 'preact/hooks';
import { Plus, X } from './icons';
import {
  countPaneStates,
  paneDotClasses,
  paneStateLabel,
} from '../features/status/pane-state';
import type { PaneState } from '../features/status/pane-state';
import { useSettings } from '../contexts/settings-context';
import { sanitizeTitle } from '../features/session/title';
import {
  formatCpuPercent,
  formatGpuPercent,
  formatMemoryPercent,
} from '../features/metrics/format';
import { DRAG_MIME } from '../features/layout/layout-tree';
import { renameSession } from '../services/api';
import type { Session, SessionUsage } from '../types';

/** サイドバーに1行として並ぶターミナル */
export interface SidebarItem {
  readonly sessionId: string;
  readonly title: string;
  readonly shellLabel: string;
  readonly state: PaneState;
  /** Alt+数字で移動できる序数（1〜9）。対象外は null */
  readonly index: number | null;
  /** このターミナルのリソース使用量（RDD 17章）。未取得は null */
  readonly usage: SessionUsage | null;
}

/** ターミナルをまとめるウィンドウの見出し（RDD 14章） */
export interface SidebarGroup {
  readonly windowId: string;
  readonly title: string;
  readonly active: boolean;
  /** このウィンドウ内のターミナルを集約した状態。閉じている面の異変に気づくために出す */
  readonly state: PaneState;
  /** Alt+Shift+数字で切り替えられる序数（1〜9）。対象外は null */
  readonly index: number | null;
  /** 最後の1つは閉じられない（ターミナルを置く面が無くなるため） */
  readonly canClose: boolean;
  readonly items: readonly SidebarItem[];
}

interface SidebarProps {
  readonly groups: readonly SidebarGroup[];
  readonly activeSessionId: string | null;
  readonly width: number;
  /** 論理コア数（RDD 17章）。各行のCPU使用率をマシン全体に対する割合へ直すのに使う */
  readonly cpuCount: number;
  /** マシンの物理メモリ総量（RDD 17.6章）。各行のメモリ量を割合へ直すのに使う */
  readonly totalMemoryBytes: number;
  readonly onSelect: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  readonly onRenamed: (session: Session) => void;
  readonly onAddWindow: () => void;
  readonly onSelectWindow: (windowId: string) => void;
  readonly onCloseWindow: (windowId: string) => void;
  readonly onRenameWindow: (windowId: string, title: string) => void;
  /** ペインをウィンドウ見出しへ落として別のウィンドウへ移す（RDD 19章） */
  readonly onMoveToWindow: (sessionId: string, windowId: string) => void;
}

/**
 * 開いているターミナルの一覧と、それぞれのAIエージェント状態を常時表示する。
 *
 * 分割が増えるとどのペインが入力待ちか見落としやすいため、
 * ペインを切り替えずに全体を見渡せる場所を用意する（herdr のサイドバーの考え方）。
 *
 * ウィンドウを分けても見落とさないよう、一覧は「いま見ているウィンドウ」に絞らず
 * 全ウィンドウを並べる。上部の集計も全ウィンドウを横断して数える（RDD 14章）。
 */
export function Sidebar({
  groups,
  activeSessionId,
  width,
  cpuCount,
  totalMemoryBytes,
  onSelect,
  onClose,
  onRenamed,
  onAddWindow,
  onSelectWindow,
  onCloseWindow,
  onRenameWindow,
  onMoveToWindow,
}: SidebarProps) {
  const counts = countPaneStates(groups.flatMap((group) => group.items.map((item) => item.state)));
  const isEmpty = groups.every((group) => group.items.length === 0);
  // ターミナルのフォントサイズ（RDD 9.1章）を一覧の基準サイズにする。
  // 各行の文字は em 指定なので、設定を変えるとサイドバーも一緒に拡大縮小する
  const { settings } = useSettings();
  // 名前を編集中の行。同時に編集できるのは1行だけ
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingWindowId, setEditingWindowId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [renameError, setRenameError] = useState(false);
  // ペインのドラッグが乗っているウィンドウ見出し（RDD 19章）
  const [dropWindowId, setDropWindowId] = useState<string | null>(null);
  const committingRef = useRef(false);
  // Escapeで閉じるとinputがDOMから外れてblurが走る。state更新は非同期で間に合わないため、
  // フラグでblur側の保存を止める
  const cancelledRef = useRef(false);

  const startEdit = (item: SidebarItem) => {
    cancelledRef.current = false; // 前回の編集で立ったフラグを持ち越さない
    setEditingId(item.sessionId);
    setEditingWindowId(null);
    setDraftTitle(item.title);
    setRenameError(false);
  };

  // Escapeで閉じるとinputがDOMから外れてblurが走る。draftTitleを元に戻してから閉じないと
  // blur側のcommitが編集中の値で保存してしまう（TerminalPanelのヘッダと同じ扱い）
  const cancelEdit = (item: SidebarItem) => {
    cancelledRef.current = true;
    setDraftTitle(item.title);
    setEditingId(null);
    setRenameError(false);
  };

  // TerminalPanel のヘッダと同じ規則で確定する（どちらで変えても sessions 経由で両方に反映される）
  const commitRename = async (item: SidebarItem) => {
    if (committingRef.current) return; // Enter + blur の二重発火を抑止
    const title = sanitizeTitle(draftTitle);
    if (title === null) {
      setRenameError(true);
      return;
    }
    if (title === item.title) {
      cancelEdit(item);
      return;
    }
    committingRef.current = true;
    try {
      onRenamed(await renameSession(item.sessionId, title));
      setEditingId(null);
      setRenameError(false);
    } catch {
      setRenameError(true);
    } finally {
      committingRef.current = false;
    }
  };

  const startWindowEdit = (group: SidebarGroup) => {
    cancelledRef.current = false;
    setEditingWindowId(group.windowId);
    setEditingId(null);
    setDraftTitle(group.title);
    setRenameError(false);
  };

  const cancelWindowEdit = (group: SidebarGroup) => {
    cancelledRef.current = true;
    setDraftTitle(group.title);
    setEditingWindowId(null);
    setRenameError(false);
  };

  // ウィンドウ名はlocalStorageにしか無いので、サーバへ問い合わせず同期的に確定する
  const commitWindowRename = (group: SidebarGroup) => {
    const title = sanitizeTitle(draftTitle);
    if (title === null) {
      setRenameError(true);
      return;
    }
    if (title !== group.title) onRenameWindow(group.windowId, title);
    setEditingWindowId(null);
    setRenameError(false);
  };

  const editorClasses = `h-5 min-w-0 flex-1 rounded border bg-background px-1 text-[0.92em] font-medium outline-none ${
    renameError ? 'border-destructive' : 'border-input'
  }`;

  const renderItem = (item: SidebarItem) => {
    const active = item.sessionId === activeSessionId;
    return (
      <li key={item.sessionId}>
        <div
          className={`group flex items-center gap-2 rounded px-2 py-1.5 ${
            active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          }`}
        >
          {/* keyを分けないと、Preactが編集UIと通常UIの子要素を再利用して壊す */}
          {editingId === item.sessionId ? (
            <div key="editor" className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={`inline-block size-2 shrink-0 rounded-full ${paneDotClasses(item.state)}`}
                aria-hidden
              />
              <input
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
                  void commitRename(item);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename(item);
                  if (e.key === 'Escape') cancelEdit(item);
                }}
                className={editorClasses}
                aria-label="セッション名を編集"
              />
            </div>
          ) : (
            <button
              key="row"
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title={`${item.title}（${item.shellLabel}） — ${paneStateLabel(item.state)}／ダブルクリックで名前を変更`}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(item.sessionId)}
              // mousedownで開くと後続のmouseup/clickが元のボタン位置に届いて
              // inputがblurし即座に閉じる。マウス操作の最後に来るdblclickで開く
              onDblClick={() => startEdit(item)}
            >
              <span
                className={`inline-block size-2 shrink-0 rounded-full ${paneDotClasses(item.state)}`}
                aria-hidden
              />
              {item.index !== null && (
                <span className="shrink-0 text-[0.77em] tabular-nums text-muted-foreground">
                  {item.index}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.92em] font-medium">{item.title}</span>
                <span className="block truncate text-[0.77em] text-muted-foreground">
                  {paneStateLabel(item.state)} · {item.shellLabel}
                </span>
                {/* 重いターミナルを名指しできるようにする（RDD 17章） */}
                {item.usage !== null && (
                  <span className="block truncate text-[0.77em] tabular-nums text-muted-foreground">
                    C:{formatCpuPercent(item.usage.cpuPercent, cpuCount)}{' '}
                    M:{formatMemoryPercent(item.usage.memoryBytes, totalMemoryBytes)}{' '}
                    G:{formatGpuPercent(item.usage.gpuPercent)}
                  </span>
                )}
              </span>
            </button>
          )}
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            title={`${item.title} を閉じる`}
            aria-label={`${item.title} を閉じる`}
            onClick={() => onClose(item.sessionId)}
          >
            <X class="size-3" />
          </button>
        </div>
      </li>
    );
  };

  const renderGroupHeader = (group: SidebarGroup) => (
    <div
      className={`group flex items-center gap-2 rounded px-2 py-1 ${
        group.active ? 'bg-accent/60' : 'hover:bg-accent/30'
      } ${dropWindowId === group.windowId ? 'ring-2 ring-primary' : ''}`}
      onDragOver={(event) => {
        // 非表示のウィンドウのペインはイベントを受け取れないので、見出しを落とし先にする
        if (!event.dataTransfer?.types.includes(DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropWindowId(group.windowId);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropWindowId(null);
      }}
      onDrop={(event) => {
        setDropWindowId(null);
        const dragged = event.dataTransfer?.getData(DRAG_MIME);
        if (!dragged) return;
        event.preventDefault();
        onMoveToWindow(dragged, group.windowId);
      }}
    >
      {editingWindowId === group.windowId ? (
        <div key="window-editor" className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`inline-block size-2 shrink-0 rounded-full ${paneDotClasses(group.state)}`}
            aria-hidden
          />
          <input
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
              commitWindowRename(group);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitWindowRename(group);
              if (e.key === 'Escape') cancelWindowEdit(group);
            }}
            className={editorClasses}
            aria-label="ウィンドウ名を編集"
          />
        </div>
      ) : (
        <button
          key="window-row"
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={`${group.title} — ${paneStateLabel(group.state)}／ダブルクリックで名前を変更`}
          aria-current={group.active ? 'true' : undefined}
          onClick={() => onSelectWindow(group.windowId)}
          onDblClick={() => startWindowEdit(group)}
        >
          <span
            className={`inline-block size-2 shrink-0 rounded-full ${paneDotClasses(group.state)}`}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[0.85em] font-semibold">{group.title}</span>
          {group.index !== null && (
            <span className="shrink-0 text-[0.77em] tabular-nums text-muted-foreground">
              ⇧{group.index}
            </span>
          )}
        </button>
      )}
      {group.canClose && (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          title={`${group.title} を閉じる`}
          aria-label={`${group.title} を閉じる`}
          onClick={() => onCloseWindow(group.windowId)}
        >
          <X class="size-3" />
        </button>
      )}
    </div>
  );

  return (
    <aside
      className="flex shrink-0 flex-col bg-muted/30"
      style={{ width: `${width}px`, fontSize: `${settings.fontSize}px` }}
      aria-label="ターミナル一覧"
    >
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[0.77em] font-medium uppercase tracking-wide text-muted-foreground">
            ターミナル
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="ウィンドウを追加"
            aria-label="ウィンドウを追加"
            onClick={onAddWindow}
          >
            <Plus class="size-3.5" />
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.85em]">
          {counts.blocked > 0 && (
            <span className="font-semibold text-red-400">入力待ち {counts.blocked}</span>
          )}
          {counts.working > 0 && <span className="text-blue-400">実行中 {counts.working}</span>}
          {counts.done > 0 && <span className="text-orange-300">完了 {counts.done}</span>}
          {counts.blocked === 0 && counts.working === 0 && counts.done === 0 && (
            <span className="text-muted-foreground">すべて待機</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {isEmpty && groups.length <= 1 ? (
          <p className="px-2 py-3 text-[0.92em] text-muted-foreground">ターミナルがありません</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {groups.map((group) => (
              <div key={group.windowId}>
                {renderGroupHeader(group)}
                {group.items.length === 0 ? (
                  <p className="px-4 py-1 text-[0.77em] text-muted-foreground">（空）</p>
                ) : (
                  <ul className="flex flex-col gap-0.5 pl-2">{group.items.map(renderItem)}</ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
