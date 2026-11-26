//! Reads the selected file of an Explorer window (or the desktop) through the
//! shell's automation objects.

use std::path::PathBuf;

use windows::{
    core::{w, Interface, Result},
    Win32::{
        Foundation::{E_FAIL, HWND},
        System::{
            Com::{CoCreateInstance, IServiceProvider, CLSCTX_LOCAL_SERVER},
            Variant::VARIANT,
        },
        UI::{
            Shell::{
                IFolderView2, IShellBrowser, IShellItem, IShellWindows, IWebBrowserApp, ShellWindows, SID_STopLevelBrowser, SIGDN_FILESYSPATH,
                SWC_DESKTOP, SWFO_NEEDDISPATCH,
            },
            WindowsAndMessaging::FindWindowExW,
        },
    },
};

use super::is_desktop;
use crate::com::take;

/// The focused item of `window`'s selection, when it is a file-system item.
pub fn selected(window: HWND) -> Option<PathBuf> {
    // SAFETY: COM calls on interfaces this thread obtained; the caller's thread is in an STA.
    unsafe { browser(window).and_then(|b| focused(&b)) }.ok()
}

unsafe fn browser(window: HWND) -> Result<IShellBrowser> {
    let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_LOCAL_SERVER)?;
    let top = |item: windows::Win32::System::Com::IDispatch| item.cast::<IServiceProvider>()?.QueryService::<IShellBrowser>(&SID_STopLevelBrowser);
    if is_desktop(window) {
        let mut hwnd = 0;
        // CSIDL_DESKTOP (0) names the desktop's own view.
        return top(windows.FindWindowSW(&VARIANT::from(0), &VARIANT::default(), SWC_DESKTOP, &mut hwnd, SWFO_NEEDDISPATCH)?);
    }
    // Windows 11 tabs share one frame; the active tab is its first tab window.
    let tab = FindWindowExW(Some(window), None, w!("ShellTabWindowClass"), None).ok();
    for i in 0..windows.Count()? {
        let Ok(item) = windows.Item(&VARIANT::from(i)) else { continue };
        if item.cast::<IWebBrowserApp>().and_then(|app| app.HWND()).map(|h| h.0) != Ok(window.0 as isize) {
            continue;
        }
        let browser = top(item)?;
        if tab.is_none_or(|tab| browser.GetWindow() == Ok(tab)) {
            return Ok(browser);
        }
    }
    Err(E_FAIL.into())
}

unsafe fn focused(browser: &IShellBrowser) -> Result<PathBuf> {
    let view: IFolderView2 = browser.QueryActiveShellView()?.cast()?;
    if view.GetSelection(false)?.GetCount()? == 0 {
        return Err(E_FAIL.into());
    }
    let item: IShellItem = view.GetItem(view.GetFocusedItem()?)?;
    Ok(take(item.GetDisplayName(SIGDN_FILESYSPATH)?).into())
}
