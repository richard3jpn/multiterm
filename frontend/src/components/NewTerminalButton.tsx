import { useState } from 'preact/hooks';
import { ChevronDown, Plus } from './icons';
import { Button } from './primitives/Button';
import type { ShellInfo } from '../types';

interface NewTerminalButtonProps {
  readonly shells: readonly ShellInfo[];
  /** 直前に選んだシェルid（本体ボタンの既定）。null はサーバ既定 */
  readonly defaultShellId: string | null;
  /** shellId=null はサーバ既定シェルで作成 */
  readonly onCreate: (shellId: string | null) => void;
}

/**
 * 新規ターミナル作成のスプリットボタン（VSCode風。RDD 9.5章）。
 * 本体クリックで既定シェル、▼でシェル種類を直接選んで作成する（設定窓を介さない）。
 */
export function NewTerminalButton({ shells, defaultShellId, onCreate }: NewTerminalButtonProps) {
  const [open, setOpen] = useState(false);

  const defaultLabel =
    shells.find((s) => s.id === defaultShellId)?.label ?? 'サーバ既定';

  return (
    <div className="relative flex items-center">
      <Button
        size="sm"
        className="rounded-r-none"
        title={`新規ターミナル（${defaultLabel}）`}
        onClick={() => onCreate(defaultShellId)}
      >
        <Plus />
        新規ターミナル
      </Button>
      <Button
        size="icon-sm"
        className="rounded-l-none border-l border-l-primary-foreground/20"
        aria-label="シェルの種類を選択"
        aria-expanded={open}
        title="シェルの種類を選択"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            aria-label="新規ターミナルのシェル"
            className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
              シェルを選んで作成
            </div>
            {shells.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                検出されたシェルがありません
              </div>
            )}
            {shells.map((shell) => (
              <button
                key={shell.id}
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onCreate(shell.id);
                  setOpen(false);
                }}
              >
                {shell.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
