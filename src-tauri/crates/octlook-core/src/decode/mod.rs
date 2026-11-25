//! Decoding pipeline. Every format resolves to one of four payloads:
//!
//! * `Native`  – the WebView decodes the file itself (zero copy via asset protocol).
//! * `Pdf`     – rendered as vectors by pdf.js on the frontend. Carries the
//!   document bytes for viewing; empty for thumbnails (fetched on demand).
//! * `Encoded` – an image extracted verbatim from a container (no re-encode).
//! * `Pixels`  – RGBA8 decoded in Rust.

mod container;
mod embedded;
#[cfg(target_os = "macos")]
mod imageio;
mod psd;
pub(crate) mod raster;
pub mod stream;
mod svg;
#[cfg(windows)]
mod wic;

use std::{
    fs::File,
    io::{BufReader, Cursor},
    path::Path,
};

use image::RgbaImage;
use serde::Serialize;

use crate::{
    format::{self, Format},
    meta, Error, Result,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    View,
    Thumbnail,
}

pub enum Payload {
    Native,
    Pdf(Vec<u8>),
    Encoded { bytes: Vec<u8>, mime: &'static str },
    Pixels(RgbaImage),
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// The document itself was rendered.
    Full,
    /// A flattened preview embedded by the authoring app was shown.
    Preview,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub format: &'static str,
    pub source: Source,
    pub detail: Option<String>,
    /// EXIF orientation (1–8) the frontend must apply.
    pub orientation: u16,
    /// Set when pixels were downscaled to fit GPU texture limits.
    pub original_size: Option<[u32; 2]>,
}

pub struct Decoded {
    pub payload: Payload,
    pub meta: Meta,
}

impl Decoded {
    fn new(format: Format, payload: Payload, source: Source) -> Self {
        let meta = Meta { format: format.label(), source, detail: None, orientation: 1, original_size: None };
        Self { payload, meta }
    }

    fn detail(mut self, detail: Option<String>) -> Self {
        self.meta.detail = detail;
        self
    }

    fn orientation(mut self, orientation: u16) -> Self {
        self.meta.orientation = orientation;
        self
    }
}

/// Encoded previews returned to the frontend.
pub(crate) struct Extracted {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

impl From<Extracted> for Payload {
    fn from(e: Extracted) -> Self {
        Payload::Encoded { bytes: e.bytes, mime: e.mime }
    }
}

pub fn decode(path: &Path, purpose: Purpose) -> Result<Decoded> {
    let format = format::detect(path)
        .ok_or_else(|| Error::Unsupported(format::extension(path).unwrap_or_default()))?;

    let decoded = match format {
        Format::Native(name) => match purpose {
            Purpose::View => Decoded::new(format, Payload::Native, Source::Full),
            // AVIF thumbnails are rasterised by the WebView instead.
            Purpose::Thumbnail if name == "AVIF" => Decoded::new(format, Payload::Native, Source::Full),
            Purpose::Thumbnail => {
                Decoded::new(format, Payload::Pixels(raster::open(path)?), Source::Full).orientation(meta::orientation(path))
            }
        },
        Format::Svg => Decoded::new(format, Payload::Native, Source::Full),
        Format::Pdf => Decoded::new(format, Payload::Pdf(pdf_bytes(purpose, || std::fs::read(path))?), Source::Full),
        Format::Ai { pdf: true } if purpose == Purpose::View => {
            Decoded::new(format, Payload::Pdf(std::fs::read(path)?), Source::Full)
        }
        // Streamed: large Krita/XD documents are never read whole.
        Format::ZipPreview(_) => preview(format, container::zip_preview(BufReader::new(File::open(path)?))?, ZIP_PREVIEW)?,
        Format::CameraRaw => camera_raw(path, format, purpose)?,
        Format::Raster(_) => {
            let pixels = raster::open(path).or_else(|e| os_codec(path).map_err(|_| e))?;
            Decoded::new(format, Payload::Pixels(pixels), Source::Full).orientation(meta::orientation(path))
        }
        Format::OsCodec(_) => {
            Decoded::new(format, Payload::Pixels(os_codec(path)?), Source::Full).orientation(meta::orientation(path))
        }
        _ => decode_bytes(&std::fs::read(path)?, format, purpose)?,
    };
    Ok(fit_texture_limits(decoded))
}

const ZIP_PREVIEW: &str = "设计文件预览图";

/// Formats whose preview lives entirely in the file bytes
/// (see [`Format::decodes_from_bytes`]).
pub fn decode_bytes(buf: &[u8], format: Format, purpose: Purpose) -> Result<Decoded> {
    Ok(match format {
        Format::Ai { pdf: is_pdf } => match embedded::xmp_thumbnail(buf) {
            Some(x) => Decoded::new(format, x.into(), Source::Preview),
            None if is_pdf => Decoded::new(format, Payload::Pdf(pdf_bytes(purpose, || Ok(buf.to_vec()))?), Source::Full),
            None => return Err(Error::NoPreview("该 AI 文件未包含 PDF 兼容内容与缩略图")),
        },
        Format::Psd => psd::decode(buf, purpose)?,
        Format::Eps => match embedded::eps_tiff_preview(buf) {
            Some(tiff) => Decoded::new(format, Payload::Pixels(raster::from_memory(tiff)?), Source::Preview),
            None => preview(format, embedded::xmp_thumbnail(buf), "EPS 未内嵌 TIFF/XMP 预览")?,
        },
        Format::Indd => preview(format, embedded::xmp_thumbnail(buf), "InDesign 缩略图")?,
        Format::Affinity => preview(format, embedded::largest_png(buf), "Affinity 缩略图")?,
        Format::Cdr => preview(format, container::cdr_preview(buf)?, "CorelDRAW 缩略图")?,
        Format::ZipPreview(_) => preview(format, container::zip_preview(Cursor::new(buf))?, ZIP_PREVIEW)?,
        other => return Err(Error::Unsupported(format!("{}（需要文件路径）", other.label()))),
    })
}

/// pdf.js needs the document only for viewing; thumbnails fetch it lazily.
fn pdf_bytes(purpose: Purpose, read: impl FnOnce() -> std::io::Result<Vec<u8>>) -> Result<Vec<u8>> {
    Ok(if purpose == Purpose::View { read()? } else { Vec::new() })
}

fn preview(format: Format, found: Option<Extracted>, what: &'static str) -> Result<Decoded> {
    found
        .map(|x| Decoded::new(format, x.into(), Source::Preview))
        .ok_or(Error::NoPreview(what))
}

/// RAW files carry a camera-rendered JPEG; it is what photographers expect to
/// see and is orders of magnitude faster than demosaicing. Tiny previews fall
/// back to the OS RAW codec where available.
fn camera_raw(path: &Path, format: Format, purpose: Purpose) -> Result<Decoded> {
    const MIN_VIEW_EDGE: u32 = 1600;
    let buf = std::fs::read(path)?;
    let min_edge = if purpose == Purpose::View { MIN_VIEW_EDGE } else { 256 };
    let orientation = meta::orientation(path);

    match embedded::best_jpeg(&buf, min_edge) {
        Some((jpeg, edge)) if edge >= min_edge || cfg!(not(windows)) => {
            Ok(Decoded::new(format, jpeg.into(), Source::Preview).orientation(orientation))
        }
        small => match os_codec(path) {
            Ok(px) => Ok(Decoded::new(format, Payload::Pixels(px), Source::Full).orientation(orientation)),
            Err(e) => small
                .map(|(jpeg, _)| Decoded::new(format, jpeg.into(), Source::Preview).orientation(orientation))
                .ok_or(e),
        },
    }
}

#[cfg(windows)]
fn os_codec(path: &Path) -> Result<RgbaImage> {
    wic::decode(path)
}

#[cfg(target_os = "macos")]
fn os_codec(path: &Path) -> Result<RgbaImage> {
    imageio::decode(path)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn os_codec(path: &Path) -> Result<RgbaImage> {
    Err(Error::Unsupported(format!("{}（需要系统解码器）", path.display())))
}

/// Chromium refuses canvases above 268M px or 32767 px per side.
fn fit_texture_limits(mut decoded: Decoded) -> Decoded {
    const MAX_EDGE: u32 = 32_767;
    const MAX_AREA: u64 = 268_435_456;
    if let Payload::Pixels(px) = &decoded.payload {
        let (w, h) = px.dimensions();
        let area_ratio = (MAX_AREA as f64 / (w as u64 * h as u64) as f64).sqrt();
        let ratio = area_ratio.min(MAX_EDGE as f64 / w.max(h) as f64);
        if ratio < 1.0 {
            let (nw, nh) = (((w as f64 * ratio) as u32).max(1), ((h as f64 * ratio) as u32).max(1));
            decoded.payload = Payload::Pixels(raster::resize(px, nw, nh));
            decoded.meta.original_size = Some([w, h]);
        }
    }
    decoded
}

#[cfg(test)]
mod sample_tests {
    use super::*;

    /// Decodes every supported file in `$OCTLOOK_SAMPLES` and writes what the
    /// viewer would show to `$OCTLOOK_OUT`. Run with `cargo test -- --ignored`.
    #[test]
    #[ignore = "needs local sample files"]
    fn decode_local_samples() {
        let (Ok(dir), Ok(out)) = (std::env::var("OCTLOOK_SAMPLES"), std::env::var("OCTLOOK_OUT")) else { return };
        std::fs::create_dir_all(&out).unwrap();
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if !format::is_supported(&path) {
                continue;
            }
            let started = std::time::Instant::now();
            let result = decode(&path, Purpose::View);
            let elapsed = started.elapsed();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            match result {
                Ok(d) => {
                    let what = match &d.payload {
                        Payload::Native => "native".to_string(),
                        Payload::Pdf(b) => format!("pdf {} bytes", b.len()),
                        Payload::Encoded { bytes, mime } => {
                            std::fs::write(format!("{out}/{name}.bin"), bytes).unwrap();
                            format!("encoded {mime} {} bytes", bytes.len())
                        }
                        Payload::Pixels(px) => {
                            px.save(format!("{out}/{name}.png")).unwrap();
                            format!("pixels {}x{}", px.width(), px.height())
                        }
                    };
                    println!("OK   {name}: {what} [{} {:?}] {:?} in {elapsed:?}", d.meta.format, d.meta.detail, d.meta.source == Source::Full);
                }
                Err(e) => println!("FAIL {name}: {e} in {elapsed:?}"),
            }
        }
    }
}
