import { X } from './icons';
import {
  countPaneStates,
  paneDotClasses,
  paneStateLabel,
} from '../features/status/pane-state';
import type { PaneState } from '../features/status/pane-state';

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
  readonly onSelect: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
}

/**
 * 開いているターミナルの一覧と、それぞれのAIエージェント状態を常時表示する。
 *
 * 分割が増えるとどのペインが入力待ちか見落としやすいため、
 * ペインを切り替えずに全体を見渡せる場所を用意する（herdr のサイドバーの考え方）。
 */
export function Sidebar({ items, activeSessionId, onSelect, onClose }: SidebarProps) {
  const counts = countPaneStates(items.map((item) => item.state));

  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r bg-muted/30"
      aria-label="ターミナル一覧"
    >
      <div className="shrink-0 border-b px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          ターミナル
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          {counts.blocked > 0 && (
            <span className="font-semibold text-yellow-500">入力待ち {counts.blocked}</span>
          )}
          {counts.working > 0 && <span className="text-blue-400">実行中 {counts.working}</span>}
          {counts.done > 0 && <span className="text-cyan-400">完了 {counts.done}</span>}
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
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      title={`${item.title}（${item.shellLabel}） — ${paneStateLabel(item.state)}`}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => onSelect(item.sessionId)}
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
                          {item.shellLabel} · {paneStateLabel(item.state)}
                        </span>
                      </span>
                    </button>
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
