//! GPU使用率（RDD.md 17.6章）。
//!
//! Windows の `GPU Engine` パフォーマンスカウンタを PDH で読む。インスタンス名に
//! PID が入っているため、CPU・メモリと同じプロセスツリーで集計できる。
//!
//! sysinfo は GPU を扱わない。ベンダー固有のツール（nvidia-smi 等）も内蔵GPUでは使えないため、
//! OS のカウンタを読む方法しかない。

use std::collections::HashMap;

/// カウンタのインスタンス名から PID を取り出す。
///
/// 名前は `pid_26408_luid_0x00000000_0x0000f673_phys_0_eng_0_engtype_3d` の形。
/// この形に合わないインスタンス（システム全体のものなど）は None を返して読み飛ばす。
pub fn parse_pid(instance: &str) -> Option<u32> {
    instance.strip_prefix("pid_")?.split('_').next()?.parse().ok()
}

#[cfg(windows)]
mod platform {
    use super::parse_pid;
    use std::collections::HashMap;
    use windows::core::PCWSTR;
    use windows::Win32::System::Performance::{
        PdhAddCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
        PdhOpenQueryW,
    };

    /// 全プロセスの GPU エンジン使用率。`*` で一度に取り、名前から PID を拾う
    const COUNTER_PATH: &str = r"\GPU Engine(*)\Utilization Percentage";

    /// PDH のクエリを開いたまま持ち回す。
    ///
    /// カウンタは「前回の収集からの差分」で値が出る。呼ばれるたびに開き直すと
    /// 毎回0になるため、CPU使用率と同じくインスタンスを使い回す前提で作る。
    pub struct GpuCounter {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
    }

    // PDHのハンドルはスレッドを跨いで使える。Mutexで包んで持つため Send が要る
    unsafe impl Send for GpuCounter {}

    impl GpuCounter {
        /// カウンタが無い環境（GPUドライバがカウンタを出さない等）では None。
        pub fn new() -> Option<Self> {
            let path: Vec<u16> = COUNTER_PATH.encode_utf16().chain(std::iter::once(0)).collect();
            let mut query = PDH_HQUERY::default();
            let mut counter = PDH_HCOUNTER::default();
            unsafe {
                if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                    return None;
                }
                if PdhAddCounterW(query, PCWSTR(path.as_ptr()), 0, &mut counter) != 0 {
                    let _ = PdhCloseQuery(query);
                    return None;
                }
                // 1回目は差分の基準を作るだけ。値は次の収集から出る
                if PdhCollectQueryData(query) != 0 {
                    let _ = PdhCloseQuery(query);
                    return None;
                }
            }
            Some(Self { query, counter })
        }

        /// PID ごとの使用率。エンジン（3D・コピー・デコード等）ごとの値を足し合わせる。
        ///
        /// 取得に失敗しても操作の妨げにはならないので、空を返して次の収集に任せる。
        pub fn usage_by_pid(&self) -> HashMap<u32, f32> {
            let mut usage = HashMap::new();
            unsafe {
                if PdhCollectQueryData(self.query) != 0 {
                    return usage;
                }
                // 必要なバッファ長を1回目の呼び出しで聞く（PDH_MORE_DATA が返る）
                let mut size = 0u32;
                let mut count = 0u32;
                let status = PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut size,
                    &mut count,
                    None,
                );
                if status != PDH_MORE_DATA || size == 0 {
                    return usage;
                }

                let mut buffer = vec![0u8; size as usize];
                let items = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
                if PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut size,
                    &mut count,
                    Some(items),
                ) != 0
                {
                    return usage;
                }

                for index in 0..count as usize {
                    let item = &*items.add(index);
                    let Ok(name) = item.szName.to_string() else {
                        continue;
                    };
                    let Some(pid) = parse_pid(&name) else {
                        continue;
                    };
                    let value = item.FmtValue.Anonymous.doubleValue;
                    if value.is_finite() && value > 0.0 {
                        *usage.entry(pid).or_insert(0.0) += value as f32;
                    }
                }
            }
            usage
        }
    }

    impl Drop for GpuCounter {
        fn drop(&mut self) {
            unsafe {
                let _ = PdhCloseQuery(self.query);
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::collections::HashMap;

    /// Windows以外はGPUカウンタを読まない（RDD.md 16.5章の対応OS）。
    pub struct GpuCounter;

    impl GpuCounter {
        pub fn new() -> Option<Self> {
            None
        }

        pub fn usage_by_pid(&self) -> HashMap<u32, f32> {
            HashMap::new()
        }
    }
}

/// GPUカウンタ。使えない環境では常に空を返す
pub struct Gpu(Option<platform::GpuCounter>);

impl Gpu {
    pub fn new() -> Self {
        Self(platform::GpuCounter::new())
    }

    pub fn usage_by_pid(&self) -> HashMap<u32, f32> {
        self.0.as_ref().map(|counter| counter.usage_by_pid()).unwrap_or_default()
    }
}

impl Default for Gpu {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_pid_from_instance_name() {
        assert_eq!(
            parse_pid("pid_26408_luid_0x00000000_0x0000f673_phys_0_eng_0_engtype_3d"),
            Some(26408)
        );
        assert_eq!(parse_pid("pid_4_luid_0x00000000_0x0000f673_phys_0_eng_1_engtype_copy"), Some(4));
    }

    #[test]
    fn ignores_instances_without_pid() {
        assert_eq!(parse_pid("engtype_3d"), None);
        assert_eq!(parse_pid(""), None);
        assert_eq!(parse_pid("pid_"), None);
        assert_eq!(parse_pid("pid_abc_luid_0"), None);
    }
}
