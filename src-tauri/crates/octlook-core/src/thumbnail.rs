//! Thumbnail geometry shared by the viewer's filmstrip and the Explorer
//! handler: apply EXIF orientation, then Lanczos-downscale to fit a square.

use image::{metadata::Orientation, DynamicImage, RgbaImage};

use crate::{
    decode::{raster, Payload},
    Error, Result,
};

/// Fits raster payloads inside `size × size` (never upscales). Native and
/// PDF payloads have no pixels here: the caller must rasterise them.
pub fn fit(payload: Payload, orientation: u16, size: u32) -> Result<RgbaImage> {
    let rgba = match payload {
        Payload::Native | Payload::Pdf(_) => return Err(Error::NoPreview("需要矢量渲染")),
        Payload::Encoded { bytes, .. } => raster::from_memory(&bytes)?,
        Payload::Pixels(px) => px,
    };
    let mut img = DynamicImage::ImageRgba8(rgba);
    if let Some(o) = Orientation::from_exif(orientation as u8) {
        img.apply_orientation(o);
    }
    let rgba = img.into_rgba8();
    let (w, h) = rgba.dimensions();
    let scale = size as f64 / w.max(h) as f64;
    if scale >= 1.0 {
        return Ok(rgba);
    }
    let (tw, th) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
    Ok(raster::resize(&rgba, tw, th))
}
