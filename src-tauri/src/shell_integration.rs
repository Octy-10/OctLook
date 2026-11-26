//! Windows shell integration, run by the installer as
//! `octlook.exe --register-shell` / `--unregister-shell` (elevated, HKLM).
//!
//! * ProgIDs `OctLook.<ext>` + `Capabilities` + `RegisteredApplications`:
//!   OctLook is listed in Settings › Default apps and can be chosen there.
//!   The current default is never changed: Windows reserves that for the user.
//! * `OpenWithProgids`: listed under "Open with" in both context menus.
//! * A classic context-menu verb, "用 OctLook 打开", on every supported type.
//!
//! The extension list comes from `octlook_core::format`, the single source
//! of truth shared with the decoder and the thumbnail handler. Only images
//! and design files are registered: video, audio, text and fonts keep their
//! own apps and Explorer previews untouched (an "Open with" entry on `.ttf`
//! alone was enough to break Windows' font thumbnails).

use std::path::Path;

use octlook_core::format::{self, Category};
use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
use windows_registry::{Result, LOCAL_MACHINE};

const APP: &str = "OctLook";
const CAPABILITIES: &str = r"Software\OctLook\Capabilities";
const VERB_LABEL: &str = "用 OctLook 打开";

/// Handles the installer flags; `None` means a normal launch.
pub fn run_cli() -> Option<i32> {
    let action = match std::env::args().nth(1)?.as_str() {
        "--register-shell" => register,
        "--unregister-shell" => unregister,
        _ => return None,
    };
    let result = std::env::current_exe().map_err(Into::into).and_then(|exe| action(&exe));
    // SAFETY: SHCNE_ASSOCCHANGED takes no items.
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    Some(match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    })
}

fn register(exe: &Path) -> Result<()> {
    let app = classes_app(exe);
    let exe = exe.display();
    let icon = format!("\"{exe}\",0");
    let open = format!("\"{exe}\" \"%1\"");
    let classes = LOCAL_MACHINE.create(r"Software\Classes")?;

    let app = classes.create(app)?;
    app.set_string("FriendlyAppName", APP)?;
    app.create(r"shell\open\command")?.set_string("", &open)?;
    let supported = app.create("SupportedTypes")?;

    let capabilities = LOCAL_MACHINE.create(CAPABILITIES)?;
    capabilities.set_string("ApplicationName", APP)?;
    capabilities.set_string("ApplicationDescription", "为设计师打造的极简看图工具，支持 PSD、AI、CDR 等设计文件")?;
    capabilities.set_string("ApplicationIcon", &icon)?;
    let associations = capabilities.create("FileAssociations")?;

    // Earlier versions registered every viewable type: withdraw the others.
    for (ext, _) in format::entries().filter(|(_, family)| family.category() != Category::Image) {
        remove_type(&classes, ext);
        let _ = associations.remove_value(format!(".{ext}"));
        let _ = supported.remove_value(format!(".{ext}"));
    }

    for (ext, family) in format::entries().filter(|(_, family)| family.category() == Category::Image) {
        let progid = progid(ext);
        let class = classes.create(&progid)?;
        class.set_string("", format!("{} 文件（.{ext}）", family.label()))?;
        class.create("DefaultIcon")?.set_string("", &icon)?;
        // No app-icon stamp on thumbnails of files OctLook opens: they carry
        // the format badge instead (see octlook-shell's `overlay`).
        class.set_string("TypeOverlay", "")?;
        class.create(r"shell\open\command")?.set_string("", &open)?;

        classes.create(format!(r".{ext}\OpenWithProgids"))?.set_string(&progid, "")?;
        associations.set_string(format!(".{ext}"), &progid)?;
        supported.set_string(format!(".{ext}"), "")?;

        let verb = classes.create(verb_key(ext))?;
        verb.set_string("MUIVerb", VERB_LABEL)?;
        verb.set_string("Icon", &icon)?;
        verb.create("command")?.set_string("", &open)?;
    }
    LOCAL_MACHINE.create(r"Software\RegisteredApplications")?.set_string(APP, CAPABILITIES)
}

/// Removes exactly what `register` wrote; missing entries are fine.
fn unregister(exe: &Path) -> Result<()> {
    let classes = LOCAL_MACHINE.create(r"Software\Classes")?;
    let _ = classes.remove_tree(classes_app(exe));
    for (ext, _) in format::entries() {
        remove_type(&classes, ext);
    }
    let _ = LOCAL_MACHINE.remove_tree(r"Software\OctLook");
    if let Ok(apps) = LOCAL_MACHINE.create(r"Software\RegisteredApplications") {
        let _ = apps.remove_value(APP);
    }
    Ok(())
}

/// Drops OctLook's ProgID, context verb and "Open with" entry for `ext`.
fn remove_type(classes: &windows_registry::Key, ext: &str) {
    let _ = classes.remove_tree(progid(ext));
    let _ = classes.remove_tree(verb_key(ext));
    if let Ok(open_with) = classes.open(format!(r".{ext}\OpenWithProgids")) {
        let _ = open_with.remove_value(progid(ext));
    }
}

fn progid(ext: &str) -> String {
    format!("{APP}.{ext}")
}

fn verb_key(ext: &str) -> String {
    format!(r"SystemFileAssociations\.{ext}\shell\{APP}")
}

/// `Applications\<exe file name>`: what "Open with › Choose another app" uses.
fn classes_app(exe: &Path) -> String {
    let name = exe.file_name().map_or("octlook.exe".into(), |n| n.to_string_lossy());
    format!(r"Applications\{name}")
}
