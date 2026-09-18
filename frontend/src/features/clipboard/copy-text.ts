/**
 * 選択した文字をクリップボードへ書く。
 *
 * デスクトップアプリ（WebView2）では `navigator.clipboard` が使えないことがあるため、
 * 失敗したら非表示の textarea を選択して `execCommand('copy')` へ落とす。
 * どちらの経路も使えなかったことは呼び出し側へ返す（黙って成功扱いにしない）。
 */
export const copyText = async (text: string): Promise<boolean> => {
  if (text === '') return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyByTextarea(text);
  }
};

/** 旧来の経路。画面に見えない位置へ置いた textarea を選択してコピーさせる */
const copyByTextarea = (text: string): boolean => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // スクロール位置を動かさないよう、画面外ではなく固定配置の透明な要素にする
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
};
