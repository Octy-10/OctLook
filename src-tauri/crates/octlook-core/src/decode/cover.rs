//! Album art embedded in audio files (ID3 APIC, FLAC/Vorbis pictures, MP4 `covr`…).

use std::path::Path;

use lofty::{config::ParseOptions, file::TaggedFileExt, picture::PictureType, probe::Probe};

use super::Extracted;

/// The front cover, else the first picture of any kind.
pub fn audio(path: &Path) -> Option<Extracted> {
    let file = Probe::open(path).ok()?.options(ParseOptions::new().read_properties(false)).read().ok()?;
    let pictures: Vec<_> = file.tags().iter().flat_map(|t| t.pictures()).collect();
    let picture = pictures.iter().find(|p| p.pic_type() == PictureType::CoverFront).or(pictures.first())?;
    let bytes = picture.data().to_vec();
    // Re-encoded to PNG by the thumbnailer: the type only has to be close.
    let mime = if bytes.starts_with(b"\x89PNG") { "image/png" } else { "image/jpeg" };
    Some(Extracted { bytes, mime })
}
