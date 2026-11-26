//! Pinned previews: the open preview handed over to a window of its own, which
//! stays (no longer following Explorer) until closed, so the next Space opens a
//! fresh preview beside it. Several files can be compared this way.

use std::{
    path::Path,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};

use tauri::{AppHandle, Manager};
use windows::Win32::{
    Foundation::RECT,
    UI::WindowsAndMessaging::{GetWindowRect, SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW},
};

use super::{close, window, LABEL};
use crate::error::Result;

/// Pinned windows are labelled `quicklook-pin-<n>`; the page reads the prefix too.
const PREFIX: &str = "quicklook-pin-";
static COUNT: AtomicU32 = AtomicU32::new(0);
/// Where each new pinned window goes once its page has loaded: the preview's own place.
static PLACES: Mutex<Vec<(String, RECT)>> = Mutex::new(Vec::new());

/// Pins the file shown in the preview: a new window takes the preview's place, then the preview closes.
pub fn pin(app: &AppHandle, path: &Path) -> Result<()> {
    let Some(preview) = app.get_webview_window(LABEL) else { return Ok(()) };
    let mut place = RECT::default();
    // SAFETY: reads our own window's rectangle into a local.
    unsafe { GetWindowRect(preview.hwnd()?, &mut place) }.map_err(std::io::Error::other)?;
    let label = format!("{PREFIX}{}", COUNT.fetch_add(1, Ordering::Relaxed));
    let name = path.file_name().map_or_else(|| path.to_string_lossy(), |n| n.to_string_lossy());
    // The page has no event to wait for: it finds its file in a global set before it runs.
    let script = format!("window.__OCTLOOK_PIN__ = {};", serde_json::Value::from(path.to_string_lossy()));
    window(app, &label, &name).initialization_script(&script).build()?;
    PLACES.lock().unwrap_or_else(|e| e.into_inner()).push((label, place));
    close();
    Ok(())
}

/// Shows a pinned window once its page has loaded, where the preview was and
/// without taking focus from Explorer. False for every other window.
pub fn reveal_pinned(app: &AppHandle, label: &str) -> bool {
    if !label.starts_with(PREFIX) {
        return false;
    }
    let mut places = PLACES.lock().unwrap_or_else(|e| e.into_inner());
    let Some(i) = places.iter().position(|(l, _)| l == label) else { return true }; // a reload: already placed
    let (_, RECT { left, top, right, bottom }) = places.swap_remove(i);
    if let Some(Ok(hwnd)) = app.get_webview_window(label).map(|w| w.hwnd()) {
        // SAFETY: positions and shows our own window.
        let _ = unsafe { SetWindowPos(hwnd, Some(HWND_TOP), left, top, right - left, bottom - top, SWP_NOACTIVATE | SWP_SHOWWINDOW) };
    }
    true
}
