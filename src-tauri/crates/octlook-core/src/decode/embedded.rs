//! Extraction of previews that authoring apps embed in their files:
//! XMP thumbnails (AI, EPS, INDD), JPEG previews (camera RAW), PNG thumbnails
//! (Affinity) and the binary TIFF preview of DOS EPS files.

use base64::{engine::general_purpose::STANDARD, Engine};
use memchr::memmem;

use super::Extracted;

/// Base64 JPEG stored in `xmpGImg:image`, as an element or an attribute.
/// Illustrator stores several renditions; the largest one wins.
pub fn xmp_thumbnail(buf: &[u8]) -> Option<Extracted> {
    const TAG: &[u8] = b"xmpGImg:image";
    memmem::find_iter(buf, TAG)
        .filter_map(|at| {
            let rest = &buf[at + TAG.len()..];
            let (open, close) = match rest.first()? {
                b'>' => (1, memchr::memchr(b'<', rest)?),
                b'=' if rest.get(1) == Some(&b'"') => (2, 2 + memchr::memchr(b'"', &rest[2..])?),
                _ => return None,
            };
            decode_xmp_base64(&rest[open..close])
        })
        .filter(|jpeg| jpeg.starts_with(&[0xFF, 0xD8]))
        .max_by_key(Vec::len)
        .map(|bytes| Extracted { bytes, mime: "image/jpeg" })
}

fn decode_xmp_base64(raw: &[u8]) -> Option<Vec<u8>> {
    // XMP escapes line breaks inside the payload as `&#xA;`.
    let mut clean = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'&' {
            i += memchr::memchr(b';', &raw[i..])? + 1;
        } else {
            if !raw[i].is_ascii_whitespace() {
                clean.push(raw[i]);
            }
            i += 1;
        }
    }
    STANDARD.decode(clean).ok()
}

/// Picks the embedded JPEG whose longer edge is the smallest one still
/// `>= min_edge`, or the largest available. Returns the preview and its edge.
pub fn best_jpeg(buf: &[u8], min_edge: u32) -> Option<(Extracted, u32)> {
    let candidates: Vec<_> = memmem::find_iter(buf, &[0xFF, 0xD8, 0xFF]).filter_map(|s| parse_jpeg(buf, s)).collect();
    let pick = candidates
        .iter()
        .filter(|c| c.edge >= min_edge)
        .min_by_key(|c| c.edge)
        .or_else(|| candidates.iter().max_by_key(|c| c.edge))?;
    Some((Extracted { bytes: buf[pick.start..pick.end].to_vec(), mime: "image/jpeg" }, pick.edge))
}

struct JpegSpan {
    start: usize,
    end: usize,
    edge: u32,
}

/// Walks JPEG markers from SOI to EOI. Only baseline/extended/progressive
/// DCT streams are accepted; lossless (SOF3) is raw sensor data in CR2/DNG
/// and cannot be displayed by browsers.
fn parse_jpeg(buf: &[u8], start: usize) -> Option<JpegSpan> {
    let mut i = start + 2;
    let mut edge = 0u32;
    loop {
        while buf.get(i)? == &0xFF && buf.get(i + 1)? == &0xFF {
            i += 1; // fill bytes
        }
        if buf.get(i)? != &0xFF {
            return None;
        }
        let marker = *buf.get(i + 1)?;
        i += 2;
        match marker {
            0xD9 => return (edge > 0).then_some(JpegSpan { start, end: i, edge }),
            0xD0..=0xD7 | 0x01 => continue,
            _ => {}
        }
        let len = u16::from_be_bytes([*buf.get(i)?, *buf.get(i + 1)?]) as usize;
        if len < 2 {
            return None;
        }
        match marker {
            0xC0..=0xC2 => {
                let h = u16::from_be_bytes([*buf.get(i + 3)?, *buf.get(i + 4)?]) as u32;
                let w = u16::from_be_bytes([*buf.get(i + 5)?, *buf.get(i + 6)?]) as u32;
                edge = w.max(h);
            }
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF => return None,
            _ => {}
        }
        i += len;
        if marker == 0xDA {
            i = skip_entropy(buf, i)?;
        }
    }
}

/// Entropy-coded data ends at the first marker that is neither a stuffed
/// zero (`FF 00`) nor a restart marker.
fn skip_entropy(buf: &[u8], mut i: usize) -> Option<usize> {
    loop {
        i += memchr::memchr(0xFF, &buf[i..])?;
        match *buf.get(i + 1)? {
            0x00 | 0xD0..=0xD7 | 0xFF => i += 1,
            _ => return Some(i),
        }
    }
}

/// Largest complete PNG stream inside an opaque binary.
pub fn largest_png(buf: &[u8]) -> Option<Extracted> {
    const SIG: &[u8] = b"\x89PNG\r\n\x1a\n";
    memmem::find_iter(buf, SIG)
        .filter_map(|start| {
            let mut i = start + SIG.len();
            loop {
                let len = u32::from_be_bytes(buf.get(i..i + 4)?.try_into().ok()?) as usize;
                let kind = buf.get(i + 4..i + 8)?;
                i = i.checked_add(12 + len)?;
                if kind == b"IEND" {
                    return (i <= buf.len()).then_some(start..i);
                }
            }
        })
        .max_by_key(|r| r.len())
        .map(|r| Extracted { bytes: buf[r].to_vec(), mime: "image/png" })
}

/// DOS EPS binary header: `C5 D0 D3 C6`, then LE offsets; the TIFF preview
/// lives at bytes 20..28.
pub fn eps_tiff_preview(buf: &[u8]) -> Option<&[u8]> {
    if !buf.starts_with(&[0xC5, 0xD0, 0xD3, 0xC6]) {
        return None;
    }
    let off = u32::from_le_bytes(buf.get(20..24)?.try_into().ok()?) as usize;
    let len = u32::from_le_bytes(buf.get(24..28)?.try_into().ok()?) as usize;
    (off > 0 && len > 0).then(|| buf.get(off..off.checked_add(len)?)).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_jpeg(w: u16, h: u16) -> Vec<u8> {
        let mut v = vec![0xFF, 0xD8];
        v.extend([0xFF, 0xC0, 0x00, 0x0B, 0x08]);
        v.extend(h.to_be_bytes());
        v.extend(w.to_be_bytes());
        v.extend([0x01, 0x01, 0x11, 0x00]);
        v.extend([0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        v.extend([0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56]); // stuffed byte + RST
        v.extend([0xFF, 0xD9]);
        v
    }

    #[test]
    fn picks_smallest_jpeg_meeting_threshold() {
        let mut file = b"junk".to_vec();
        for (w, h) in [(160, 120), (1620, 1080), (6000, 4000)] {
            file.extend(tiny_jpeg(w, h));
            file.extend(b"pad");
        }
        assert_eq!(best_jpeg(&file, 1600).unwrap().1, 1620);
        assert_eq!(best_jpeg(&file, 9000).unwrap().1, 6000);
        let (x, _) = best_jpeg(&file, 0).unwrap();
        assert_eq!(x.bytes, tiny_jpeg(160, 120));
    }

    #[test]
    fn rejects_lossless_jpeg() {
        let mut j = tiny_jpeg(100, 100);
        j[3] = 0xC3;
        assert!(best_jpeg(&j, 0).is_none());
    }

    #[test]
    fn decodes_xmp_element_and_attribute() {
        let payload = STANDARD.encode([0xFF, 0xD8, 1, 2, 3]);
        let (a, b) = payload.split_at(3);
        let element = format!("<xmpGImg:image>{a}&#xA;{b}</xmpGImg:image>");
        assert_eq!(xmp_thumbnail(element.as_bytes()).unwrap().bytes, [0xFF, 0xD8, 1, 2, 3]);

        let larger = STANDARD.encode([0xFF, 0xD8, 9, 9, 9, 9]);
        let both = format!("{element} xmpGImg:image=\"{larger}\"");
        assert_eq!(xmp_thumbnail(both.as_bytes()).unwrap().bytes, [0xFF, 0xD8, 9, 9, 9, 9]);
    }

    #[test]
    fn finds_complete_png() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend([0, 0, 0, 0]);
        png.extend(b"IEND");
        png.extend([0xAE, 0x42, 0x60, 0x82]);
        let mut file = b"xx".to_vec();
        file.extend(&png);
        file.extend(b"\x89PNG\r\n\x1a\ntruncated");
        assert_eq!(largest_png(&file).unwrap().bytes, png);
    }
}
