//! The COM objects: a class factory and the thumbnail provider itself.

use std::{
    cell::RefCell,
    ffi::c_void,
    panic::{catch_unwind, AssertUnwindSafe},
    path::Path,
    sync::{atomic::Ordering, Once},
};

use octlook_core::decode::{postscript, stream};
use windows::{
    core::{Error, IUnknown, Interface, Ref, Result, BOOL, GUID},
    Win32::{
        Foundation::{CLASS_E_NOAGGREGATION, ERROR_ALREADY_INITIALIZED, E_POINTER, E_UNEXPECTED},
        Graphics::Gdi::HBITMAP,
        System::Com::{IClassFactory, IClassFactory_Impl, IStream},
        UI::Shell::{
            IThumbnailProvider, IThumbnailProvider_Impl,
            PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl},
            WTSAT_ARGB, WTS_ALPHATYPE, WTS_E_FAILEDEXTRACTION,
        },
    },
};
use windows_core::implement;

use crate::{badge, bitmap, overlay, registry, stream::StreamReader, MODULE};

#[implement(IClassFactory)]
pub struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<IUnknown>, iid: *const GUID, out: *mut *mut c_void) -> Result<()> {
        if out.is_null() {
            return Err(E_POINTER.into());
        }
        // SAFETY: `out` is non-null and owned by the COM caller.
        unsafe { *out = std::ptr::null_mut() };
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let provider: IUnknown = ThumbnailProvider { stream: RefCell::new(None) }.into();
        // SAFETY: `iid` and `out` come straight from the COM caller.
        unsafe { provider.query(iid, out).ok() }
    }

    fn LockServer(&self, _lock: BOOL) -> Result<()> {
        Ok(())
    }
}

/// Apartment-threaded: COM serialises calls, so a `RefCell` suffices.
#[implement(IInitializeWithStream, IThumbnailProvider)]
struct ThumbnailProvider {
    stream: RefCell<Option<IStream>>,
}

impl IInitializeWithStream_Impl for ThumbnailProvider_Impl {
    fn Initialize(&self, stream: Ref<IStream>, _mode: u32) -> Result<()> {
        let mut slot = self.stream.borrow_mut();
        if slot.is_some() {
            return Err(ERROR_ALREADY_INITIALIZED.to_hresult().into());
        }
        *slot = Some(stream.ok()?.clone());
        Ok(())
    }
}

impl IThumbnailProvider_Impl for ThumbnailProvider_Impl {
    fn GetThumbnail(&self, cx: u32, bitmap_out: *mut HBITMAP, alpha_out: *mut WTS_ALPHATYPE) -> Result<()> {
        if bitmap_out.is_null() || alpha_out.is_null() {
            return Err(E_POINTER.into());
        }
        let stream = self.stream.borrow().clone().ok_or_else(|| Error::from(E_UNEXPECTED))?;
        let ext = crate::stream::extension(&stream)?;
        ghostscript();
        // A panic must never unwind into Explorer's surrogate process.
        let render = || {
            let mut image = stream::thumbnail(&mut StreamReader(stream), &ext, cx)?;
            if !overlay::shown(&ext) {
                badge::apply(&mut image, &ext);
            }
            Ok::<_, octlook_core::Error>(image)
        };
        let image = catch_unwind(AssertUnwindSafe(render))
            .map_err(|_| Error::from(E_UNEXPECTED))?
            .map_err(|_| Error::from(WTS_E_FAILEDEXTRACTION))?;
        let hbitmap = bitmap::from_rgba(&image)?;
        // SAFETY: both out-pointers were checked for null above.
        unsafe {
            *bitmap_out = hbitmap;
            *alpha_out = WTSAT_ARGB;
        }
        Ok(())
    }
}

/// EPS files without an embedded preview are drawn by the Ghostscript the app
/// bundles beside this DLL (`gs\gswin64c.exe` in the install folder).
fn ghostscript() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        if let Ok(dll) = registry::module_path(MODULE.load(Ordering::Relaxed)) {
            if let Some(dir) = Path::new(&dll).parent() {
                postscript::init(&dir.join("gs").join("gswin64c.exe"));
            }
        }
    });
}
