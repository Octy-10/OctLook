//! Windows Imaging Component: reuses every codec installed on the system
//! (HEIF/HEVC, JPEG XL, JPEG XR, camera RAW, DNG, CMYK TIFF…).

use std::{os::windows::ffi::OsStrExt, path::Path};

use image::RgbaImage;
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::GENERIC_READ,
        Graphics::Imaging::{
            CLSID_WICImagingFactory, GUID_WICPixelFormat32bppRGBA, IWICImagingFactory, WICConvertBitmapSource,
            WICDecodeMetadataCacheOnDemand,
        },
        System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED},
    },
};

use crate::{Error, Result};

pub fn decode(path: &Path) -> Result<RgbaImage> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    // SAFETY: COM is initialised for this worker thread before any WIC call;
    // `wide` outlives the call that borrows it and `pixels` is sized to
    // stride × height as CopyPixels requires.
    unsafe {
        // S_FALSE / RPC_E_CHANGED_MODE just mean COM is already initialised.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
        let decoder =
            factory.CreateDecoderFromFilename(PCWSTR(wide.as_ptr()), None, GENERIC_READ, WICDecodeMetadataCacheOnDemand)?;
        let frame = decoder.GetFrame(0)?;
        let rgba = WICConvertBitmapSource(&GUID_WICPixelFormat32bppRGBA, &frame)?;
        let (mut w, mut h) = (0u32, 0u32);
        rgba.GetSize(&mut w, &mut h)?;
        let stride = w.checked_mul(4).ok_or(Error::Corrupt("图像尺寸溢出"))?;
        let mut pixels = vec![0u8; stride as usize * h as usize];
        rgba.CopyPixels(std::ptr::null(), stride, &mut pixels)?;
        RgbaImage::from_raw(w, h, pixels).ok_or(Error::Corrupt("WIC 返回的像素缓冲区异常"))
    }
}
