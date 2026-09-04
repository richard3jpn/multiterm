import { useRef, useState } from 'preact/hooks';
import { X } from './icons';
import {
  countPaneStates,
  paneDotClasses,
  paneStateLabel,
} from '../features/status/pane-state';
import type { PaneState } from '../features/status/pane-state';
import { sanitizeTitle } from '../features/session/title';
import { renameSession } from '../services/api';
import type { Session } from '../types';

/** サイドバーに1行として並ぶターミナル */
export interface SidebarItem {
  readonly sessionId: string;
  readonly title: string;
  readonly shellLabel: string;
  readonly state: PaneState;
  /** Alt+数字で移動できる序数（1〜9）。対象外は null */
  readonly index: number | null;
}

interface SidebarProps {
  readonly items: readonly SidebarItem[];
  readonly activeSessionId: string | null;
  readonly width: number;
  readonly onSelect: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  readonly onRenamed: (session: Session) => void;
}

/**
 * 開いているターミナルの一覧と、それぞれのAIエージェント状態を常時表示する。
 *
 * 分割が増えるとどのペインが入力待ちか見落としやすいため、
 * ペインを切り替えずに全体を見渡せる場所を用意する（herdr のサイドバーの考え方）。
 */
export function Sidebar({
  items,
  activeSessionId,
  width,
  onSelect,
  onClose,
  onRenamed,
}: SidebarProps) {
  const counts = countPaneStates(items.map((item) => item.state));
  // 名前を編集中の行。同時に編集できるのは1行だけ
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [renameError, setRenameError] = useState(false);
  const committingRef = useRef(false);
  // Escapeで閉じるとinputがDOMから外れてblurが走る。state更新は非同期で間に合わないため、
  // フラグでblur側の保存を止める
  const cancelledRef = useRef(false);

  const startEdit = (item: SidebarItem) => {
    cancelledRef.current = false; // 前回の編集で立ったフラグを持ち越さない
    setEditingId(item.sessionId);
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

  return (
    <aside
      className="flex shrink-0 flex-col bg-muted/30"
      style={{ width: `${width}px` }}
      aria-label="ターミナル一覧"
    >
      <div className="shrink-0 border-b px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          ターミナル
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          {counts.blocked > 0 && (
            <span className="font-semibold text-red-400">入力待ち {counts.blocked}</span>
          )}
          {counts.working > 0 && <span className="text-blue-400">実行中 {counts.working}</span>}
          {counts.done > 0 && <span className="text-amber-400">完了 {counts.done}</span>}
          {counts.blocked === 0 && counts.working === 0 && counts.done === 0 && (
            <span className="text-muted-foreground">すべて待機</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">ターミナルがありません</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => {
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
                          className={`h-5 min-w-0 flex-1 rounded border bg-background px-1 text-xs font-medium outline-none ${
                            renameError ? 'border-destructive' : 'border-input'
                          }`}
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
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {item.index}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{item.title}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {paneStateLabel(item.state)} · {item.shellLabel}
                          </span>
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
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
