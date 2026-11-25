//! Machine-wide COM + shell registration (HKLM, run elevated by the
//! installer). Per-user (HKCU) classes are invisible to Explorer's isolated
//! thumbnail host, which then fails with `REGDB_E_CLASSNOTREG`; running
//! in-process inside explorer.exe instead would let a decoder fault take
//! Explorer down, so HKLM it is.
//!
//! The handler is attached under `SystemFileAssociations\.<ext>`, which
//! leaves file associations (the `.ext` key and its ProgID) untouched.
//! Extensions already served by another thumbnail handler — Adobe's for
//! INDD, a third-party EPS handler, … — are skipped, never overridden.

use octlook_core::format;
use windows::{
    core::{Error, Result},
    Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, E_UNEXPECTED, HMODULE},
        System::LibraryLoader::GetModuleFileNameW,
        UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST},
    },
};
use windows_registry::{Key, CLASSES_ROOT, LOCAL_MACHINE};

use crate::CLSID;

/// Shell extension point for `IThumbnailProvider`.
const THUMBNAIL_HANDLER: &str = "{e357fccd-a995-4576-b01f-234630154e96}";
const ROOT: &Key = LOCAL_MACHINE;

pub fn register(module: usize) -> Result<()> {
    let clsid = clsid();
    let class = ROOT.create(class_key(&clsid))?;
    class.set_string("", "OctLook Thumbnail Provider")?;
    let server = class.create("InprocServer32")?;
    server.set_string("", module_path(module)?)?;
    server.set_string("ThreadingModel", "Apartment")?;

    for ext in format::stream_extensions().filter(|ext| !served_by_other_handler(ext, &clsid)) {
        ROOT.create(handler_key(ext))?.set_string("", &clsid)?;
    }
    notify_shell();
    Ok(())
}

pub fn unregister() -> Result<()> {
    let clsid = clsid();
    for ext in format::stream_extensions() {
        let key = handler_key(ext);
        if handler_at(ROOT, &key).is_some_and(|v| v.eq_ignore_ascii_case(&clsid)) {
            ROOT.remove_tree(&key)?;
        }
    }
    ignore_missing(ROOT.remove_tree(class_key(&clsid)))?;
    notify_shell();
    Ok(())
}

fn clsid() -> String {
    format!("{{{CLSID:?}}}")
}

fn class_key(clsid: &str) -> String {
    format!(r"Software\Classes\CLSID\{clsid}")
}

fn handler_key(ext: &str) -> String {
    format!(r"Software\Classes\SystemFileAssociations\.{ext}\ShellEx\{THUMBNAIL_HANDLER}")
}

/// Looks at every place Explorer resolves a thumbnail handler from: the
/// extension, its ProgID and `SystemFileAssociations` (merged HKCU + HKLM).
fn served_by_other_handler(ext: &str, clsid: &str) -> bool {
    let dotted = format!(".{ext}");
    let progid = CLASSES_ROOT.open(&dotted).and_then(|k| k.get_string("")).ok().filter(|p| !p.is_empty());
    [Some(dotted.clone()), progid, Some(format!(r"SystemFileAssociations\{dotted}"))]
        .into_iter()
        .flatten()
        .filter_map(|key| handler_at(CLASSES_ROOT, &format!(r"{key}\ShellEx\{THUMBNAIL_HANDLER}")))
        .any(|handler| !handler.is_empty() && !handler.eq_ignore_ascii_case(clsid))
}

fn handler_at(root: &Key, key: &str) -> Option<String> {
    root.open(key).and_then(|k| k.get_string("")).ok()
}

fn ignore_missing(result: Result<()>) -> Result<()> {
    match result {
        Err(e) if e.code() == ERROR_FILE_NOT_FOUND.to_hresult() => Ok(()),
        other => other,
    }
}

fn module_path(module: usize) -> Result<String> {
    let mut buf = vec![0u16; 512];
    loop {
        // SAFETY: `module` is this DLL's handle captured in `DllMain`.
        let len = unsafe { GetModuleFileNameW(Some(HMODULE(module as *mut _)), &mut buf) } as usize;
        match len {
            0 => return Err(Error::from_thread()),
            n if n < buf.len() => return String::from_utf16(&buf[..n]).map_err(|_| Error::from(E_UNEXPECTED)),
            _ => buf.resize(buf.len() * 2, 0),
        }
    }
}

/// Makes Explorer drop cached handler lookups.
fn notify_shell() {
    // SAFETY: SHCNE_ASSOCCHANGED takes no items.
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
}
