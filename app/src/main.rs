//! `multiterm-app`: サーバと画面の窓を同じプロセスで動かす実行ファイル（RDD 16章）。
//!
//! ブラウザのタブではなく独立した窓で開く。中身は `multiterm-backend` と同じサーバで、
//! 子プロセスとして起動するのではなくライブラリとして同居させている。
//! プロセスが1つで済み、常駐メモリの小ささ（RDD 3章）をそのまま保てる。
//!
//! OSのタイトルバーは出さない（RDD 16.7）。アプリのヘッダーがその役目を兼ねるため、
//! 窓の移動・リサイズ・最小化・最大化・閉じるは画面側から IPC で受けて実行する。

// Windows でコンソール窓を出さない。デバッグビルドでは出したままにして、
// パニックやログを目で追えるようにする
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::sync::mpsc;
use tao::dpi::{LogicalSize, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::platform::run_return::EventLoopExtRunReturn;
#[cfg(target_os = "windows")]
use tao::platform::windows::WindowBuilderExtWindows;
use tao::window::{CursorIcon, Icon, ResizeDirection, WindowBuilder};
use wry::http::Request;
use wry::WebViewBuilder;

/// 窓とタスクバーのアイコン（RDD 16.7）。
///
/// exe のリソースへ埋め込むだけでは**タスクバーに反映されない**。Windows は
/// タスクバーのアイコンをウィンドウのアイコン（`WM_SETICON`）から取り、exe の
/// リソースはエクスプローラーでの表示と、ウィンドウ側が未設定のときの
/// フォールバックにすぎないため。ここで実行時にも読んで窓へ持たせる。
const ICON_BYTES: &[u8] = include_bytes!("../../frontend/public/favicon.ico");

/// 起動時の窓の大きさ。分割したターミナルが最初から2枚並ぶ程度を既定にする
const WINDOW_WIDTH: f64 = 1280.0;
const WINDOW_HEIGHT: f64 = 800.0;

/// 枠を掴んだと見なす幅（論理px）。**画面側の判定と同じ値にすること**。
/// ここだけ広げても、画面側が IPC を送ってこなければカーソルは変わらない。
const RESIZE_INSET: f64 = 5.0;

/// 画面から届く操作。IPCの文字列をこれへ直してイベントループへ流す
enum UserEvent {
    Minimize,
    ToggleMaximize,
    DragWindow,
    Close,
    MouseDown(i32, i32),
    MouseMove(i32, i32),
}

/// ポインタが窓のどこにあるか。枠の上なら掴んでリサイズできる
enum HitTest {
    Client,
    Left,
    Right,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl HitTest {
    /// 枠の上なら、その辺に応じたリサイズ方向。内側なら None
    fn resize_direction(&self) -> Option<ResizeDirection> {
        match self {
            HitTest::Left => Some(ResizeDirection::West),
            HitTest::Right => Some(ResizeDirection::East),
            HitTest::Top => Some(ResizeDirection::North),
            HitTest::Bottom => Some(ResizeDirection::South),
            HitTest::TopLeft => Some(ResizeDirection::NorthWest),
            HitTest::TopRight => Some(ResizeDirection::NorthEast),
            HitTest::BottomLeft => Some(ResizeDirection::SouthWest),
            HitTest::BottomRight => Some(ResizeDirection::SouthEast),
            HitTest::Client => None,
        }
    }

    fn cursor(&self) -> CursorIcon {
        match self {
            HitTest::Left => CursorIcon::WResize,
            HitTest::Right => CursorIcon::EResize,
            HitTest::Top => CursorIcon::NResize,
            HitTest::Bottom => CursorIcon::SResize,
            HitTest::TopLeft => CursorIcon::NwResize,
            HitTest::TopRight => CursorIcon::NeResize,
            HitTest::BottomLeft => CursorIcon::SwResize,
            HitTest::BottomRight => CursorIcon::SeResize,
            HitTest::Client => CursorIcon::Default,
        }
    }
}

/// 窓の中の座標（論理px）から、枠のどこに居るかを判定する。
///
/// 4辺の内外をビットで持ってから組み合わせる。角は2辺が同時に立つので、
/// 上下左右を個別に見るより分岐が素直になる。
fn hit_test(size: PhysicalSize<u32>, x: i32, y: i32, scale: f64) -> HitTest {
    const CLIENT: isize = 0b0000;
    const LEFT: isize = 0b0001;
    const RIGHT: isize = 0b0010;
    const TOP: isize = 0b0100;
    const BOTTOM: isize = 0b1000;
    const TOP_LEFT: isize = TOP | LEFT;
    const TOP_RIGHT: isize = TOP | RIGHT;
    const BOTTOM_LEFT: isize = BOTTOM | LEFT;
    const BOTTOM_RIGHT: isize = BOTTOM | RIGHT;

    // 画面側は論理px（CSSピクセル）で送ってくるので、窓の物理サイズを論理へ直して比べる
    let inset = RESIZE_INSET as i32;
    let width = (size.width as f64 / scale) as i32;
    let height = (size.height as f64 / scale) as i32;

    let result = (LEFT * isize::from(x < inset))
        | (RIGHT * isize::from(x >= width - inset))
        | (TOP * isize::from(y < inset))
        | (BOTTOM * isize::from(y >= height - inset));

    match result {
        LEFT => HitTest::Left,
        RIGHT => HitTest::Right,
        TOP => HitTest::Top,
        BOTTOM => HitTest::Bottom,
        TOP_LEFT => HitTest::TopLeft,
        TOP_RIGHT => HitTest::TopRight,
        BOTTOM_LEFT => HitTest::BottomLeft,
        BOTTOM_RIGHT => HitTest::BottomRight,
        CLIENT => HitTest::Client,
        // 幅・高さが inset の2倍未満だと左右（上下）が同時に立つ。掴ませない
        _ => HitTest::Client,
    }
}

/// ICO から一番大きな絵を取り出して窓のアイコンにする。
///
/// 縮小は Windows がやるので、大きい絵を渡しておけばタスクバーでも粗くならない。
/// 読めなくても起動は続ける（既定のアイコンになるだけで、動作には関係ない）。
fn load_window_icon() -> Option<Icon> {
    let dir = ico::IconDir::read(std::io::Cursor::new(ICON_BYTES)).ok()?;
    let entry = dir.entries().iter().max_by_key(|entry| entry.width())?;
    let image = entry.decode().ok()?;
    let (width, height) = (image.width(), image.height());
    Icon::from_rgba(image.rgba_data().to_vec(), width, height).ok()
}

/// IPCの本文を `UserEvent` へ直す。壊れた入力は None（画面側の実装ミスで落とさない）
fn parse_ipc(body: &str) -> Option<UserEvent> {
    let mut parts = body.split([':', ',']);
    let kind = parts.next()?;
    match kind {
        "minimize" => Some(UserEvent::Minimize),
        "maximize" => Some(UserEvent::ToggleMaximize),
        "drag_window" => Some(UserEvent::DragWindow),
        "close" => Some(UserEvent::Close),
        "mousedown" | "mousemove" => {
            let x = parts.next()?.parse().ok()?;
            let y = parts.next()?.parse().ok()?;
            if kind == "mousedown" {
                Some(UserEvent::MouseDown(x, y))
            } else {
                Some(UserEvent::MouseMove(x, y))
            }
        }
        _ => None,
    }
}

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

    let mut event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    #[allow(unused_mut)]
    let mut builder = WindowBuilder::new()
        .with_title("MultiTerm")
        // OSのタイトルバーは出さない。アプリのヘッダーがその役目を兼ねる（RDD 16.6）
        .with_decorations(false)
        // 窓の左上と Alt+Tab に出るアイコン（ICON_SMALL）
        .with_window_icon(load_window_icon())
        .with_inner_size(LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT));

    // **タスクバーのアイコンは別枠（ICON_BIG）。** tao の `with_window_icon` は
    // ICON_SMALL しか設定しないため、これが無いとタスクバーだけ既定のアイコンのままになる。
    #[cfg(target_os = "windows")]
    {
        builder = builder.with_taskbar_icon(load_window_icon());
    }

    let window = match builder.build(&event_loop) {
        Ok(window) => window,
        Err(error) => {
            eprintln!("[multiterm] ウィンドウを作成できません: {error}");
            let _ = shutdown_tx.send(());
            let _ = server.join();
            std::process::exit(1);
        }
    };

    let proxy = event_loop.create_proxy();
    let builder = WebViewBuilder::new()
        .with_url(&url)
        .with_ipc_handler(move |request: Request<String>| {
            if let Some(event) = parse_ipc(request.body()) {
                let _ = proxy.send_event(event);
            }
        })
        // 非アクティブな窓の1クリック目をボタン操作として扱う。無いと
        // 「窓を前に出すクリック」と「閉じるボタンのクリック」が二度手間になる
        .with_accept_first_mouse(true);

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
    let webview = match webview {
        Ok(webview) => webview,
        Err(error) => {
            eprintln!("[multiterm] WebViewを作成できません: {error}");
            let _ = shutdown_tx.send(());
            let _ = server.join();
            std::process::exit(1);
        }
    };

    // 窓を閉じたときにサーバへ終了を伝えるための置き場。イベントは複数回来るので Option で1度だけ送る
    let mut shutdown = Some(shutdown_tx);
    // WebView は窓より先に畳む。閉じるときに take して drop する
    let mut webview = Some(webview);
    // run ではなく run_return を使うのは、閉じたあとにサーバの後始末（PTYの終了）を
    // 待ってから抜けるため。run はそのままプロセスを終わらせてしまう。
    event_loop.run_return(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. }
            | Event::UserEvent(UserEvent::Close) => {
                let _ = webview.take();
                if let Some(sender) = shutdown.take() {
                    let _ = sender.send(());
                }
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                window.set_maximized(!window.is_maximized());
            }
            Event::UserEvent(UserEvent::DragWindow) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(UserEvent::MouseDown(x, y)) => {
                let hit = hit_test(window.inner_size(), x, y, window.scale_factor());
                if let Some(direction) = hit.resize_direction() {
                    let _ = window.drag_resize_window(direction);
                }
            }
            Event::UserEvent(UserEvent::MouseMove(x, y)) => {
                let hit = hit_test(window.inner_size(), x, y, window.scale_factor());
                window.set_cursor_icon(hit.cursor());
            }
            _ => {}
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
