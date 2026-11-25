//! 32-bit top-down DIB sections: the bitmap Explorer receives, and the
//! scratch surface GDI renders badge text into.

use image::RgbaImage;
use windows::{
    core::{Error, Result},
    Win32::{
        Foundation::E_OUTOFMEMORY,
        Graphics::Gdi::{CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP},
    },
};

/// Creates a zero-filled `w × h` BGRA DIB and returns it with its pixel
/// memory (`w * h * 4` bytes, valid until the bitmap is deleted).
pub fn dib(w: u32, h: u32) -> Result<(HBITMAP, *mut u8)> {
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w as i32,
            biHeight: -(h as i32), // negative ⇒ top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    // SAFETY: `info` fully describes the requested 32bpp DIB.
    let hbitmap = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)? };
    if bits.is_null() {
        return Err(Error::from(E_OUTOFMEMORY));
    }
    Ok((hbitmap, bits.cast()))
}

/// RGBA pixels → the straight-alpha BGRA bitmap Explorer expects.
pub fn from_rgba(image: &RgbaImage) -> Result<HBITMAP> {
    let (hbitmap, bits) = dib(image.width(), image.height())?;
    // SAFETY: `dib` allocated exactly width * height * 4 bytes (32bpp rows
    // need no padding), the same length as the RGBA buffer.
    let dst = unsafe { std::slice::from_raw_parts_mut(bits, image.as_raw().len()) };
    for (d, s) in dst.chunks_exact_mut(4).zip(image.as_raw().chunks_exact(4)) {
        d.copy_from_slice(&[s[2], s[1], s[0], s[3]]);
    }
    Ok(hbitmap)
}
