//! macOS ImageIO: reuses every codec the system ships (HEIF/HEIC, camera
//! RAW and DNG, JPEG XL on macOS 14+, CMYK TIFF…), the counterpart of WIC.

use std::{ffi::c_void, path::Path};

use image::RgbaImage;
use objc2_core_foundation::{CFURL, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo};
use objc2_image_io::CGImageSource;

use crate::{Error, Result};

pub fn decode(path: &Path) -> Result<RgbaImage> {
    let url = CFURL::from_file_path(path).ok_or(Error::Corrupt("无效的文件路径"))?;
    // SAFETY: every CoreFoundation object is reference-counted by CFRetained;
    // the bitmap context writes only inside `pixels`, sized stride × height,
    // which outlives the context.
    unsafe {
        let source = CGImageSource::with_url(&url, None).ok_or(Error::Unsupported("系统无法识别此格式".into()))?;
        let image = source.image_at_index(0, None).ok_or(Error::Unsupported("系统无法解码此文件".into()))?;
        let (w, h) = (CGImage::width(Some(&image)), CGImage::height(Some(&image)));
        let stride = w.checked_mul(4).ok_or(Error::Corrupt("图像尺寸溢出"))?;
        let mut pixels = vec![0u8; stride.checked_mul(h).ok_or(Error::Corrupt("图像尺寸溢出"))?];
        let space = CGColorSpace::with_name(Some(kCGColorSpaceSRGB));
        // 8-bit RGBA bitmap contexts are always premultiplied; undone below.
        let context = CGBitmapContextCreate(
            pixels.as_mut_ptr().cast::<c_void>(),
            w,
            h,
            8,
            stride,
            space.as_deref(),
            CGImageAlphaInfo::PremultipliedLast.0,
        )
        .ok_or(Error::Corrupt("无法创建位图"))?;
        let rect = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64));
        CGContext::draw_image(Some(&context), rect, Some(&image));
        drop(context);
        unpremultiply(&mut pixels);
        RgbaImage::from_raw(w as u32, h as u32, pixels).ok_or(Error::Corrupt("ImageIO 返回的像素缓冲区异常"))
    }
}

fn unpremultiply(pixels: &mut [u8]) {
    for px in pixels.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a != 0 && a != 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
}
