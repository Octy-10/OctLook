//! File metadata: EXIF orientation and the photographic summary shown in
//! the info panel.

use std::{fs::File, io::BufReader, path::Path, time::UNIX_EPOCH};

use exif::{In, Tag};
use serde::Serialize;

fn read_exif(path: &Path) -> Option<exif::Exif> {
    let mut reader = BufReader::new(File::open(path).ok()?);
    exif::Reader::new().read_from_container(&mut reader).ok()
}

/// EXIF orientation 1–8; 1 when absent.
pub fn orientation(path: &Path) -> u16 {
    read_exif(path)
        .and_then(|e| e.get_field(Tag::Orientation, In::PRIMARY)?.value.get_uint(0))
        .filter(|o| (1..=8).contains(o))
        .map_or(1, |o| o as u16)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub size: u64,
    pub modified: Option<u64>,
    pub created: Option<u64>,
    pub exif: Vec<ExifEntry>,
}

#[derive(Serialize)]
pub struct ExifEntry {
    pub key: &'static str,
    pub value: String,
}

pub fn file_info(path: &Path) -> std::io::Result<FileInfo> {
    let md = std::fs::metadata(path)?;
    let millis = |t: std::io::Result<std::time::SystemTime>| {
        t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64)
    };
    Ok(FileInfo { size: md.len(), modified: millis(md.modified()), created: millis(md.created()), exif: exif_entries(path) })
}

fn exif_entries(path: &Path) -> Vec<ExifEntry> {
    const TAGS: &[(&str, Tag)] = &[
        ("make", Tag::Make),
        ("model", Tag::Model),
        ("lens", Tag::LensModel),
        ("aperture", Tag::FNumber),
        ("shutter", Tag::ExposureTime),
        ("iso", Tag::PhotographicSensitivity),
        ("focal", Tag::FocalLength),
        ("taken", Tag::DateTimeOriginal),
    ];
    let Some(exif) = read_exif(path) else { return Vec::new() };
    TAGS.iter()
        .filter_map(|&(key, tag)| {
            let field = exif.get_field(tag, In::PRIMARY)?;
            let value = field.display_value().with_unit(&exif).to_string().trim_matches('"').trim().to_string();
            (!value.is_empty()).then_some(ExifEntry { key, value })
        })
        .collect()
}
