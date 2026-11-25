//! Thumbnails from a byte stream. Explorer gives shell handlers an
//! `IStream`, never a path, and runs them in a shared surrogate process, so
//! memory use is bounded and PSDs are read only as far as needed.

use std::io::{Read, Seek, SeekFrom};

use image::RgbaImage;

use super::{decode_bytes, psd, Decoded, Purpose};
use crate::{
    format::{self, Format},
    thumbnail, Error, Result,
};

/// Never buffer more than this inside Explorer's surrogate.
const MAX_READ: u64 = 512 << 20;
/// Larger PSD composites cost too much memory for an icon.
const MAX_COMPOSITE_PIXELS: usize = 64_000_000;

/// `ext` (without dot) selects the format; the stream is read from its start.
pub fn thumbnail<R: Read + Seek>(r: &mut R, ext: &str, size: u32) -> Result<RgbaImage> {
    let len = r.seek(SeekFrom::End(0))?;
    r.rewind()?;
    let mut magic = Vec::with_capacity(8);
    r.by_ref().take(8).read_to_end(&mut magic)?;
    r.rewind()?;
    let format = format::from_extension(ext, &magic)
        .filter(|f| f.decodes_from_bytes())
        .ok_or_else(|| Error::Unsupported(ext.to_owned()))?;

    let mut purpose = Purpose::Thumbnail;
    if format == Format::Psd {
        // The embedded ~160 px JPEG precedes the layers: cheap and sharp
        // enough for small icons. Larger icons get the real composite.
        let head = psd::read_head(r)?;
        let (w, h) = psd::dimensions(&head)?;
        let too_big = w.saturating_mul(h) > MAX_COMPOSITE_PIXELS || len > MAX_READ;
        let wanted = (size as usize).min(w.max(h));
        match psd::decode(&head, Purpose::Thumbnail).and_then(|d| fit(d, size)) {
            Ok(img) if too_big || img.width().max(img.height()) as usize >= wanted => return Ok(img),
            Err(e) if too_big => return Err(e),
            _ => {}
        }
        r.rewind()?;
        purpose = Purpose::View;
    }
    if len > MAX_READ {
        return Err(Error::Unsupported("文件过大".into()));
    }
    let mut buf = Vec::with_capacity(len as usize);
    r.read_to_end(&mut buf)?;
    fit(decode_bytes(&buf, format, purpose)?, size)
}

fn fit(decoded: Decoded, size: u32) -> Result<RgbaImage> {
    thumbnail::fit(decoded.payload, decoded.meta.orientation, size)
}
