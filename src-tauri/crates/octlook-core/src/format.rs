//! File-type detection. Extension decides the family; magic bytes refine it
//! where one extension covers several physical layouts (AI, CDR).

use std::{fs::File, io::Read, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// Decoded by the WebView itself (Chromium codecs).
    Native(&'static str),
    /// Shown by the WebView; rasterised in Rust only for Explorer thumbnails.
    Svg,
    Pdf,
    /// Illustrator: PDF-compatible (`pdf == true`) or legacy PostScript.
    Ai { pdf: bool },
    Psd,
    Eps,
    Cdr,
    Indd,
    Affinity,
    /// ZIP containers that ship a flattened preview (Sketch, XD, Figma, Krita…).
    ZipPreview(&'static str),
    CameraRaw,
    /// Decoded in Rust by the `image` crate (WIC fallback on Windows).
    Raster(&'static str),
    /// Only decodable through OS codecs (HEIC, JPEG XR, JPEG XL).
    OsCodec(&'static str),
}

/// Single source of truth for supported extensions: (extension, family).
const TABLE: &[(&str, Format)] = &[
    ("jpg", Format::Native("JPEG")), ("jpeg", Format::Native("JPEG")), ("jfif", Format::Native("JPEG")),
    ("png", Format::Native("PNG")), ("apng", Format::Native("APNG")), ("gif", Format::Native("GIF")),
    ("webp", Format::Native("WebP")), ("avif", Format::Native("AVIF")), ("bmp", Format::Native("BMP")),
    ("ico", Format::Native("ICO")), ("svg", Format::Svg),
    ("tif", Format::Raster("TIFF")), ("tiff", Format::Raster("TIFF")), ("tga", Format::Raster("TGA")),
    ("dds", Format::Raster("DDS")), ("hdr", Format::Raster("HDR")), ("exr", Format::Raster("OpenEXR")),
    ("qoi", Format::Raster("QOI")), ("pbm", Format::Raster("PBM")), ("pgm", Format::Raster("PGM")),
    ("ppm", Format::Raster("PPM")), ("pam", Format::Raster("PAM")),
    ("heic", Format::OsCodec("HEIC")), ("heif", Format::OsCodec("HEIF")), ("jxl", Format::OsCodec("JPEG XL")),
    ("jxr", Format::OsCodec("JPEG XR")), ("wdp", Format::OsCodec("JPEG XR")),
    ("psd", Format::Psd), ("psb", Format::Psd),
    ("ai", Format::Ai { pdf: false }), ("eps", Format::Eps), ("epsf", Format::Eps), ("pdf", Format::Pdf),
    ("cdr", Format::Cdr), ("indd", Format::Indd),
    ("afphoto", Format::Affinity), ("afdesign", Format::Affinity), ("afpub", Format::Affinity),
    ("sketch", Format::ZipPreview("Sketch")), ("xd", Format::ZipPreview("Adobe XD")), ("fig", Format::ZipPreview("Figma")),
    ("kra", Format::ZipPreview("Krita")), ("ora", Format::ZipPreview("OpenRaster")), ("procreate", Format::ZipPreview("Procreate")),
    ("cr2", Format::CameraRaw), ("cr3", Format::CameraRaw), ("crw", Format::CameraRaw), ("nef", Format::CameraRaw), ("nrw", Format::CameraRaw),
    ("arw", Format::CameraRaw), ("srf", Format::CameraRaw), ("sr2", Format::CameraRaw), ("dng", Format::CameraRaw), ("raf", Format::CameraRaw),
    ("orf", Format::CameraRaw), ("rw2", Format::CameraRaw), ("pef", Format::CameraRaw), ("srw", Format::CameraRaw), ("x3f", Format::CameraRaw),
    ("3fr", Format::CameraRaw), ("iiq", Format::CameraRaw), ("rwl", Format::CameraRaw),
];

pub fn extension(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
}

pub fn is_supported(path: &Path) -> bool {
    extension(path).is_some_and(|ext| TABLE.iter().any(|(e, _)| *e == ext))
}

/// Every supported (extension, family) pair.
pub fn entries() -> impl Iterator<Item = (&'static str, Format)> {
    TABLE.iter().copied()
}

pub fn supported_extensions() -> Vec<&'static str> {
    entries().map(|(e, _)| e).collect()
}

/// Extensions whose previews are decoded from the file bytes alone, i.e.
/// the ones an Explorer thumbnail handler (which only gets a stream) serves.
pub fn stream_extensions() -> impl Iterator<Item = &'static str> {
    entries().filter(|(_, f)| f.decodes_from_bytes()).map(|(e, _)| e)
}

pub fn detect(path: &Path) -> Option<Format> {
    from_extension(&extension(path)?, &head(path))
}

/// `head` is the start of the file (8 bytes suffice).
pub fn from_extension(ext: &str, head: &[u8]) -> Option<Format> {
    match TABLE.iter().find(|(e, _)| e.eq_ignore_ascii_case(ext))?.1 {
        Format::Ai { .. } => Some(Format::Ai { pdf: head.starts_with(b"%PDF") }),
        format => Some(format),
    }
}

impl Format {
    /// Formats whose preview needs neither a file path nor an OS codec.
    pub fn decodes_from_bytes(self) -> bool {
        matches!(self, Format::Svg | Format::Psd | Format::Ai { .. } | Format::Eps | Format::Cdr | Format::Indd | Format::Affinity | Format::ZipPreview(_))
    }

    pub fn label(self) -> &'static str {
        match self {
            Format::Native(n) | Format::Raster(n) | Format::OsCodec(n) | Format::ZipPreview(n) => n,
            Format::Svg => "SVG",
            Format::Pdf => "PDF",
            Format::Ai { .. } => "Adobe Illustrator",
            Format::Psd => "Photoshop",
            Format::Eps => "EPS",
            Format::Cdr => "CorelDRAW",
            Format::Indd => "InDesign",
            Format::Affinity => "Affinity",
            Format::CameraRaw => "Camera RAW",
        }
    }
}

fn head(path: &Path) -> [u8; 8] {
    let mut buf = [0u8; 8];
    if let Ok(mut f) = File::open(path) {
        let _ = f.read(&mut buf);
    }
    buf
}
