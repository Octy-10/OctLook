//! Photoshop PSD/PSB reader for the flattened composite ("Image Data"
//! section) that Photoshop writes when *Maximize Compatibility* is on.
//!
//! Covers PSD + PSB, 1/8/16/32-bit, Bitmap/Gray/Indexed/RGB/CMYK/Lab/
//! Duotone/Multichannel, raw/RLE/ZIP(+prediction) compression. When the
//! composite is missing or too large, the embedded JPEG thumbnail is used.
//! Existing crates (`psd`, `rawpsd`) lack PSB or 16/32-bit support.

use std::io::Read;

use image::RgbaImage;
use memchr::memmem;
use rayon::prelude::*;

use super::{Decoded, Payload, Purpose, Source};
use crate::{
    Error, Result,
    format::Format,
};

/// Above this the composite is not worth decoding for an on-screen viewer.
const MAX_COMPOSITE_PIXELS: usize = 400_000_000;

pub fn decode(buf: &[u8], purpose: Purpose) -> Result<Decoded> {
    let doc = Document::parse(buf)?;
    let thumbnail = || {
        doc.thumbnail
            .map(|jpeg| Decoded::new(Format::Psd, Payload::Encoded { bytes: jpeg.to_vec(), mime: "image/jpeg" }, Source::Preview))
            .ok_or(Error::NoPreview("PSD 缩略图"))
    };
    if purpose == Purpose::Thumbnail {
        if let Ok(t) = thumbnail() {
            return Ok(t);
        }
    }
    match doc.composite() {
        Ok(px) => Ok(Decoded::new(Format::Psd, Payload::Pixels(px), Source::Full).detail(Some(doc.describe()))),
        Err(e) => thumbnail().map_err(|_| e),
    }
}

/// Reads only what precedes the layer section — header, colour-mode data and
/// image resources (where the embedded thumbnail lives) — and appends an
/// empty layer section, so the result parses as a composite-less document.
pub fn read_head(r: &mut impl Read) -> Result<Vec<u8>> {
    const MAX_SECTION: usize = 256 << 20;
    let mut head = vec![0u8; 26];
    r.read_exact(&mut head)?;
    // Colour-mode data, then image resources: both u32-length-prefixed.
    for _ in 0..2 {
        let at = head.len();
        head.resize(at + 4, 0);
        r.read_exact(&mut head[at..])?;
        let len = u32::from_be_bytes(head[at..].try_into().unwrap()) as usize;
        if len > MAX_SECTION {
            return Err(Error::Corrupt("PSD 资源段长度异常"));
        }
        head.resize(at + 4 + len, 0);
        r.read_exact(&mut head[at + 4..])?;
    }
    head.extend([0u8; 8]); // zero-length layer section (8 bytes covers PSB)
    Ok(head)
}

/// Document width and height in pixels.
pub fn dimensions(buf: &[u8]) -> Result<(usize, usize)> {
    Document::parse(buf).map(|d| (d.width, d.height))
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.pos.checked_add(n).filter(|&e| e <= self.buf.len()).ok_or(Error::Corrupt("PSD 数据被截断"))?;
        let s = &self.buf[self.pos..end];
        self.pos = end;
        Ok(s)
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }
    /// Length-prefixed block; PSB widens some lengths to 64 bits.
    fn section(&mut self, wide: bool) -> Result<&'a [u8]> {
        let len = if wide { self.u64()? as usize } else { self.u32()? as usize };
        self.take(len)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Bitmap,
    Gray,
    Indexed,
    Rgb,
    Cmyk,
    Lab,
}

struct Document<'a> {
    psb: bool,
    width: usize,
    height: usize,
    depth: u16,
    channels: usize,
    mode: Mode,
    mode_name: &'static str,
    palette: &'a [u8],
    thumbnail: Option<&'a [u8]>,
    merged_alpha: bool,
    image_data: &'a [u8],
}

impl<'a> Document<'a> {
    fn parse(buf: &'a [u8]) -> Result<Self> {
        let mut r = Reader { buf, pos: 0 };
        if r.take(4)? != b"8BPS" {
            return Err(Error::Corrupt("缺少 8BPS 文件头"));
        }
        let psb = match r.u16()? {
            1 => false,
            2 => true,
            _ => return Err(Error::Corrupt("未知的 PSD 版本")),
        };
        r.take(6)?;
        let channels = r.u16()? as usize;
        let height = r.u32()? as usize;
        let width = r.u32()? as usize;
        let depth = r.u16()?;
        let (mode, mode_name) = match r.u16()? {
            0 => (Mode::Bitmap, "位图"),
            1 => (Mode::Gray, "灰度"),
            2 => (Mode::Indexed, "索引色"),
            3 => (Mode::Rgb, "RGB"),
            4 => (Mode::Cmyk, "CMYK"),
            7 => (Mode::Gray, "多通道"),
            8 => (Mode::Gray, "双色调"),
            9 => (Mode::Lab, "Lab"),
            _ => return Err(Error::Corrupt("未知的颜色模式")),
        };
        if !matches!(depth, 1 | 8 | 16 | 32) || channels == 0 || width == 0 || height == 0 {
            return Err(Error::Corrupt("PSD 头部参数非法"));
        }
        let palette = r.section(false)?;
        let thumbnail = parse_thumbnail(r.section(false)?);
        let merged_alpha = has_merged_alpha(r.section(psb)?, psb);
        Ok(Self {
            psb, width, height, depth, channels, mode, mode_name, palette, thumbnail, merged_alpha,
            image_data: &buf[r.pos..],
        })
    }

    fn describe(&self) -> String {
        let mut s = format!("{} · {} bit", self.mode_name, self.depth);
        if self.merged_alpha && self.channels > self.base_channels() {
            s.push_str(" · 透明");
        }
        if self.psb {
            s.push_str(" · PSB");
        }
        s
    }

    fn base_channels(&self) -> usize {
        match self.mode {
            Mode::Rgb | Mode::Lab => 3,
            Mode::Cmyk => 4,
            Mode::Bitmap | Mode::Gray | Mode::Indexed => 1,
        }
    }

    fn composite(&self) -> Result<RgbaImage> {
        let (w, h) = (self.width, self.height);
        if w.saturating_mul(h) > MAX_COMPOSITE_PIXELS {
            return Err(Error::Unsupported("合成图尺寸过大".into()));
        }
        let base = self.base_channels();
        if self.channels < base {
            return Err(Error::Corrupt("通道数不足"));
        }
        let alpha = self.merged_alpha && self.channels > base;
        let wanted = base + alpha as usize;
        let planes = self.decode_planes(wanted, alpha.then_some(base))?;
        Ok(self.interleave(&planes, alpha))
    }

    /// Decodes the first `wanted` channel planes to 8-bit. `alpha_index`
    /// marks the plane that must not be gamma-encoded (32-bit docs).
    fn decode_planes(&self, wanted: usize, alpha_index: Option<usize>) -> Result<Vec<Vec<u8>>> {
        let (w, h, depth) = (self.width, self.height, self.depth);
        let row_bytes = (w * depth as usize).div_ceil(8);
        let mut r = Reader { buf: self.image_data, pos: 0 };
        let compression = r.u16()?;

        // Per-row source slices for every wanted channel, in plane order.
        let inflated: Vec<u8>;
        let rows: Vec<RowSource> = match compression {
            0 => {
                let data = r.take(self.channels * h * row_bytes)?;
                data.chunks_exact(row_bytes).take(wanted * h).map(RowSource::Raw).collect()
            }
            1 => {
                let counts: Vec<usize> = (0..self.channels * h)
                    .map(|_| if self.psb { r.u32().map(|v| v as usize) } else { r.u16().map(usize::from) })
                    .collect::<Result<_>>()?;
                counts[..wanted * h].iter().map(|&n| r.take(n).map(RowSource::PackBits)).collect::<Result<_>>()?
            }
            2 | 3 => {
                let need = wanted * h * row_bytes;
                let mut buf = Vec::with_capacity(need);
                flate2::read::ZlibDecoder::new(&self.image_data[r.pos..]).take(need as u64).read_to_end(&mut buf)?;
                if buf.len() < need {
                    return Err(Error::Corrupt("ZIP 图像数据不完整"));
                }
                inflated = buf;
                let wrap = if compression == 3 { RowSource::Predicted } else { RowSource::Raw };
                inflated.chunks_exact(row_bytes).map(wrap).collect()
            }
            _ => return Err(Error::Corrupt("未知的压缩方式")),
        };

        Ok((0..wanted)
            .into_par_iter()
            .map(|c| {
                let mut plane = vec![0u8; w * h];
                let gamma = alpha_index != Some(c);
                plane.par_chunks_mut(w).enumerate().for_each_init(
                    || vec![0u8; row_bytes],
                    |scratch, (y, dst)| {
                        let src = match rows[c * h + y] {
                            RowSource::Raw(s) => s,
                            RowSource::PackBits(s) => {
                                unpack_bits(s, scratch);
                                scratch
                            }
                            RowSource::Predicted(s) => {
                                scratch.copy_from_slice(s);
                                undo_prediction(scratch, depth, w);
                                scratch
                            }
                        };
                        row_to_8bit(src, depth, gamma, dst);
                    },
                );
                plane
            })
            .collect())
    }

    fn interleave(&self, planes: &[Vec<u8>], alpha: bool) -> RgbaImage {
        let w = self.width;
        let mut out = vec![0u8; w * self.height * 4];
        let alpha_plane = alpha.then(|| &planes[planes.len() - 1]);
        out.par_chunks_mut(w * 4).enumerate().for_each(|(y, row)| {
            for x in 0..w {
                let i = y * w + x;
                let rgb = match self.mode {
                    Mode::Bitmap | Mode::Gray => [planes[0][i]; 3],
                    Mode::Indexed => {
                        let p = planes[0][i] as usize;
                        let at = |k: usize| self.palette.get(k * 256 + p).copied().unwrap_or(0);
                        [at(0), at(1), at(2)]
                    }
                    Mode::Rgb => [planes[0][i], planes[1][i], planes[2][i]],
                    // PSD stores CMYK inverted: 255 means no ink.
                    Mode::Cmyk => {
                        let k = planes[3][i] as u32;
                        [0, 1, 2].map(|c| ((planes[c][i] as u32 * k + 127) / 255) as u8)
                    }
                    Mode::Lab => lab_to_srgb(planes[0][i], planes[1][i], planes[2][i]),
                };
                let px = &mut row[x * 4..x * 4 + 4];
                px[..3].copy_from_slice(&rgb);
                px[3] = alpha_plane.map_or(255, |a| a[i]);
            }
        });
        RgbaImage::from_raw(w as u32, self.height as u32, out).expect("buffer sized to image")
    }
}

enum RowSource<'a> {
    Raw(&'a [u8]),
    PackBits(&'a [u8]),
    /// ZIP-with-prediction row, still delta-encoded.
    Predicted(&'a [u8]),
}

/// Image resource 1036: 28-byte header followed by a JFIF stream.
fn parse_thumbnail(resources: &[u8]) -> Option<&[u8]> {
    let mut r = Reader { buf: resources, pos: 0 };
    while r.pos + 12 <= resources.len() {
        r.take(4).ok()?; // "8BIM" (or another vendor signature)
        let id = r.u16().ok()?;
        let name_len = *r.take(1).ok()?.first()? as usize;
        r.take(name_len + (name_len + 1) % 2).ok()?; // Pascal string padded to even
        let size = r.u32().ok()? as usize;
        let data = r.take(size).ok()?;
        r.take(size % 2).ok()?;
        if id == 1036 && data.len() > 28 && u32::from_be_bytes(data[..4].try_into().ok()?) == 1 {
            return Some(&data[28..]);
        }
    }
    None
}

/// A negative layer count means the first extra channel of the composite is
/// its transparency. 16/32-bit documents hide the layer info in `Lr16`/`Lr32`.
fn has_merged_alpha(layer_section: &[u8], psb: bool) -> bool {
    let mut r = Reader { buf: layer_section, pos: 0 };
    let count = |r: &mut Reader| r.u16().map(|v| (v as i16) < 0).unwrap_or(false);
    match r.section(psb) {
        Ok(info) if !info.is_empty() => count(&mut Reader { buf: info, pos: 0 }),
        _ => ["Lr16", "Lr32"].iter().find_map(|key| memmem::find(layer_section, key.as_bytes())).is_some_and(|at| {
            let mut r = Reader { buf: layer_section, pos: at + 4 };
            r.take(if psb { 8 } else { 4 }).is_ok() && count(&mut r)
        }),
    }
}

/// PackBits run-length decoding into a fixed-size row.
fn unpack_bits(src: &[u8], dst: &mut [u8]) {
    let (mut i, mut o) = (0, 0);
    while i < src.len() && o < dst.len() {
        let n = src[i] as i8;
        i += 1;
        if n >= 0 {
            let len = (n as usize + 1).min(dst.len() - o).min(src.len() - i);
            dst[o..o + len].copy_from_slice(&src[i..i + len]);
            i += len;
            o += len;
        } else if n != -128 {
            let len = (1 - n as isize) as usize;
            let len = len.min(dst.len() - o);
            if let Some(&v) = src.get(i) {
                dst[o..o + len].fill(v);
            }
            i += 1;
            o += len;
        }
    }
    dst[o..].fill(0);
}

/// ZIP-with-prediction: per-row deltas; 32-bit rows are additionally split
/// into byte planes (all MSBs first).
fn undo_prediction(row: &mut [u8], depth: u16, width: usize) {
    match depth {
        16 => {
            let mut prev = 0u16;
            for px in row.chunks_exact_mut(2) {
                prev = prev.wrapping_add(u16::from_be_bytes([px[0], px[1]]));
                px.copy_from_slice(&prev.to_be_bytes());
            }
        }
        32 => {
            for i in 1..row.len() {
                row[i] = row[i].wrapping_add(row[i - 1]);
            }
            let planar = row.to_vec();
            for x in 0..width {
                for b in 0..4 {
                    row[x * 4 + b] = planar[b * width + x];
                }
            }
        }
        _ => {
            for i in 1..row.len() {
                row[i] = row[i].wrapping_add(row[i - 1]);
            }
        }
    }
}

fn row_to_8bit(src: &[u8], depth: u16, gamma: bool, dst: &mut [u8]) {
    match depth {
        1 => dst.iter_mut().enumerate().for_each(|(x, d)| {
            // Bitmap mode: a set bit is black.
            *d = if src[x >> 3] >> (7 - (x & 7)) & 1 == 1 { 0 } else { 255 };
        }),
        8 => dst.copy_from_slice(&src[..dst.len()]),
        16 => dst.iter_mut().zip(src.chunks_exact(2)).for_each(|(d, s)| {
            *d = ((u16::from_be_bytes([s[0], s[1]]) as u32 * 255 + 32_767) / 65_535) as u8;
        }),
        _ => dst.iter_mut().zip(src.chunks_exact(4)).for_each(|(d, s)| {
            // 32-bit documents are linear light.
            let v = f32::from_be_bytes([s[0], s[1], s[2], s[3]]).clamp(0.0, 1.0);
            *d = ((if gamma { v.powf(1.0 / 2.2) } else { v }) * 255.0 + 0.5) as u8;
        }),
    }
}

fn lab_to_srgb(l: u8, a: u8, b: u8) -> [u8; 3] {
    let l = l as f32 * 100.0 / 255.0;
    let (a, b) = (a as f32 - 128.0, b as f32 - 128.0);
    let fy = (l + 16.0) / 116.0;
    let (fx, fz) = (fy + a / 500.0, fy - b / 200.0);
    let inv = |t: f32| if t > 6.0 / 29.0 { t * t * t } else { 3.0 * (6.0f32 / 29.0).powi(2) * (t - 4.0 / 29.0) };
    let (x, y, z) = (0.950_47 * inv(fx), inv(fy), 1.088_83 * inv(fz));
    let lin = [
        3.240_454_2 * x - 1.537_138_5 * y - 0.498_531_4 * z,
        -0.969_266 * x + 1.876_010_8 * y + 0.041_556 * z,
        0.055_643_4 * x - 0.204_025_9 * y + 1.057_225_2 * z,
    ];
    lin.map(|c| {
        let c = c.clamp(0.0, 1.0);
        let s = if c <= 0.003_130_8 { 12.92 * c } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 };
        (s * 255.0 + 0.5) as u8
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packbits_roundtrip() {
        // literal [1,2,3], run of five 9s, no-op, literal [7]
        let src = [2, 1, 2, 3, (-4i8) as u8, 9, (-128i8) as u8, 0, 7];
        let mut dst = [0u8; 9];
        unpack_bits(&src, &mut dst);
        assert_eq!(dst, [1, 2, 3, 9, 9, 9, 9, 9, 7]);
    }

    /// Minimal 2×1 RGBA document, RLE-compressed, negative layer count.
    fn sample_psd() -> Vec<u8> {
        let mut v = b"8BPS".to_vec();
        v.extend(1u16.to_be_bytes());
        v.extend([0u8; 6]);
        v.extend(4u16.to_be_bytes()); // channels
        v.extend(1u32.to_be_bytes()); // height
        v.extend(2u32.to_be_bytes()); // width
        v.extend(8u16.to_be_bytes()); // depth
        v.extend(3u16.to_be_bytes()); // RGB
        v.extend(0u32.to_be_bytes()); // color mode data
        v.extend(0u32.to_be_bytes()); // image resources
        v.extend(6u32.to_be_bytes()); // layer & mask section
        v.extend(2u32.to_be_bytes()); // layer info length
        v.extend((-1i16).to_be_bytes()); // layer count < 0 ⇒ merged alpha
        v.extend(1u16.to_be_bytes()); // RLE
        v.extend([3u16; 4].iter().flat_map(|c| c.to_be_bytes()));
        for (a, b) in [(255, 0), (0, 255), (10, 20), (128, 255)] {
            v.extend([1, a, b]);
        }
        v
    }

    #[test]
    fn decodes_rle_rgba_composite() {
        let bytes = sample_psd();
        let doc = Document::parse(&bytes).unwrap();
        assert!(doc.merged_alpha);
        let img = doc.composite().unwrap();
        assert_eq!(img.as_raw(), &[255, 0, 10, 128, 0, 255, 20, 255]);
    }

    #[test]
    fn sixteen_bit_and_float_rows() {
        let mut dst = [0u8; 2];
        row_to_8bit(&[0xFF, 0xFF, 0x80, 0x00], 16, true, &mut dst);
        assert_eq!(dst, [255, 128]);
        let mut dst = [0u8; 1];
        row_to_8bit(&0.5f32.to_be_bytes(), 32, false, &mut dst);
        assert_eq!(dst, [128]);
    }

    #[test]
    fn head_parses_without_layers_and_stream_falls_back_to_composite() {
        let bytes = sample_psd();
        let head = read_head(&mut bytes.as_slice()).unwrap();
        assert_eq!(dimensions(&head).unwrap(), (2, 1));
        // No embedded thumbnail ⇒ the stream path decodes the real composite.
        let img = super::super::stream::thumbnail(&mut std::io::Cursor::new(bytes), "PSD", 256).unwrap();
        assert_eq!(img.as_raw(), &[255, 0, 10, 128, 0, 255, 20, 255]);
    }
}
