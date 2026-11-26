//! Space preview (Windows): Space in an Explorer file list, or on the desktop,
//! opens the selected file in a borderless window that never takes focus, so
//! the arrow keys keep moving through Explorer and the preview follows. Space
//! or Esc (or its close button) closes it again; switching apps leaves it open.
//! A pinned preview becomes a window of its own (see `pin`).

mod explorer;
mod hook;
mod pin;

pub use pin::{pin, reveal_pinned};

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicIsize, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        OnceLock,
    },
    thread,
    time::Duration,
};

use octlook_core::format;
use tauri::{window::Color, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::{
        HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
        WindowsAndMessaging::{
            GetClassNameW, GetForegroundWindow, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE,
            SWP_SHOWWINDOW, SW_HIDE,
        },
    },
};

use crate::{com::Com, error::Result};

pub const LABEL: &str = "quicklook";
/// How often the open preview checks Explorer's selection (arrow keys, clicks).
const FOLLOW: Duration = Duration::from_millis(150);
/// The preview never grows past this share of the monitor's work area.
const MAX_SHARE: f64 = 0.8;
/// Nor shrinks below this (logical px), so tiny icons still get usable chrome.
const MIN_SIZE: (f64, f64) = (360.0, 240.0);

static ENABLED: AtomicBool = AtomicBool::new(false);
static VISIBLE: AtomicBool = AtomicBool::new(false);
/// The Explorer (or desktop) window the preview belongs to.
static ANCHOR: AtomicIsize = AtomicIsize::new(0);
static WORKER: OnceLock<Sender<Msg>> = OnceLock::new();

enum Msg {
    /// Space in a file list: preview its selection, or close the open preview.
    Toggle(isize),
    Close,
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Turns the feature on or off; once started, the hook and worker threads just idle while off.
pub fn set_enabled(app: &AppHandle, on: bool) -> Result<()> {
    ENABLED.store(on, Ordering::Relaxed);
    if !on {
        close();
        // The hidden preview would otherwise keep the app alive after the main window closes.
        if let Some(window) = app.get_webview_window(LABEL) {
            window.destroy()?;
        }
        return Ok(());
    }
    if app.get_webview_window(LABEL).is_none() {
        // Created up front, hidden, so a preview opens without the webview's start-up delay.
        window(app, LABEL, "OctLook 空格预览").inner_size(960.0, 640.0).skip_taskbar(true).always_on_top(true).build()?;
    }
    WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        let app = app.clone();
        thread::spawn(move || worker(app, rx));
        hook::install();
        tx
    });
    Ok(())
}

/// A borderless preview window (the page draws its own title bar), created hidden.
fn window<'a>(app: &'a AppHandle, label: &str, title: &str) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(title)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .decorations(false)
        .visible(false)
        .focused(false)
        .background_color(Color(11, 11, 13, 255))
}

fn send(msg: Msg) {
    if let Some(tx) = WORKER.get() {
        let _ = tx.send(msg);
    }
}

pub fn close() {
    send(Msg::Close);
}

/// Sizes the preview to `width` × `height` logical px (the file's own size,
/// scaled down to fit the anchor's monitor) and shows it without activating it.
pub fn present(window: &WebviewWindow, width: f64, height: f64) -> Result<()> {
    if !VISIBLE.load(Ordering::Relaxed) {
        return Ok(()); // closed while the file was loading
    }
    let hwnd = window.hwnd()?;
    let anchor = HWND(ANCHOR.load(Ordering::Relaxed) as _);
    // SAFETY: plain Win32 queries and a reposition of our own window; out-params are sized locals.
    unsafe {
        let monitor = MonitorFromWindow(anchor, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetMonitorInfoW(monitor, &mut info);
        let (mut dpi, mut dpi_y) = (96, 96);
        let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi, &mut dpi_y);
        let RECT { left, top, right, bottom } = info.rcWork;
        let (w, h) = fit((width, height), f64::from(dpi) / 96.0, (right - left, bottom - top));
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            left + (right - left - w) / 2,
            top + (bottom - top - h) / 2,
            w,
            h,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .map_err(std::io::Error::other)?;
    }
    Ok(())
}

/// Window size in physical px for content of `size` logical px at `scale`:
/// within `MAX_SHARE` of the `work` area (aspect kept), never below `MIN_SIZE`.
fn fit(size: (f64, f64), scale: f64, work: (i32, i32)) -> (i32, i32) {
    let (w, h) = (size.0 * scale, size.1 * scale);
    let (max_w, max_h) = (f64::from(work.0) * MAX_SHARE, f64::from(work.1) * MAX_SHARE);
    let k = (max_w / w).min(max_h / h).min(1.0);
    let clamp = |v: f64, min: f64, max: f64| v.max(min * scale).min(max).round() as i32;
    (clamp(w * k, MIN_SIZE.0, max_w), clamp(h * k, MIN_SIZE.1, max_h))
}

fn class(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    // SAFETY: the buffer outlives the call; its length travels with the slice.
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

fn is_desktop(hwnd: HWND) -> bool {
    matches!(class(hwnd).as_str(), "Progman" | "WorkerW")
}

/// Owns the preview: resolves selections over COM (in an STA of its own) and
/// follows the selection while the preview is open.
fn worker(app: AppHandle, rx: Receiver<Msg>) {
    let _com = Com::init();
    let mut shown: Option<PathBuf> = None;
    loop {
        let msg = if shown.is_some() {
            match rx.recv_timeout(FOLLOW) {
                Ok(msg) => Some(msg),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        } else {
            match rx.recv() {
                Ok(msg) => Some(msg),
                Err(_) => return,
            }
        };
        let anchor = HWND(ANCHOR.load(Ordering::Relaxed) as _);
        match msg {
            Some(_) if shown.is_some() => hide(&app, &mut shown, anchor),
            Some(Msg::Toggle(hwnd)) => {
                if let Some(path) = previewable(explorer::selected(HWND(hwnd as _))) {
                    ANCHOR.store(hwnd, Ordering::Relaxed);
                    show(&app, &mut shown, path);
                }
            }
            Some(Msg::Close) => {}
            // Follows the selection while its Explorer window is in front; elsewhere the
            // preview just stays put until Space, Esc or its close button.
            // SAFETY: no arguments.
            None if unsafe { GetForegroundWindow() } == anchor => {
                if let Some(path) = previewable(explorer::selected(anchor)).filter(|p| Some(p) != shown.as_ref()) {
                    show(&app, &mut shown, path);
                }
            }
            None => {}
        }
    }
}

/// Files OctLook can show; folders and unknown types are left to Explorer.
fn previewable(path: Option<PathBuf>) -> Option<PathBuf> {
    path.filter(|p| p.is_file() && format::detect(p).is_some())
}

fn show(app: &AppHandle, shown: &mut Option<PathBuf>, path: PathBuf) {
    VISIBLE.store(true, Ordering::Relaxed);
    // The page loads the file, then calls `present` with its natural size.
    let _ = app.emit_to(LABEL, "quicklook:open", &path);
    *shown = Some(path);
}

fn hide(app: &AppHandle, shown: &mut Option<PathBuf>, anchor: HWND) {
    VISIBLE.store(false, Ordering::Relaxed);
    *shown = None;
    let Some(Ok(hwnd)) = app.get_webview_window(LABEL).map(|w| w.hwnd()) else { return };
    // SAFETY: plain window calls; a stale anchor handle just fails.
    unsafe {
        let focused = GetForegroundWindow() == hwnd;
        // Shown through Win32 (see `present`), so hidden the same way: Tauri's own
        // `hide` believes the window was never shown and does nothing.
        let _ = ShowWindow(hwnd, SW_HIDE);
        if focused {
            // Clicking into the preview took focus from Explorer; hand it back.
            let _ = SetForegroundWindow(anchor);
        }
    }
    let _ = app.emit_to(LABEL, "quicklook:close", ());
}

#[cfg(test)]
mod tests {
    use super::fit;

    #[test]
    fn small_files_keep_their_size() {
        assert_eq!(fit((800.0, 600.0), 1.0, (1920, 1040)), (800, 600));
        assert_eq!(fit((800.0, 600.0), 1.5, (2880, 1560)), (1200, 900));
    }

    #[test]
    fn large_files_shrink_to_the_work_area_keeping_aspect() {
        let (w, h) = fit((6000.0, 4000.0), 1.0, (1920, 1040));
        assert_eq!(h, 832);
        assert!((f64::from(w) / f64::from(h) - 1.5).abs() < 0.01);
    }

    #[test]
    fn tiny_files_get_a_usable_window() {
        assert_eq!(fit((16.0, 16.0), 2.0, (3840, 2080)), (720, 480));
    }
}
