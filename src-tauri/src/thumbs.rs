//! Thumbnail service: decode → orient → Lanczos downscale → PNG, memoised
//! per (path, mtime, size) and throttled to the number of CPU cores.

use std::{
    num::NonZeroUsize,
    path::{Path, PathBuf},
    sync::Arc,
    time::SystemTime,
};

use image::{codecs::png, ImageEncoder};
use lru::LruCache;
use octlook_core::{
    decode::{self, Decoded, Payload, Purpose},
    thumbnail,
};
use parking_lot::Mutex;
use tokio::sync::Semaphore;

use crate::{error::Result, wire};

type Key = (PathBuf, SystemTime, u32);

pub struct Thumbnailer {
    cache: Mutex<LruCache<Key, Arc<Vec<u8>>>>,
    pub permits: Semaphore,
}

impl Thumbnailer {
    pub fn new() -> Self {
        let cores = std::thread::available_parallelism().map_or(4, NonZeroUsize::get);
        Self { cache: Mutex::new(LruCache::new(NonZeroUsize::new(1024).unwrap())), permits: Semaphore::new(cores) }
    }

    /// Returns a `wire` frame: an `encoded` PNG, or `native`/`pdf` when the
    /// WebView must rasterise the thumbnail itself.
    pub fn render(&self, path: &Path, size: u32) -> Result<Arc<Vec<u8>>> {
        let key = (path.to_path_buf(), std::fs::metadata(path)?.modified()?, size);
        if let Some(hit) = self.cache.lock().get(&key) {
            return Ok(hit.clone());
        }
        let frame = Arc::new(wire::encode(shrink(decode::decode(path, Purpose::Thumbnail)?, size)?));
        self.cache.lock().put(key, frame.clone());
        Ok(frame)
    }
}

fn shrink(decoded: Decoded, size: u32) -> Result<Decoded> {
    let Decoded { payload, mut meta } = decoded;
    if matches!(payload, Payload::Native | Payload::Pdf(_)) {
        return Ok(Decoded { payload, meta });
    }
    let small = thumbnail::fit(payload, meta.orientation, size)?;
    meta.orientation = 1;
    let mut bytes = Vec::new();
    png::PngEncoder::new_with_quality(&mut bytes, png::CompressionType::Fast, png::FilterType::Adaptive)
        .write_image(small.as_raw(), small.width(), small.height(), image::ExtendedColorType::Rgba8)
        .map_err(octlook_core::Error::from)?;
    Ok(Decoded { payload: Payload::Encoded { bytes, mime: "image/png" }, meta })
}
