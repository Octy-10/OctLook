//! COM plumbing shared by the Windows shell features.

use windows::{
    core::PWSTR,
    Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
};

/// A single-threaded apartment for the current thread, left on drop.
pub struct Com(bool);

impl Com {
    pub fn init() -> Self {
        // SAFETY: balanced by CoUninitialize in Drop, on this same thread, only when it succeeded.
        Com(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok())
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: pairs with the successful CoInitializeEx above.
            unsafe { CoUninitialize() };
        }
    }
}

/// Takes ownership of a shell-allocated string.
pub fn take(text: PWSTR) -> String {
    // SAFETY: the shell returned a valid, NUL-terminated, CoTaskMem-allocated string.
    unsafe {
        let owned = text.to_string().unwrap_or_default();
        CoTaskMemFree(Some(text.0 as _));
        owned
    }
}
