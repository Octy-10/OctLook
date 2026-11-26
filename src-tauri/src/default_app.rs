//! The app the system would open a file with — Photoshop for a PSD — so the
//! viewer can offer it in one click. OctLook itself never counts: when it is
//! the default, the next recommended app stands in.

use std::path::Path;

use octlook_core::format::{self, Format};
use serde::Serialize;

#[derive(Serialize)]
pub struct DefaultApp {
    /// Display name, e.g. "Adobe Photoshop 2025".
    pub name: String,
    /// PNG of the app icon (48 px), empty when none could be read.
    pub icon: Vec<u8>,
}

pub use imp::open;

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
            Graphics::Gdi::{DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS},
            System::Com::IDataObject,
            UI::{
                Shell::{
                    AssocQueryStringW, BHID_DataObject, IAssocHandler, IShellItem, SHAssocEnumHandlers, SHCreateItemFromParsingName,
                    SHDefExtractIconW, SHLoadIndirectString, ASSOCF_INIT_IGNOREUNKNOWN, ASSOCSTR_EXECUTABLE, ASSOC_FILTER_RECOMMENDED,
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

    /// The user's default app for `path`'s type, else the first recommended
    /// one; OctLook itself is skipped either way.
    fn handler(path: &Path) -> Option<IAssocHandler> {
        let ext = HSTRING::from(format!(".{}", path.extension()?.to_str()?));
        let default = default_exe(&ext).filter(|exe| !is_octlook(exe));
        // SAFETY: plain COM enumeration; every returned interface is reference-counted.
        let handlers = unsafe { SHAssocEnumHandlers(&ext, ASSOC_FILTER_RECOMMENDED) }.ok()?;
        let mut candidates = Vec::new();
        loop {
            let mut slot = [None];
            // SAFETY: `slot` has room for the one handler requested.
            if unsafe { handlers.Next(&mut slot, None) }.is_err() {
                break;
            }
            let Some(handler) = slot[0].take() else { break };
            // SAFETY: GetName returns an owned string we free in `take`.
            let exe = PathBuf::from(unsafe { handler.GetName() }.map(take).unwrap_or_default());
            if is_octlook(&exe) {
                continue;
            }
            if default.as_deref().is_some_and(|d| same_file(&exe, d)) {
                return Some(handler);
            }
            candidates.push(handler);
        }
        candidates.into_iter().next()
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
        let handler = handler(path)?;
        // SAFETY: as in `handler`.
        let name = take(unsafe { handler.GetUIName() }.ok()?);
        let icon = icon(&handler).and_then(|img| png(&img)).unwrap_or_default();
        Some(DefaultApp { name, icon })
    }

    pub fn open(path: &Path) -> Result<()> {
        let _com = Com::init();
        let handler = handler(path).ok_or_else(|| AppError::Launch("没有可用的关联程序".into()))?;
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

    pub fn open(_path: &Path) -> Result<()> {
        Err(AppError::Launch("当前系统暂不支持".into()))
    }
}
