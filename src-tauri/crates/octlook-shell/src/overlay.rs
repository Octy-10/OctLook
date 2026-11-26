//! Whether Explorer will stamp the default app's icon (the "type overlay")
//! on a thumbnail. It sits in the same bottom-right corner as the format
//! badge, so the badge is drawn only where Explorer leaves the corner empty.

use windows::{
    core::{HSTRING, PCWSTR, PWSTR},
    Win32::UI::Shell::{AssocQueryStringW, ASSOCF_INIT_IGNOREUNKNOWN, ASSOCSTR, ASSOCSTR_EXECUTABLE, ASSOCSTR_PROGID},
};
use windows_registry::{CLASSES_ROOT, CURRENT_USER};

const ADVANCED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";

pub fn shown(ext: &str) -> bool {
    // Folder Options › "Display file icon on thumbnails" (on unless set to 0).
    if CURRENT_USER.open(ADVANCED).and_then(|k| k.get_u32("ShowTypeOverlay")).is_ok_and(|v| v == 0) {
        return false;
    }
    let dotted = format!(".{ext}");
    // No associated app: nothing to stamp.
    if assoc(ASSOCSTR_EXECUTABLE, &dotted).is_none() {
        return false;
    }
    // An app may opt out with an empty TypeOverlay under its ProgID.
    let opted_out = assoc(ASSOCSTR_PROGID, &dotted)
        .and_then(|progid| CLASSES_ROOT.open(progid).and_then(|k| k.get_string("TypeOverlay")).ok())
        .is_some_and(|overlay| overlay.is_empty());
    !opted_out
}

/// Resolves an association string the way Explorer does, honouring the
/// user's default-app choice.
fn assoc(what: ASSOCSTR, dotted: &str) -> Option<String> {
    let key = HSTRING::from(dotted);
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: `buf` holds `len` UTF-16 units; the call writes at most that many.
    unsafe {
        AssocQueryStringW(ASSOCF_INIT_IGNOREUNKNOWN, what, &key, PCWSTR::null(), Some(PWSTR(buf.as_mut_ptr())), &mut len)
            .ok()
            .ok()?;
    }
    let text = String::from_utf16_lossy(&buf[..(len as usize).saturating_sub(1)]);
    (!text.is_empty()).then_some(text)
}
