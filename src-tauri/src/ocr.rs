//! Text recognition service: the engine loads on first use and stays resident.

use std::path::PathBuf;

use octlook_ocr::{Engine, Image};
use parking_lot::Mutex;

use crate::error::Result;

pub struct Ocr {
    /// Holds `det.onnx`, `rec.onnx` and `dict.txt` (bundled resources).
    models: PathBuf,
    engine: Mutex<Option<Engine>>,
}

impl Ocr {
    pub fn new(models: PathBuf) -> Self {
        Self { models, engine: Mutex::new(None) }
    }

    /// Text in straight RGBA pixels `width` wide, in reading order.
    pub fn text(&self, rgba: &[u8], width: usize) -> Result<String> {
        let height = rgba.len() / 4 / width.max(1);
        let image = Image::new(rgba, width, height)?;
        let mut engine = self.engine.lock();
        let engine = match &mut *engine {
            Some(engine) => engine,
            empty => empty.insert(Engine::load(&self.models)?),
        };
        Ok(engine.text(image)?)
    }
}
