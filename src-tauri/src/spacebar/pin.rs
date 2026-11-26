//! Pinned previews: the open preview stays where it is, with its file, as a
//! window of its own (no longer topmost, no longer following Explorer) until
//! closed, and a fresh preview is made ready for the next Space. Several files
//! can be compared this way.

use std::{path::Path, sync::atomic::Ordering};

use tauri::{AppHandle, Emitter};
use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_NOTOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};

use super::{create, preview, CURRENT};
use crate::error::Result;

pub fn detach(app: &AppHandle, path: &Path) -> Result<()> {
    let Some(window) = preview(app) else { return Ok(()) };
    // From here on the worker talks to the next preview, never to this window.
    CURRENT.fetch_add(1, Ordering::Relaxed);
    // Made topmost through Win32 (see `present`), so released the same way.
    // SAFETY: changes only the z-order band of our own window.
    unsafe { SetWindowPos(window.hwnd()?, Some(HWND_NOTOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) }
        .map_err(std::io::Error::other)?;
    window.set_skip_taskbar(false)?;
    window.set_title(&path.file_name().map_or_else(|| path.to_string_lossy(), |n| n.to_string_lossy()))?;
    window.emit_to(window.label(), "quicklook:pinned", ())?;
    create(app)
}
