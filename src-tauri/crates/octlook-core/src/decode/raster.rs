//! Raster decoding through the `image` crate plus SIMD resampling.

use std::{io::Cursor, path::Path};

use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions, Resizer};
use image::{DynamicImage, ImageReader, RgbaImage};

use crate::Result;

pub fn open(path: &Path) -> Result<RgbaImage> {
    let mut reader = ImageReader::open(path)?.with_guessed_format()?;
    reader.no_limits();
    Ok(to_display_rgba(reader.decode()?))
}

pub fn from_memory(bytes: &[u8]) -> Result<RgbaImage> {
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    reader.no_limits();
    Ok(to_display_rgba(reader.decode()?))
}

/// Float images (EXR/HDR) hold linear light: gamma-encode instead of a
/// plain clamp, which would render them far too dark.
fn to_display_rgba(img: DynamicImage) -> RgbaImage {
    match img {
        DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => {
            let f = img.into_rgba32f();
            let (w, h) = f.dimensions();
            let encode = |v: f32| (v.clamp(0.0, 1.0).powf(1.0 / 2.2) * 255.0 + 0.5) as u8;
            let raw = f.as_raw().chunks_exact(4).flat_map(|p| [encode(p[0]), encode(p[1]), encode(p[2]), (p[3].clamp(0.0, 1.0) * 255.0 + 0.5) as u8]).collect();
            RgbaImage::from_raw(w, h, raw).expect("buffer sized to image")
        }
        other => other.into_rgba8(),
    }
}

/// High-quality alpha-aware downscale (Lanczos3, SIMD).
pub fn resize(src: &RgbaImage, width: u32, height: u32) -> RgbaImage {
    let mut dst = RgbaImage::new(width, height);
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    Resizer::new().resize(src, &mut dst, &options).expect("RGBA8 → RGBA8 resize is always supported");
    dst
}
