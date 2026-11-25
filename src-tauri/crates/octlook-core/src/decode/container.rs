//! Previews stored inside ZIP-based design documents and CorelDRAW files.

use std::io::{Cursor, Read, Seek};

use memchr::memmem;
use zip::ZipArchive;

use super::Extracted;
use crate::{Error, Result};

/// Known preview locations, best first: full-resolution composites (Krita,
/// OpenRaster) before screen-size previews (Sketch, XD) before thumbnails
/// (Figma, Procreate, CorelDRAW X4+).
const PREFERRED: &[&str] = &[
    "mergedimage.png",
    "previews/preview.png",
    "preview.png",
    "previews/thumbnail.png",
    "quicklook/thumbnail.png",
    "thumbnail.png",
    "metadata/thumbnails/thumbnail.bmp",
];
const HINTS: &[&str] = &["preview", "thumbnail", "merged", "rendition"];

pub fn zip_preview<R: Read + Seek>(reader: R) -> Result<Option<Extracted>> {
    Ok(best_zip_image(&mut ZipArchive::new(reader)?))
}

/// CorelDRAW X4+ is a ZIP (with an embedded RIFF document); 7–X3 is RIFF.
/// Both carry a `DISP` chunk holding a headerless BMP thumbnail.
pub fn cdr_preview(buf: &[u8]) -> Result<Option<Extracted>> {
    if buf.starts_with(b"PK") {
        let mut zip = ZipArchive::new(Cursor::new(buf))?;
        if let Some(found) = best_zip_image(&mut zip) {
            return Ok(Some(found));
        }
        let riff = find_entry(&mut zip, |n| n.ends_with("riffdata.cdr")).and_then(|i| read_entry(&mut zip, i));
        return Ok(riff.and_then(|r| riff_disp_bitmap(&r)));
    }
    if buf.starts_with(b"RIFF") {
        return Ok(riff_disp_bitmap(buf));
    }
    Err(Error::Corrupt("不是有效的 CorelDRAW 文件"))
}

fn best_zip_image<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Option<Extracted> {
    let index = PREFERRED
        .iter()
        .find_map(|want| find_entry(zip, |n| n == *want))
        .or_else(|| {
            (0..zip.len())
                .filter_map(|i| {
                    let f = zip.by_index_raw(i).ok()?;
                    let name = f.name().ok()?.to_ascii_lowercase();
                    let is_image = [".png", ".jpg", ".jpeg", ".bmp"].iter().any(|e| name.ends_with(e));
                    (is_image && HINTS.iter().any(|h| name.contains(h))).then_some((i, f.size()))
                })
                .max_by_key(|(_, size)| *size)
                .map(|(i, _)| i)
        })?;
    let bytes = read_entry(zip, index)?;
    let mime = sniff_mime(&bytes)?;
    Some(Extracted { bytes, mime })
}

fn find_entry<R: Read + Seek>(zip: &mut ZipArchive<R>, pred: impl Fn(&str) -> bool) -> Option<usize> {
    (0..zip.len()).find(|&i| zip.by_index_raw(i).ok().and_then(|f| f.name().ok().map(|n| pred(&n.to_ascii_lowercase()))).unwrap_or(false))
}

fn read_entry<R: Read + Seek>(zip: &mut ZipArchive<R>, index: usize) -> Option<Vec<u8>> {
    let mut file = zip.by_index(index).ok()?;
    let mut bytes = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, ..] => Some("image/jpeg"),
        [b'B', b'M', ..] => Some("image/bmp"),
        _ => None,
    }
}

/// Rebuilds a BMP file around the DIB stored in the first `DISP` chunk.
fn riff_disp_bitmap(riff: &[u8]) -> Option<Extracted> {
    let at = memmem::find(riff, b"DISP")?;
    let size = u32::from_le_bytes(riff.get(at + 4..at + 8)?.try_into().ok()?) as usize;
    let chunk = riff.get(at + 8..at + 8 + size).unwrap_or(&riff[at + 8..]);
    // The DIB starts with a 40-byte BITMAPINFOHEADER, after a small prefix.
    let dib = (0..=16).find_map(|off| {
        let d = chunk.get(off..)?;
        let header = u32::from_le_bytes(d.get(..4)?.try_into().ok()?);
        let bits = u16::from_le_bytes(d.get(14..16)?.try_into().ok()?);
        (header == 40 && matches!(bits, 1 | 4 | 8 | 16 | 24 | 32)).then_some(d)
    })?;
    let bits = u16::from_le_bytes(dib[14..16].try_into().ok()?);
    let compression = u32::from_le_bytes(dib[16..20].try_into().ok()?);
    let colors_used = u32::from_le_bytes(dib[32..36].try_into().ok()?) as usize;
    let palette = match (bits, colors_used) {
        (1..=8, 0) => (1usize << bits) * 4,
        (1..=8, n) => n * 4,
        (16 | 32, _) if compression == 3 => 12,
        _ => 0,
    };
    let mut bmp = Vec::with_capacity(14 + dib.len());
    bmp.extend(b"BM");
    bmp.extend(((14 + dib.len()) as u32).to_le_bytes());
    bmp.extend([0u8; 4]);
    bmp.extend(((14 + 40 + palette) as u32).to_le_bytes());
    bmp.extend(dib);
    Some(Extracted { bytes: bmp, mime: "image/bmp" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuilds_bmp_from_disp_chunk() {
        let mut dib = vec![0u8; 40];
        dib[..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&2i32.to_le_bytes());
        dib[8..12].copy_from_slice(&2i32.to_le_bytes());
        dib[14..16].copy_from_slice(&24u16.to_le_bytes());
        dib.extend([0u8; 16]); // 2 rows × 8 bytes (padded)
        let mut riff = b"RIFF\0\0\0\0CDR9vrsn".to_vec();
        riff.extend(b"DISP");
        riff.extend(((dib.len() + 4) as u32).to_le_bytes());
        riff.extend([0, 0, 0, 0]);
        riff.extend(&dib);

        let bmp = riff_disp_bitmap(&riff).unwrap();
        assert_eq!(&bmp.bytes[..2], b"BM");
        assert_eq!(u32::from_le_bytes(bmp.bytes[10..14].try_into().unwrap()), 54);
        assert_eq!(&bmp.bytes[14..], dib.as_slice());
    }
}
