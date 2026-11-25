//! Sibling listing for keyboard / filmstrip navigation.

use std::{
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;

use octlook_core::format;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub dir: PathBuf,
    pub entries: Vec<Entry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

/// Lists supported images in `target` (a folder, or the folder containing
/// a file), in natural, case-insensitive order — as Explorer sorts them.
pub fn list(target: &Path) -> std::io::Result<Listing> {
    let dir = if target.is_dir() { target.to_path_buf() } else { target.parent().unwrap_or(target).to_path_buf() };
    let mut entries: Vec<Entry> = std::fs::read_dir(&dir)?
        .filter_map(|e| {
            let e = e.ok()?;
            let path = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with("._") || !format::is_supported(&path) {
                return None;
            }
            let md = e.metadata().ok().filter(|m| m.is_file())?;
            let modified = md.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(Entry { path, name, size: md.len(), modified })
        })
        .collect();
    entries.sort_by(|a, b| natord::compare_ignore_case(&a.name, &b.name));
    Ok(Listing { dir, entries })
}
