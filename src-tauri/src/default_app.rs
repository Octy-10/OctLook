//! The app the system would open a file with — Photoshop for a PSD — so the
//! viewer can offer it in one click. OctLook itself never counts: when it is
//! the default, the next recommended app stands in.

use std::path::Path;

use octlook_core::format::{self, Format};
use serde::Serialize;

#[derive(Serialize)]
pub struct DefaultApp {
    /// What the system knows the app by (its executable): picks it in [`open`].
    pub id: String,
    /// Display name, e.g. "Adobe Photoshop 2025".
    pub name: String,
    /// PNG of the app icon (48 px), empty when none could be read.
    pub icon: Vec<u8>,
}

pub use imp::open;
#[cfg(windows)]
pub use imp::{choices, choose};

/// Offered only where a more capable app exists (design files, PDF, text and
/// code); what OctLook fully replaces — photos, video, audio, fonts — gets none.
pub fn find(path: &Path) -> Option<DefaultApp> {
    format::detect(path).is_some_and(Format::edited_elsewhere).then(|| imp::find(path)).flatten()
}

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};

    use image::{imageops::FilterType, RgbaImage};
    use windows::{
        core::{HSTRING, PCWSTR, PWSTR},
        Win32::{
            Foundation::{ERROR_CANCELLED, HWND},
            Graphics::Gdi::{DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS},
            System::Com::IDataObject,
            UI::{
                Shell::{
                    AssocQueryStringW, BHID_DataObject, IAssocHandler, IShellItem, SHAssocEnumHandlers, SHCreateItemFromParsingName,
                    SHDefExtractIconW, SHLoadIndirectString, SHOpenWithDialog, ASSOCF_INIT_IGNOREUNKNOWN, ASSOCSTR_EXECUTABLE,
                    ASSOC_FILTER_RECOMMENDED, OAIF_ALLOW_REGISTRATION, OAIF_EXEC, OPENASINFO,
                },
                WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO},
            },
        },
    };

    use super::DefaultApp;
    use crate::{
        com::{take, Com},
        error::{AppError, Result},
    };

    const ICON_PX: u32 = 48;

    /// The apps recommended for `path`'s type, each with its executable: the
    /// user's default first, OctLook itself never.
    fn handlers(path: &Path) -> Vec<(String, IAssocHandler)> {
        let Some(ext) = path.extension().and_then(|e| e.to_str()).map(|e| HSTRING::from(format!(".{e}"))) else { return Vec::new() };
        let default = default_exe(&ext).filter(|exe| !is_octlook(exe));
        // SAFETY: plain COM enumeration; every returned interface is reference-counted.
        let Ok(handlers) = (unsafe { SHAssocEnumHandlers(&ext, ASSOC_FILTER_RECOMMENDED) }) else { return Vec::new() };
        let mut found: Vec<(String, IAssocHandler)> = Vec::new();
        loop {
            let mut slot = [None];
            // SAFETY: `slot` has room for the one handler requested.
            if unsafe { handlers.Next(&mut slot, None) }.is_err() {
                break;
            }
            let Some(handler) = slot[0].take() else { break };
            // SAFETY: GetName returns an owned string we free in `take`.
            let exe = unsafe { handler.GetName() }.map(take).unwrap_or_default();
            if is_octlook(Path::new(&exe)) || found.iter().any(|(seen, _)| seen.eq_ignore_ascii_case(&exe)) {
                continue;
            }
            if default.as_deref().is_some_and(|d| same_file(Path::new(&exe), d)) {
                found.insert(0, (exe, handler));
            } else {
                found.push((exe, handler));
            }
        }
        found
    }

    fn describe((exe, handler): (String, IAssocHandler)) -> Option<DefaultApp> {
        // SAFETY: GetUIName returns an owned string we free in `take`.
        let name = take(unsafe { handler.GetUIName() }.ok()?);
        let icon = icon(&handler).and_then(|img| png(&img)).unwrap_or_default();
        Some(DefaultApp { id: exe, name, icon })
    }

    /// The executable Explorer would launch, honouring the user's choice.
    fn default_exe(ext: &HSTRING) -> Option<PathBuf> {
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        // SAFETY: `buf` holds `len` UTF-16 units; the call writes at most that many.
        unsafe {
            AssocQueryStringW(ASSOCF_INIT_IGNOREUNKNOWN, ASSOCSTR_EXECUTABLE, ext, PCWSTR::null(), Some(PWSTR(buf.as_mut_ptr())), &mut len)
                .ok()
                .ok()?;
        }
        Some(PathBuf::from(String::from_utf16_lossy(&buf[..(len as usize).saturating_sub(1)])))
    }

    /// Any OctLook build (installed or dev) — the button must offer another app.
    fn is_octlook(exe: &Path) -> bool {
        exe.file_name().is_some_and(|name| name.eq_ignore_ascii_case("octlook.exe"))
    }

    fn same_file(a: &Path, b: &Path) -> bool {
        let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p));
        canon(a) == canon(b)
    }

    pub fn find(path: &Path) -> Option<DefaultApp> {
        let _com = Com::init();
        handlers(path).into_iter().next().and_then(describe)
    }

    /// Every app offered under "Open with" for `path`, the default first.
    pub fn choices(path: &Path) -> Vec<DefaultApp> {
        let _com = Com::init();
        handlers(path).into_iter().filter_map(describe).collect()
    }

    /// Opens `path` in the app `id` (from [`choices`]), or else in the default one.
    pub fn open(path: &Path, id: Option<&str>) -> Result<()> {
        let _com = Com::init();
        let (_, handler) = handlers(path)
            .into_iter()
            .find(|(exe, _)| id.is_none_or(|id| exe == id))
            .ok_or_else(|| AppError::Launch("没有可用的关联程序".into()))?;
        let launch = || -> windows::core::Result<()> {
            // SAFETY: the item and data object live until Invoke returns.
            unsafe {
                let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)?;
                let data: IDataObject = item.BindToHandler(None, &BHID_DataObject)?;
                handler.Invoke(&data)
            }
        };
        launch().map_err(|e| AppError::Launch(e.message()))
    }

    /// Windows' own "Open with" dialog for `path`, owned by the window `owner`
    /// and opening the file in the app picked. False when the user cancelled.
    pub fn choose(path: &Path, owner: isize) -> Result<bool> {
        let _com = Com::init();
        let file = HSTRING::from(path.as_os_str());
        let info = OPENASINFO { pcszFile: PCWSTR(file.as_ptr()), pcszClass: PCWSTR::null(), oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_EXEC };
        // SAFETY: `file` outlives the call; `owner` is one of our windows (a stale handle just leaves the dialog unowned).
        match unsafe { SHOpenWithDialog(Some(HWND(owner as _)), &info) } {
            Ok(()) => Ok(true),
            Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => Ok(false),
            Err(e) => Err(AppError::Launch(e.message())),
        }
    }

    fn icon(handler: &IAssocHandler) -> Option<RgbaImage> {
        let mut location = PWSTR::null();
        let mut index = 0;
        // SAFETY: both out-pointers are valid; the string is freed by `take`.
        unsafe { handler.GetIconLocation(&mut location, &mut index) }.ok()?;
        let location = take(location);
        // Store apps name an indirect resource that resolves to a logo PNG on disk.
        if location.starts_with('@') {
            let mut buf = [0u16; 1024];
            // SAFETY: `buf` is a valid output buffer of the given length.
            unsafe { SHLoadIndirectString(&HSTRING::from(location.as_str()), &mut buf, None) }.ok()?;
            let file = String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0)?]);
            let img = image::open(file).ok()?.into_rgba8();
            return Some(image::imageops::resize(&img, ICON_PX, ICON_PX, FilterType::Lanczos3));
        }
        let mut hicon = HICON::default();
        // SAFETY: extracts one icon into `hicon`, destroyed below.
        unsafe { SHDefExtractIconW(PCWSTR(HSTRING::from(location.as_str()).as_ptr()), index, 0, Some(&mut hicon), None, ICON_PX) }
            .ok()
            .ok()?;
        let pixels = icon_pixels(hicon);
        // SAFETY: `hicon` came from SHDefExtractIconW and is no longer used.
        unsafe {
            let _ = DestroyIcon(hicon);
        }
        pixels
    }

    /// The colour bitmap of an icon as straight RGBA.
    fn icon_pixels(hicon: HICON) -> Option<RgbaImage> {
        let mut info = ICONINFO::default();
        // SAFETY: GetIconInfo fills `info`; both bitmaps it creates are deleted below.
        unsafe { GetIconInfo(hicon, &mut info) }.ok()?;
        let read = || -> Option<RgbaImage> {
            let mut bitmap = BITMAP::default();
            // SAFETY: `bitmap` is large enough for a BITMAP description.
            if unsafe { GetObjectW(info.hbmColor.into(), size_of::<BITMAP>() as i32, Some(&mut bitmap as *mut _ as _)) } == 0 {
                return None;
            }
            let (w, h) = (bitmap.bmWidth as u32, bitmap.bmHeight as u32);
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w as i32,
                    biHeight: -(h as i32), // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bgra = vec![0u8; (w * h * 4) as usize];
            // SAFETY: `bgra` holds exactly w × h 32-bit pixels as described by `bmi`.
            let rows = unsafe {
                let dc = GetDC(None);
                let rows = GetDIBits(dc, info.hbmColor, 0, h, Some(bgra.as_mut_ptr() as _), &mut bmi, DIB_RGB_COLORS);
                ReleaseDC(None, dc);
                rows
            };
            if rows == 0 {
                return None;
            }
            // Legacy icons carry no alpha channel: treat them as opaque.
            let opaque = bgra.chunks_exact(4).all(|px| px[3] == 0);
            for px in bgra.chunks_exact_mut(4) {
                px.swap(0, 2);
                if opaque {
                    px[3] = 255;
                }
            }
            RgbaImage::from_raw(w, h, bgra)
        };
        let pixels = read();
        // SAFETY: both bitmaps were created by GetIconInfo for us to delete.
        unsafe {
            let _ = DeleteObject(info.hbmColor.into());
            let _ = DeleteObject(info.hbmMask.into());
        }
        pixels
    }

    fn png(img: &RgbaImage) -> Option<Vec<u8>> {
        let mut bytes = std::io::Cursor::new(Vec::new());
        img.write_to(&mut bytes, image::ImageFormat::Png).ok()?;
        Some(bytes.into_inner())
    }
}

/// Other platforms: not offered yet (the button stays hidden).
#[cfg(not(windows))]
mod imp {
    use std::path::Path;

    use super::DefaultApp;
    use crate::error::{AppError, Result};

    pub fn find(_path: &Path) -> Option<DefaultApp> {
        None
    }

    pub fn open(_path: &Path, _id: Option<&str>) -> Result<()> {
        Err(AppError::Launch("当前系统暂不支持".into()))
    }
}
