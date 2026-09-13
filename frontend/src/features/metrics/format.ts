/**
 * リソース使用量の表示（RDD 17章）。
 *
 * バックエンドは生の値（1コア=100%のCPU使用率、バイト単位のメモリ）を返す。
 * 画面に出すときの丸めと単位はここに集約する。
 */

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/**
 * CPU使用率をマシン全体に対する割合へ直す。
 *
 * バックエンドが返す値は1コアを100%として数えたもの。8コアの機械で1コアを
 * 使い切ると 100 になるが、体感としては「全体の12.5%」なのでコア数で割る。
 * タスクマネージャの見え方に合わせる意図。
 */
export const toMachineCpuPercent = (cpuPercent: number, cpuCount: number): number =>
  cpuCount <= 0 ? 0 : cpuPercent / cpuCount;

/** 画面に出すCPU使用率。動いているのに 0% と出ないよう小数1桁まで見せる */
export const formatCpuPercent = (cpuPercent: number, cpuCount: number): string =>
  `${toMachineCpuPercent(cpuPercent, cpuCount).toFixed(1)}%`;

/**
 * メモリ量をマシンの総量に対する割合へ直す（RDD 17.6章）。
 * 総量が取れない環境でも表示を壊さないよう、0以下なら0を返す。
 */
export const toMemoryPercent = (memoryBytes: number, totalMemoryBytes: number): number =>
  totalMemoryBytes <= 0 ? 0 : (memoryBytes / totalMemoryBytes) * 100;

/** 画面に出すメモリ使用率。CPUと桁を揃える */
export const formatMemoryPercent = (memoryBytes: number, totalMemoryBytes: number): string =>
  `${toMemoryPercent(memoryBytes, totalMemoryBytes).toFixed(1)}%`;

/**
 * 画面に出すGPU使用率（RDD 17.6章）。
 *
 * バックエンドはエンジン（3D・コピー・デコード等）ごとの割合を足して返す。
 * すでに割合なのでコア数のような換算は要らない。複数のエンジンを同時に使うと
 * 100を超えることがあるが、丸めずそのまま出す。
 */
export const formatGpuPercent = (gpuPercent: number): string =>
  `${Math.max(0, gpuPercent).toFixed(1)}%`;

/**
 * 画面に出すメモリ量。
 *
 * 桁が変わっても幅が暴れないよう、MBまでは整数、GBからは小数1桁にする。
 */
export const formatMemory = (bytes: number): string => {
  if (bytes < 0) return '0 KB';
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.round(bytes / KB)} KB`;
};
