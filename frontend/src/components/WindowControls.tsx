import { Minus, Square, X } from './icons';
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from '../features/window-controls/ipc';

/**
 * 窓の最小化・最大化・閉じる（RDD 16.7）。
 *
 * OSのタイトルバーを出していないため、この3つを画面側で用意する。
 * ブラウザで開いているときは呼び出し側が描画しない。
 *
 * ボタンだけは `app-region: no-drag` にしておく。親のヘッダーがドラッグ領域なので、
 * これが無いとボタンを押したつもりで窓が動く。
 */
export function WindowControls() {
  return (
    <div className="app-no-drag ml-1 flex shrink-0 items-center">
      <button
        type="button"
        title="最小化"
        aria-label="最小化"
        className="inline-flex h-7 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={minimizeWindow}
      >
        <Minus class="size-3.5" />
      </button>
      <button
        type="button"
        title="最大化 / 元に戻す"
        aria-label="最大化 / 元に戻す"
        className="inline-flex h-7 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={toggleMaximizeWindow}
      >
        <Square class="size-3" />
      </button>
      <button
        type="button"
        title="閉じる"
        aria-label="閉じる"
        // 閉じるだけ赤くする。Windows のタイトルバーと同じ作法で、押し間違いに気づける
        className="inline-flex h-7 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-red-600 hover:text-white"
        onClick={closeWindow}
      >
        <X class="size-4" />
      </button>
    </div>
  );
}
