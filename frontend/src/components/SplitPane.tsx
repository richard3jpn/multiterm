import { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { clampRatio } from '../features/layout/layout-tree';
import type { LayoutNode, SplitPath } from '../features/layout/layout-tree';

interface SplitPaneProps {
  readonly node: LayoutNode;
  readonly path: SplitPath;
  readonly renderLeaf: (sessionId: string) => ReactNode;
  readonly onRatioChange: (path: SplitPath, ratio: number) => void;
}

/** 二分木レイアウトの再帰レンダラ（境界線ドラッグで比率変更。RDD 5章5項） */
export function SplitPane({ node, path, renderLeaf, onRatioChange }: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDividerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (node.type !== 'split') return;
      const container = containerRef.current;
      if (!container) return;
      event.preventDefault();
      const isVertical = node.direction === 'vertical';
      const rect = container.getBoundingClientRect();

      const handleMove = (moveEvent: PointerEvent) => {
        const ratio = isVertical
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
        onRatioChange(path, clampRatio(ratio));
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [node, path, onRatioChange],
  );

  if (node.type === 'leaf') {
    return <div className="h-full w-full min-h-0 min-w-0">{renderLeaf(node.sessionId)}</div>;
  }

  const isVertical = node.direction === 'vertical';
  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${isVertical ? 'flex-row' : 'flex-col'}`}
    >
      <div
        className="min-h-0 min-w-0"
        style={{ flex: `0 0 calc(${node.ratio * 100}% - 3px)` }}
      >
        <SplitPane
          node={node.first}
          path={[...path, 'first']}
          renderLeaf={renderLeaf}
          onRatioChange={onRatioChange}
        />
      </div>
      <div
        role="separator"
        aria-orientation={isVertical ? 'vertical' : 'horizontal'}
        onPointerDown={handleDividerPointerDown}
        className={`shrink-0 bg-border transition-colors hover:bg-primary/60 ${
          isVertical ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
        }`}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <SplitPane
          node={node.second}
          path={[...path, 'second']}
          renderLeaf={renderLeaf}
          onRatioChange={onRatioChange}
        />
      </div>
    </div>
  );
}
