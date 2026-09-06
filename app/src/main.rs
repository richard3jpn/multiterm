//! `multiterm-app`: サーバと画面の窓を同じプロセスで動かす実行ファイル（RDD 16章）。
//!
//! ブラウザのタブではなく独立した窓で開く。中身は `multiterm-backend` と同じサーバで、
//! 子プロセスとして起動するのではなくライブラリとして同居させている。
//! プロセスが1つで済み、常駐メモリの小ささ（RDD 3章）をそのまま保てる。

// Windows でコンソール窓を出さない。デバッグビルドでは出したままにして、
// パニックやログを目で追えるようにする
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::sync::mpsc;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::platform::run_return::EventLoopExtRunReturn;
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

/// 起動時の窓の大きさ。分割したターミナルが最初から2枚並ぶ程度を既定にする
const WINDOW_WIDTH: f64 = 1280.0;
const WINDOW_HEIGHT: f64 = 800.0;

fn main() {
    // tao のイベントループはメインスレッドでしか回せない（Windows / macOS の制約）。
    // そこで tokio ランタイムを別スレッドへ置き、サーバはそちらで動かす。
    let (bound_tx, bound_rx) = mpsc::channel::<String>();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let server = std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(runtime) => runtime,
            Err(error) => return Err(format!("tokio ランタイムを作成できません: {error}")),
        };
        runtime.block_on(async move {
            multiterm_backend::serve(
                |address| {
                    // 受け手が居なくても（窓の生成に失敗した等）サーバは動かし続ける
                    let _ = bound_tx.send(address.to_string());
                },
                async move {
                    // 送信側が落ちた場合も終了扱いにする（窓が消えたのと同じ）
                    let _ = shutdown_rx.await;
                },
            )
            .await
        })
    });

    // バインドが済むまで待つ。先に窓を出すと、まだ listen していないポートへ
    // 接続しにいって真っ白な画面になる。
    let address = match bound_rx.recv() {
        Ok(address) => address,
        Err(_) => {
            // 送信側が落ちた = バインド前に serve が失敗した。理由はスレッドの戻り値にある
            match server.join() {
                Ok(Err(error)) => eprintln!("[multiterm] {error}"),
                Err(_) => eprintln!("[multiterm] サーバスレッドが異常終了しました"),
                Ok(Ok(())) => eprintln!("[multiterm] サーバが起動前に終了しました"),
            }
            std::process::exit(1);
        }
    };
    let url = format!("http://{address}");

    let mut event_loop = EventLoop::new();
    let window = match WindowBuilder::new()
        .with_title("MultiTerm")
        .with_inner_size(tao::dpi::LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT))
        .build(&event_loop)
    {
        Ok(window) => window,
        Err(error) => {
            eprintln!("[multiterm] ウィンドウを作成できません: {error}");
            let _ = shutdown_tx.send(());
            let _ = server.join();
            std::process::exit(1);
        }
    };

    let builder = WebViewBuilder::new().with_url(&url);
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let webview = builder.build(&window);
    // Linux では WebView を GTK のコンテナへ入れる（wry の Unix 向け作法）
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        match window.default_vbox() {
            Some(vbox) => builder.build_gtk(vbox),
            None => Err(wry::Error::MessageSender),
        }
    };
    if let Err(error) = webview {
        eprintln!("[multiterm] WebViewを作成できません: {error}");
        let _ = shutdown_tx.send(());
        let _ = server.join();
        std::process::exit(1);
    }

    // 窓を閉じたときにサーバへ終了を伝えるための置き場。イベントは複数回来るので Option で1度だけ送る
    let mut shutdown = Some(shutdown_tx);
    // run ではなく run_return を使うのは、閉じたあとにサーバの後始末（PTYの終了）を
    // 待ってから抜けるため。run はそのままプロセスを終わらせてしまう。
    event_loop.run_return(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            if let Some(sender) = shutdown.take() {
                let _ = sender.send(());
            }
            *control_flow = ControlFlow::Exit;
        }
    });

    match server.join() {
        Ok(Err(error)) => {
            eprintln!("[multiterm] {error}");
            std::process::exit(1);
        }
        Err(_) => {
            eprintln!("[multiterm] サーバスレッドが異常終了しました");
            std::process::exit(1);
        }
        Ok(Ok(())) => {}
    }
}
