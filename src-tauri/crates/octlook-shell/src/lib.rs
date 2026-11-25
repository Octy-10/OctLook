//! Explorer thumbnail handler for the design formats Windows cannot preview
//! (PSD/PSB, AI, CDR, Sketch, XD, Figma, Affinity…). A thin COM shell around
//! `octlook_core::decode::stream`, registered machine-wide by the installer
//! through `regsvr32` (see `registry.rs` for why not per user).
#![cfg(windows)]

mod badge;
mod bitmap;
mod provider;
mod registry;
mod stream;

use std::{
    ffi::c_void,
    sync::atomic::{AtomicUsize, Ordering},
};

use windows::{
    core::{Interface, BOOL, GUID, HRESULT},
    Win32::{
        Foundation::{CLASS_E_CLASSNOTAVAILABLE, E_POINTER, HINSTANCE, S_FALSE, S_OK},
        System::{Com::IClassFactory, SystemServices::DLL_PROCESS_ATTACH},
    },
};

pub const CLSID: GUID = GUID::from_u128(0xe845b91e_c70e_4418_ad17_93771d8a282f);

/// This DLL's module handle, needed to register its own path.
static MODULE: AtomicUsize = AtomicUsize::new(0);

#[no_mangle]
pub extern "system" fn DllMain(module: HINSTANCE, reason: u32, _reserved: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        MODULE.store(module.0 as usize, Ordering::Relaxed);
    }
    true.into()
}

/// # Safety
/// Called by COM with pointers that follow the `DllGetClassObject` contract.
#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(clsid: *const GUID, iid: *const GUID, out: *mut *mut c_void) -> HRESULT {
    if clsid.is_null() || iid.is_null() || out.is_null() {
        return E_POINTER;
    }
    *out = std::ptr::null_mut();
    if *clsid != CLSID {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IClassFactory = provider::Factory.into();
    factory.query(iid, out)
}

/// Never unload: decoding uses rayon's global pool, whose worker threads
/// would otherwise outlive the code they execute.
#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}

#[no_mangle]
pub extern "system" fn DllRegisterServer() -> HRESULT {
    to_hresult(registry::register(MODULE.load(Ordering::Relaxed)))
}

#[no_mangle]
pub extern "system" fn DllUnregisterServer() -> HRESULT {
    to_hresult(registry::unregister())
}

fn to_hresult(result: windows::core::Result<()>) -> HRESULT {
    result.map_or_else(|e| e.code(), |()| S_OK)
}
