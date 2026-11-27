//! Blender files: the thumbnail Blender saves with them (a `TEST` block of
//! RGBA rows, bottom row first). Only the start of the file is read, through
//! the zstd (Blender 3+) or gzip (older) compression when there is one.

use std::io::{Cursor, Read};

use image::{imageops, RgbaImage};

/// The thumbnail comes right after the render settings; this is ample.
const MAX_HEAD: u64 = 4 << 20;
/// Blender writes 128 px thumbnails; anything far larger is not one.
const MAX_EDGE: u32 = 1024;

pub fn thumbnail(buf: &[u8]) -> Option<RgbaImage> {
    let mut head = Vec::new();
    let reader: Box<dyn Read + '_> = match buf {
        [0x28, 0xB5, 0x2F, 0xFD, ..] => Box::new(ruzstd::decoding::StreamingDecoder::new(Cursor::new(buf)).ok()?),
        [0x1F, 0x8B, ..] => Box::new(flate2::read::GzDecoder::new(buf)),
        _ => Box::new(buf),
    };
    // A truncated read is fine: everything needed sits at the start.
    let _ = reader.take(MAX_HEAD).read_to_end(&mut head);
    find_test_block(&head)
}

/// Walks the block headers. Two layouts exist: the 12-byte `BLENDER-v300`
/// header with 4/8-byte pointers, and Blender 5's `BLENDER17-01v0500` with
/// 64-bit lengths.
fn find_test_block(b: &[u8]) -> Option<RgbaImage> {
    let int = |at: usize| Some(i32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?) as i64);
    let long = |at: usize| Some(i64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?));
    if !b.starts_with(b"BLENDER") {
        return None;
    }
    // (header length, block header length, where the block length is, whether it is 64-bit)
    let (mut at, head, len_at, wide) = match b.get(7..13)? {
        [b'1', b'7', b'-', b'0', b'1', b'v'] => (17, 32, 16, true),
        [b'_', b'v', ..] => (12, 20, 4, false),
        [b'-', b'v', ..] => (12, 24, 4, false),
        _ => return None, // big-endian or an unknown future layout
    };
    loop {
        let code = b.get(at..at + 4)?;
        let len = usize::try_from(if wide { long(at + len_at)? } else { int(at + len_at)? }).ok()?;
        let data = at + head;
        match code {
            b"TEST" => {
                let (w, h) = (u32::try_from(int(data)?).ok()?, u32::try_from(int(data + 4)?).ok()?);
                if w == 0 || h == 0 || w > MAX_EDGE || h > MAX_EDGE || len < 8 + (w * h * 4) as usize {
                    return None;
                }
                let pixels = b.get(data + 8..data + 8 + (w * h * 4) as usize)?.to_vec();
                return Some(imageops::flip_vertical(&RgbaImage::from_raw(w, h, pixels)?));
            }
            b"ENDB" => return None,
            _ => at = data.checked_add(len)?,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(code: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut v = code.to_vec();
        v.extend(0i32.to_le_bytes()); // SDNA index
        v.extend(0u64.to_le_bytes()); // old pointer
        v.extend((data.len() as i64).to_le_bytes());
        v.extend(1i64.to_le_bytes()); // count
        v.extend(data);
        v
    }

    #[test]
    fn reads_the_thumbnail_of_a_blender_5_file_bottom_row_first() {
        let mut file = b"BLENDER17-01v0503".to_vec();
        file.extend(block(b"REND", &[0; 12]));
        let mut test = 1i32.to_le_bytes().to_vec();
        test.extend(2i32.to_le_bytes());
        test.extend([1, 1, 1, 255, 2, 2, 2, 255]); // bottom row, then top row
        file.extend(block(b"TEST", &test));
        file.extend(block(b"ENDB", &[]));
        let img = thumbnail(&file).unwrap();
        assert_eq!((img.width(), img.height()), (1, 2));
        assert_eq!(img.get_pixel(0, 0).0, [2, 2, 2, 255]);
    }

    #[test]
    fn a_file_saved_without_thumbnail_has_none() {
        let mut file = b"BLENDER17-01v0503".to_vec();
        file.extend(block(b"GLOB", &[0; 8]));
        file.extend(block(b"ENDB", &[]));
        assert!(thumbnail(&file).is_none());
    }
}
