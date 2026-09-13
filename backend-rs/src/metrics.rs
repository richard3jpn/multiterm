//! アプリとセッションのリソース使用量（RDD 17章）。
//!
//! CPU使用率は2回の計測の差分から出る。そのため `System` は持ち回して連続で更新する。
//! 呼ばれるたびに作り直すと差分が取れず、常に 0% になる。

mod gpu;

use crate::types::{MetricsSnapshot, ProcessUsage, SessionUsage};
use gpu::Gpu;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// 親PID → 子PIDの一覧。プロセスツリーを下向きに辿るために毎回組み直す
type ChildrenMap = HashMap<Pid, Vec<Pid>>;

/// リソース使用量の計測器。
///
/// `System` が前回値を保持しているため、インスタンスを使い回す前提で作られている。
pub struct MetricsCollector {
    system: Mutex<System>,
    /// GPUカウンタも前回値との差分で出るため、同じく持ち回す（RDD 17.6章）
    gpu: Mutex<Gpu>,
    /// このプロセス自身のPID。アプリ全体の集計はここを根の1つにする
    own_pid: Pid,
    /// 物理メモリの総量。起動中に変わらないので一度だけ測る（RDD 17.6章）
    total_memory_bytes: u64,
}

impl MetricsCollector {
    pub fn new() -> Self {
        let mut system = System::new();
        // プロセスの更新では埋まらないため、総量はここで別に読む
        system.refresh_memory();
        let total_memory_bytes = system.total_memory();
        Self {
            system: Mutex::new(system),
            gpu: Mutex::new(Gpu::new()),
            own_pid: Pid::from_u32(std::process::id()),
            total_memory_bytes,
        }
    }

    /// 現在の使用量を測る。`session_pids` はセッションIDと、そのシェルのPIDの対。
    pub fn snapshot(&self, session_pids: &[(String, u32)]) -> MetricsSnapshot {
        let mut system = self.system.lock().unwrap();
        // CPUとメモリだけ更新する。コマンドラインや環境変数まで読むと目に見えて遅くなる
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );

        let children = children_map(&system);
        let gpu_by_pid = self.gpu.lock().unwrap().usage_by_pid();

        // アプリ全体は「自分のツリー」と「各セッションのツリー」の和集合で測る。
        // 自分の子孫を辿るだけにしないのは、Windows の ConPTY ではシェルが
        // このプロセスの直接の子として現れるとは限らないため。
        let mut roots = Vec::with_capacity(session_pids.len() + 1);
        roots.push(self.own_pid);
        roots.extend(session_pids.iter().map(|(_, pid)| Pid::from_u32(*pid)));
        let app = sum_forest(&system, &children, &roots, &gpu_by_pid);

        let sessions = session_pids
            .iter()
            .map(|(session_id, pid)| {
                let usage = sum_forest(&system, &children, &[Pid::from_u32(*pid)], &gpu_by_pid);
                SessionUsage {
                    session_id: session_id.clone(),
                    cpu_percent: usage.cpu_percent,
                    memory_bytes: usage.memory_bytes,
                    gpu_percent: usage.gpu_percent,
                }
            })
            .collect();

        MetricsSnapshot {
            app,
            sessions,
            // cpu_percent は1コアを100%として数えるので、全体に対する割合はこれで割る
            cpu_count: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
            // memory_bytes を割合へ直すのに使う
            total_memory_bytes: self.total_memory_bytes,
        }
    }
}

impl Default for MetricsCollector {
    fn default() -> Self {
        Self::new()
    }
}

/// 親から子を引けるようにする。`Process::parent()` は上向きにしか辿れないため
fn children_map(system: &System) -> ChildrenMap {
    let mut map: ChildrenMap = HashMap::new();
    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            map.entry(parent).or_default().push(*pid);
        }
    }
    map
}

/// 複数の根から辿れるプロセスすべての合計。
///
/// 根同士が親子関係にある場合に二重計上しないよう、訪問済みのPIDは飛ばす。
/// PIDの使い回しで親子が循環していても、同じ理由で無限ループにならない。
fn sum_forest(
    system: &System,
    children: &ChildrenMap,
    roots: &[Pid],
    gpu_by_pid: &HashMap<u32, f32>,
) -> ProcessUsage {
    let mut cpu_percent = 0.0;
    let mut memory_bytes = 0;
    let mut gpu_percent = 0.0;
    let mut seen: HashSet<Pid> = HashSet::new();
    let mut stack: Vec<Pid> = roots.to_vec();

    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        // 既に終了したプロセスは system 側に居ない。子だけ辿れることもあるので続行する
        if let Some(process) = system.process(pid) {
            cpu_percent += process.cpu_usage();
            memory_bytes += process.memory();
        }
        // GPUは sysinfo ではなくPDHから来るため、プロセスが居なくても引ける
        gpu_percent += gpu_by_pid.get(&pid.as_u32()).copied().unwrap_or(0.0);
        if let Some(kids) = children.get(&pid) {
            stack.extend(kids);
        }
    }

    ProcessUsage { cpu_percent, memory_bytes, gpu_percent }
}
