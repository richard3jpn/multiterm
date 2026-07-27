import { useState } from 'react';
import { Columns2, Rows2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SplitDirection } from '../features/layout/layout-tree';
import type { ShellInfo } from '../types';

interface SplitControlsProps {
  readonly shells: readonly ShellInfo[];
  /** shellId 未指定は既定シェル、指定時はそのシェルで分割（RDD 9.7章） */
  readonly onSplit: (direction: SplitDirection, shellId?: string | null) => void;
}

/**
 * ペイン分割ボタン（縦/横）。
 * シェルが複数検出されている場合はクリックでシェル選択メニューを開き、
 * 選んだシェルで分割する。1種類以下なら即・既定シェルで分割する（RDD 9.7章）。
 */
export function SplitControls({ shells, onSplit }: SplitControlsProps) {
  const [menuDir, setMenuDir] = useState<SplitDirection | null>(null);
  const multi = shells.length > 1;

  const handleClick = (direction: SplitDirection) => {
    if (multi) {
      setMenuDir((current) => (current === direction ? null : direction));
    } else {
      onSplit(direction);
    }
  };

  return (
    <div className="relative flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        title={multi ? '縦に分割（左右）— シェルを選択' : '縦に分割（左右）'}
        aria-label="縦に分割"
        aria-expanded={menuDir === 'vertical'}
        onClick={() => handleClick('vertical')}
      >
        <Columns2 />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title={multi ? '横に分割（上下）— シェルを選択' : '横に分割（上下）'}
        aria-label="横に分割"
        aria-expanded={menuDir === 'horizontal'}
        onClick={() => handleClick('horizontal')}
      >
        <Rows2 />
      </Button>

      {menuDir !== null && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuDir(null)} aria-hidden />
          <div
            role="menu"
            aria-label="分割で開くシェル"
            className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
              {menuDir === 'vertical' ? '縦に分割' : '横に分割'} — シェルを選択
            </div>
            {shells.map((shell) => (
              <button
                key={shell.id}
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onSplit(menuDir, shell.id);
                  setMenuDir(null);
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
