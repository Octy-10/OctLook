//! The low-level keyboard hook. It only ever looks at Space and Esc, decides
//! with a few cheap window queries (no COM: the hook must answer fast), and
//! swallows the key only when it opens or closes the preview.

use std::{
    sync::atomic::{AtomicU32, Ordering},
    thread,
};

use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_SPACE},
        WindowsAndMessaging::{
            CallNextHookEx, GetForegroundWindow, GetGUIThreadInfo, GetMessageW, GetParent, GetWindowThreadProcessId, SetWindowsHookExW,
            GUITHREADINFO, HC_ACTION, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
        },
    },
};

use super::{class, is_desktop, send, Msg, VISIBLE};

/// The key whose press was swallowed: its auto-repeats and release go too.
static HELD: AtomicU32 = AtomicU32::new(0);

/// Installs the hook on a thread of its own; the hook lives as long as the app.
pub fn install() {
    thread::spawn(|| {
        // SAFETY: the hook procedure is a plain `extern "system"` fn; the message
        // loop below is what Windows calls it from.
        unsafe {
            let module = GetModuleHandleW(None).ok();
            if SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), module.map(Into::into), 0).is_err() {
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        }
    });
}

unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && super::enabled() {
        // SAFETY: for WH_KEYBOARD_LL, lparam points at a KBDLLHOOKSTRUCT.
        let vk = unsafe { (*(lparam.0 as *const KBDLLHOOKSTRUCT)).vkCode };
        if swallow(vk, wparam.0 as u32) {
            return LRESULT(1);
        }
    }
    // SAFETY: forwards the untouched event down the chain.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn swallow(vk: u32, message: u32) -> bool {
    let (space, esc) = (vk == u32::from(VK_SPACE.0), vk == u32::from(VK_ESCAPE.0));
    if !space && !esc {
        return false;
    }
    match message {
        WM_KEYUP => HELD.compare_exchange(vk, 0, Ordering::Relaxed, Ordering::Relaxed).is_ok(),
        WM_KEYDOWN if HELD.load(Ordering::Relaxed) == vk => true, // auto-repeat
        WM_KEYDOWN => {
            if (esc && !VISIBLE.load(Ordering::Relaxed)) || modifiers() {
                return false;
            }
            let Some(owner) = file_list_owner() else { return false };
            send(if space { Msg::Toggle(owner.0 as isize) } else { Msg::Close });
            HELD.store(vk, Ordering::Relaxed);
            true
        }
        _ => false,
    }
}

fn modifiers() -> bool {
    // SAFETY: plain key-state queries.
    [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN].iter().any(|&k| unsafe { GetAsyncKeyState(i32::from(k.0)) } < 0)
}

/// The foreground Explorer window (or the desktop) when its file list has the
/// keyboard focus — not the address bar, the search box or a rename field.
fn file_list_owner() -> Option<HWND> {
    // SAFETY: window queries with sized out-params.
    unsafe {
        let front = GetForegroundWindow();
        if !(is_desktop(front) || matches!(class(front).as_str(), "CabinetWClass" | "ExploreWClass")) {
            return None;
        }
        let mut info = GUITHREADINFO { cbSize: size_of::<GUITHREADINFO>() as u32, ..Default::default() };
        GetGUIThreadInfo(GetWindowThreadProcessId(front, None), &mut info).ok()?;
        (class(GetParent(info.hwndFocus).ok()?) == "SHELLDLL_DefView").then_some(front)
    }
}
