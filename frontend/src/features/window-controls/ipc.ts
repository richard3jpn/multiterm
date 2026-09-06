/**
 * デスクトップの窓を画面側から操作する（RDD 16.7）。
 *
 * OSのタイトルバーを出していないため、移動・リサイズ・最小化・最大化・閉じるは
 * すべてここから wry の IPC 経由でネイティブ側へ頼む。
 * ブラウザで開いたときは `window.ipc` が無いので、どの関数も何もしない。
 */

/** 枠を掴んだと見なす幅（CSSピクセル）。**Rust 側の `RESIZE_INSET` と同じ値にすること** */
export const RESIZE_INSET = 5;

interface WryIpc {
  postMessage(message: string): void;
}

/** wry が注入する `window.ipc`。ブラウザには存在しない */
const ipc = (): WryIpc | null => {
  const candidate = (globalThis as { ipc?: unknown }).ipc;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const post = (candidate as { postMessage?: unknown }).postMessage;
  return typeof post === 'function' ? (candidate as WryIpc) : null;
};

/** デスクトップの窓の中で動いているか。ブラウザのタブなら false */
export const isDesktopApp = (): boolean => ipc() !== null;

export const minimizeWindow = (): void => ipc()?.postMessage('minimize');
export const toggleMaximizeWindow = (): void => ipc()?.postMessage('maximize');
export const closeWindow = (): void => ipc()?.postMessage('close');
/** 押した場所から窓の移動を始める（ヘッダーのドラッグ） */
export const startWindowDrag = (): void => ipc()?.postMessage('drag_window');

/**
 * ポインタが窓の枠付近に居るか。
 *
 * 枠の内外だけを見て、どの辺かはネイティブ側で判定する。
 * 画面側は「IPCを送るかどうか」を決められればよいため。
 */
export const isNearEdge = (x: number, y: number, width: number, height: number): boolean =>
  x < RESIZE_INSET ||
  y < RESIZE_INSET ||
  x >= width - RESIZE_INSET ||
  y >= height - RESIZE_INSET;

/**
 * 窓の枠を掴んでリサイズできるようにする。戻り値を呼ぶと解除する。
 *
 * **枠の近くに居る間と、離れた直後の1回だけ IPC を送る。** 公式サンプルのように
 * mousemove を毎回送ると、ターミナルを操作している間ずっとIPCが飛び続けて重くなる。
 * 離れた直後にも1回送るのは、変わったままのカーソル形状を既定へ戻すため。
 */
export const setupWindowResize = (): (() => void) => {
  const target = ipc();
  if (target === null) return () => {};

  let wasNearEdge = false;

  const onMouseMove = (event: MouseEvent) => {
    const near = isNearEdge(event.clientX, event.clientY, innerWidth, innerHeight);
    if (near || wasNearEdge) {
      target.postMessage(`mousemove:${event.clientX},${event.clientY}`);
    }
    wasNearEdge = near;
  };

  const onMouseDown = (event: MouseEvent) => {
    // 左ボタンで枠を掴んだときだけ。右クリックや中クリックでは始めない
    if (event.button !== 0) return;
    if (!isNearEdge(event.clientX, event.clientY, innerWidth, innerHeight)) return;
    target.postMessage(`mousedown:${event.clientX},${event.clientY}`);
  };

  addEventListener('mousemove', onMouseMove);
  addEventListener('mousedown', onMouseDown);
  return () => {
    removeEventListener('mousemove', onMouseMove);
    removeEventListener('mousedown', onMouseDown);
  };
};
