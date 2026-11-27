//! Decoding pipeline. Every format resolves to one of four payloads:
//!
//! * `Native`  – the WebView decodes the file itself (zero copy via asset protocol).
//! * `Pdf`     – rendered as vectors by pdf.js on the frontend. Carries the
//!   document bytes for viewing; empty for thumbnails (fetched on demand).
//! * `Encoded` – an image extracted verbatim from a container (no re-encode).
//! * `Pixels`  – RGBA8 decoded in Rust.
//!
//! Video, audio, text and fonts are `Native` too: `meta.category` sends them
//! to their own viewers instead of the image stage.

mod blender;
mod container;
mod cover;
mod embedded;
#[cfg(target_os = "macos")]
mod imageio;
mod pdf_art;
pub mod postscript;
mod psd;
pub(crate) mod raster;
pub mod stream;
mod svg;
#[cfg(windows)]
mod wic;

use std::{
    fs::File,
    io::{BufReader, Cursor, Read},
    path::Path,
};

use image::RgbaImage;
use serde::Serialize;

use crate::{
    format::{self, Category, Format},
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
    pub category: Category,
    pub source: Source,
    pub detail: Option<String>,
    /// EXIF orientation (1–8) the frontend must apply.
    pub orientation: u16,
    /// Set when pixels were downscaled to fit GPU texture limits.
    pub original_size: Option<[u32; 2]>,
    /// Why only an embedded preview could be shown, when the decoder knows.
    pub note: Option<&'static str>,
}

pub struct Decoded {
    pub payload: Payload,
    pub meta: Meta,
}

impl Decoded {
    fn new(format: Format, payload: Payload, source: Source) -> Self {
        let meta = Meta { format: format.label(), category: format.category(), source, detail: None, orientation: 1, original_size: None, note: None };
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

    fn note(mut self, note: &'static str) -> Self {
        self.meta.note = Some(note);
        self
    }
}

const AI_NOTE: &str =
    "保存时未勾选「创建 PDF 兼容文件」，文件中只有这张小预览图。在 Illustrator 中勾选该项后重新保存，即可清晰显示。";
const CDR_NOTE: &str = "CorelDRAW 的矢量内容是私有格式，暂无法直接渲染，这里显示的是文件内嵌的预览图。";

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
        Format::Svg if format::extension(path).as_deref() == Some("svgz") => svgz(path, format, purpose)?,
        Format::Svg => Decoded::new(format, Payload::Native, Source::Full),
        Format::PostScript(_) => postscript(path, format, purpose)?,
        Format::Audio(_) if purpose == Purpose::Thumbnail => match cover::audio(path) {
            Some(art) => Decoded::new(format, art.into(), Source::Full),
            None => Decoded::new(format, Payload::Native, Source::Full),
        },
        // Played or shown by the WebView; thumbnails are drawn there too, from `meta.category`.
        Format::Video(_) | Format::Audio(_) | Format::Text(_) | Format::Font(_) => {
            Decoded::new(format, Payload::Native, Source::Full)
        }
        Format::Pdf => Decoded::new(format, Payload::Pdf(pdf_bytes(purpose, || std::fs::read(path))?), Source::Full),
        Format::Ai { pdf: true } if purpose == Purpose::View => {
            let buf = std::fs::read(path)?;
            // An AI whose PDF part draws nothing (artwork kept only in Illustrator's
            // private data) would render blank: show its embedded preview instead.
            match pdf_art::is_blank(&buf).then(|| embedded::xmp_thumbnail(&buf)).flatten() {
                Some(x) => Decoded::new(format, x.into(), Source::Preview).note(AI_NOTE),
                None => Decoded::new(format, Payload::Pdf(buf), Source::Full),
            }
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
            // A PDF-compatible AI only lands here for thumbnails: no note needed.
            Some(x) if is_pdf => Decoded::new(format, x.into(), Source::Preview),
            Some(x) => Decoded::new(format, x.into(), Source::Preview).note(AI_NOTE),
            None if is_pdf => Decoded::new(format, Payload::Pdf(pdf_bytes(purpose, || Ok(buf.to_vec()))?), Source::Full),
            None => return Err(Error::NoPreview("该 AI 文件未包含 PDF 兼容内容与缩略图")),
        },
        Format::Psd => psd::decode(buf, purpose)?,
        Format::PostScript(_) => match embedded::eps_tiff_preview(buf) {
            Some(tiff) => Decoded::new(format, Payload::Pixels(raster::from_memory(tiff)?), Source::Preview),
            None => preview(format, embedded::xmp_thumbnail(buf), "EPS 未内嵌 TIFF/XMP 预览")?,
        },
        Format::Blender => match blender::thumbnail(buf) {
            Some(pixels) => Decoded::new(format, Payload::Pixels(pixels), Source::Preview),
            None => return Err(Error::NoPreview("该文件保存时未生成缩略图")),
        },
        Format::Icns => Decoded::new(format, embedded::largest_png(buf).ok_or(Error::NoPreview("图标中没有 PNG 图像"))?.into(), Source::Full),
        Format::Indd => preview(format, embedded::xmp_thumbnail(buf), "InDesign 缩略图")?,
        Format::Affinity => preview(format, embedded::largest_png(buf), "Affinity 缩略图")?,
        Format::Cdr => preview(format, container::cdr_preview(buf)?, "CorelDRAW 缩略图")?.note(CDR_NOTE),
        Format::ZipPreview(_) => preview(format, container::zip_preview(Cursor::new(buf))?, ZIP_PREVIEW)?,
        other => return Err(Error::Unsupported(format!("{}（需要文件路径）", other.label()))),
    })
}

/// Gzipped SVG: the WebView cannot open it from disk, so it gets the plain
/// document (drawn as a vector like any SVG); thumbnails are rasterised here.
fn svgz(path: &Path, format: Format, purpose: Purpose) -> Result<Decoded> {
    const THUMB_EDGE: u32 = 1024;
    let mut svg = Vec::new();
    flate2::read::GzDecoder::new(File::open(path)?).read_to_end(&mut svg)?;
    Ok(match purpose {
        Purpose::View => Decoded::new(format, Payload::Encoded { bytes: svg, mime: "image/svg+xml" }, Source::Full),
        Purpose::Thumbnail => Decoded::new(format, Payload::Pixels(svg::render(&svg, THUMB_EDGE)?), Source::Full),
    })
}

/// EPS/PostScript through Ghostscript, drawn as a PDF. Thumbnails prefer the
/// embedded preview (instant); without one the frontend asks for the PDF.
/// Should Ghostscript be missing or fail, the embedded preview stands in.
fn postscript(path: &Path, format: Format, purpose: Purpose) -> Result<Decoded> {
    let buf = std::fs::read(path)?;
    if purpose == Purpose::Thumbnail || !postscript::available() {
        return decode_bytes(&buf, format, purpose).or_else(|e| match postscript::available() {
            true => Ok(Decoded::new(format, Payload::Pdf(Vec::new()), Source::Full)),
            false => Err(e),
        });
    }
    match postscript::to_pdf(path) {
        Ok(pdf) => Ok(Decoded::new(format, Payload::Pdf(pdf), Source::Full)),
        Err(e) => decode_bytes(&buf, format, purpose).map_err(|_| e),
    }
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
        // A bundled Ghostscript is named by $OCTLOOK_GS; otherwise an installed one is used.
        postscript::init(Path::new(&std::env::var("OCTLOOK_GS").unwrap_or_default()));
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
