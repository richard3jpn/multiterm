//! アプリとセッションのリソース使用量（RDD 17章）。
//!
//! CPU使用率は2回の計測の差分から出る。そのため `System` は持ち回して連続で更新する。
//! 呼ばれるたびに作り直すと差分が取れず、常に 0% になる。

use crate::types::{MetricsSnapshot, ProcessUsage, SessionUsage};
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
    /// このプロセス自身のPID。アプリ全体の集計はここを根の1つにする
    own_pid: Pid,
}

impl MetricsCollector {
    pub fn new() -> Self {
        Self {
            system: Mutex::new(System::new()),
            own_pid: Pid::from_u32(std::process::id()),
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

        // アプリ全体は「自分のツリー」と「各セッションのツリー」の和集合で測る。
        // 自分の子孫を辿るだけにしないのは、Windows の ConPTY ではシェルが
        // このプロセスの直接の子として現れるとは限らないため。
        let mut roots = Vec::with_capacity(session_pids.len() + 1);
        roots.push(self.own_pid);
        roots.extend(session_pids.iter().map(|(_, pid)| Pid::from_u32(*pid)));
        let app = sum_forest(&system, &children, &roots);

        let sessions = session_pids
            .iter()
            .map(|(session_id, pid)| {
                let usage = sum_forest(&system, &children, &[Pid::from_u32(*pid)]);
                SessionUsage {
                    session_id: session_id.clone(),
                    cpu_percent: usage.cpu_percent,
                    memory_bytes: usage.memory_bytes,
                }
            })
            .collect();

        MetricsSnapshot {
            app,
            sessions,
            // cpu_percent は1コアを100%として数えるので、全体に対する割合はこれで割る
            cpu_count: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
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
fn sum_forest(system: &System, children: &ChildrenMap, roots: &[Pid]) -> ProcessUsage {
    let mut cpu_percent = 0.0;
    let mut memory_bytes = 0;
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
        if let Some(kids) = children.get(&pid) {
            stack.extend(kids);
        }
    }

    ProcessUsage { cpu_percent, memory_bytes }
}
