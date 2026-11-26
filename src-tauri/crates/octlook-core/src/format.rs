//! File-type detection. Extension decides the family; magic bytes refine it
//! where one extension covers several physical layouts (AI, `.ts`).

use std::{fs::File, io::Read, path::Path};

use serde::Serialize;

/// How a file is presented: images (incl. design files) go on the zoomable
/// stage with editing tools; the rest get their own read-only viewers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Image,
    Video,
    Audio,
    Text,
    Font,
}

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
    Video(&'static str),
    Audio(&'static str),
    /// Plain text, markup or source code; the label names the language.
    Text(&'static str),
    Font(&'static str),
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
    // Video and audio: played by the WebView, or through FFmpeg when it cannot.
    ("mp4", Format::Video("MP4")), ("m4v", Format::Video("MP4")), ("mov", Format::Video("QuickTime")),
    ("mkv", Format::Video("Matroska")), ("webm", Format::Video("WebM")), ("avi", Format::Video("AVI")),
    ("wmv", Format::Video("WMV")), ("asf", Format::Video("ASF")), ("flv", Format::Video("FLV")), ("f4v", Format::Video("F4V")),
    ("mts", Format::Video("AVCHD")), ("m2ts", Format::Video("AVCHD")), ("mpg", Format::Video("MPEG")),
    ("mpeg", Format::Video("MPEG")), ("vob", Format::Video("DVD")), ("3gp", Format::Video("3GP")),
    ("ogv", Format::Video("Ogg Video")), ("rm", Format::Video("RealMedia")), ("rmvb", Format::Video("RealMedia")),
    ("mp3", Format::Audio("MP3")), ("aac", Format::Audio("AAC")), ("m4a", Format::Audio("M4A")), ("wav", Format::Audio("WAV")),
    ("flac", Format::Audio("FLAC")), ("ogg", Format::Audio("Ogg")), ("oga", Format::Audio("Ogg")),
    ("opus", Format::Audio("Opus")), ("wma", Format::Audio("WMA")), ("ape", Format::Audio("APE")), ("aif", Format::Audio("AIFF")),
    ("aiff", Format::Audio("AIFF")), ("ac3", Format::Audio("AC-3")), ("dts", Format::Audio("DTS")), ("amr", Format::Audio("AMR")),
    ("mka", Format::Audio("Matroska Audio")),
    // Text and source code ("ts" may also be an MPEG transport stream: see `from_extension`).
    ("txt", Format::Text("纯文本")), ("log", Format::Text("日志")), ("md", Format::Text("Markdown")),
    ("markdown", Format::Text("Markdown")), ("csv", Format::Text("CSV")), ("tsv", Format::Text("TSV")),
    ("json", Format::Text("JSON")), ("jsonc", Format::Text("JSON")), ("yaml", Format::Text("YAML")),
    ("yml", Format::Text("YAML")), ("toml", Format::Text("TOML")), ("ini", Format::Text("INI")), ("cfg", Format::Text("配置")),
    ("conf", Format::Text("配置")), ("xml", Format::Text("XML")), ("html", Format::Text("HTML")), ("htm", Format::Text("HTML")),
    ("css", Format::Text("CSS")), ("scss", Format::Text("SCSS")), ("less", Format::Text("Less")),
    ("js", Format::Text("JavaScript")), ("mjs", Format::Text("JavaScript")), ("cjs", Format::Text("JavaScript")),
    ("jsx", Format::Text("JavaScript")), ("ts", Format::Text("TypeScript")), ("tsx", Format::Text("TypeScript")),
    ("vue", Format::Text("Vue")), ("svelte", Format::Text("Svelte")), ("py", Format::Text("Python")),
    ("rs", Format::Text("Rust")), ("go", Format::Text("Go")), ("java", Format::Text("Java")), ("kt", Format::Text("Kotlin")),
    ("c", Format::Text("C")), ("h", Format::Text("C")), ("cpp", Format::Text("C++")), ("cc", Format::Text("C++")),
    ("hpp", Format::Text("C++")), ("cs", Format::Text("C#")), ("swift", Format::Text("Swift")), ("dart", Format::Text("Dart")),
    ("php", Format::Text("PHP")), ("rb", Format::Text("Ruby")), ("lua", Format::Text("Lua")), ("sql", Format::Text("SQL")),
    ("sh", Format::Text("Shell")), ("bash", Format::Text("Shell")), ("zsh", Format::Text("Shell")),
    ("ps1", Format::Text("PowerShell")), ("bat", Format::Text("批处理")), ("cmd", Format::Text("批处理")),
    ("ttf", Format::Font("TrueType")), ("otf", Format::Font("OpenType")), ("ttc", Format::Font("TrueType 集合")),
    ("otc", Format::Font("OpenType 集合")), ("woff", Format::Font("WOFF")), ("woff2", Format::Font("WOFF2")),
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

/// Bytes of the file start `from_extension` may look at.
pub const HEAD_LEN: usize = 189;

/// `head` is the start of the file (up to [`HEAD_LEN`] bytes).
pub fn from_extension(ext: &str, head: &[u8]) -> Option<Format> {
    match TABLE.iter().find(|(e, _)| e.eq_ignore_ascii_case(ext))?.1 {
        Format::Ai { .. } => Some(Format::Ai { pdf: head.starts_with(b"%PDF") }),
        // MPEG-TS packets are 188 bytes, each starting with the 0x47 sync byte.
        Format::Text("TypeScript") if head.len() >= HEAD_LEN && head[0] == 0x47 && head[188] == 0x47 => {
            Some(Format::Video("MPEG-TS"))
        }
        format => Some(format),
    }
}

impl Format {
    /// Formats whose preview needs neither a file path nor an OS codec.
    pub fn decodes_from_bytes(self) -> bool {
        matches!(self, Format::Svg | Format::Psd | Format::Ai { .. } | Format::Eps | Format::Cdr | Format::Indd | Format::Affinity | Format::ZipPreview(_))
    }

    /// Files OctLook shows but cannot author, whose own apps do far more
    /// (Photoshop, Acrobat, a code editor…). Photos, video, audio and fonts are
    /// fully served by the viewer itself.
    pub fn edited_elsewhere(self) -> bool {
        matches!(
            self,
            Format::Svg
                | Format::Pdf
                | Format::Psd
                | Format::Ai { .. }
                | Format::Eps
                | Format::Cdr
                | Format::Indd
                | Format::Affinity
                | Format::ZipPreview(_)
                | Format::Text(_)
        )
    }

    pub fn category(self) -> Category {
        match self {
            Format::Video(_) => Category::Video,
            Format::Audio(_) => Category::Audio,
            Format::Text(_) => Category::Text,
            Format::Font(_) => Category::Font,
            _ => Category::Image,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Format::Native(n) | Format::Raster(n) | Format::OsCodec(n) | Format::ZipPreview(n) => n,
            Format::Video(n) | Format::Audio(n) | Format::Text(n) | Format::Font(n) => n,
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

fn head(path: &Path) -> Vec<u8> {
    let mut buf = Vec::with_capacity(HEAD_LEN);
    if let Ok(f) = File::open(path) {
        let _ = f.take(HEAD_LEN as u64).read_to_end(&mut buf);
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ts_is_typescript_unless_it_carries_mpeg_ts_packets() {
        assert_eq!(from_extension("ts", b"import x from 'y';"), Some(Format::Text("TypeScript")));
        let mut packets = vec![0u8; HEAD_LEN];
        (packets[0], packets[188]) = (0x47, 0x47);
        assert_eq!(from_extension("ts", &packets), Some(Format::Video("MPEG-TS")));
        assert_eq!(from_extension("MKV", b"").map(Format::category), Some(Category::Video));
    }
}
