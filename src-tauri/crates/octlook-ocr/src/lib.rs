//! Offline text recognition with PaddleOCR's PP-OCRv5 mobile models
//! (Apache-2.0) on ONNX Runtime: DB text detection, then CTC recognition of
//! every detected line, then reading-order layout.

mod det;
mod geometry;
mod layout;
mod rec;

use std::path::Path;

use ort::session::{builder::GraphOptimizationLevel, Session};

pub use geometry::Quad;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("OCR 引擎错误：{0}")]
    Runtime(#[from] ort::Error),
    #[error("无法读取 OCR 模型：{0}")]
    Io(#[from] std::io::Error),
    #[error("图像数据无效")]
    BadImage,
}

pub type Result<T> = std::result::Result<T, Error>;

/// Straight RGBA pixels, row-major without padding.
#[derive(Clone, Copy)]
pub struct Image<'a> {
    pub rgba: &'a [u8],
    pub width: usize,
    pub height: usize,
}

impl<'a> Image<'a> {
    pub fn new(rgba: &'a [u8], width: usize, height: usize) -> Result<Self> {
        if width == 0 || height == 0 || rgba.len() != width * height * 4 {
            return Err(Error::BadImage);
        }
        Ok(Self { rgba, width, height })
    }

    /// Bilinearly sampled channel `c` at continuous pixel coordinates (pixel centres at .5).
    fn sample(&self, x: f32, y: f32, c: usize) -> f32 {
        let (x, y) = ((x - 0.5).clamp(0.0, (self.width - 1) as f32), (y - 0.5).clamp(0.0, (self.height - 1) as f32));
        let (x0, y0) = (x as usize, y as usize);
        let (x1, y1) = ((x0 + 1).min(self.width - 1), (y0 + 1).min(self.height - 1));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let at = |x: usize, y: usize| self.rgba[(y * self.width + x) * 4 + c] as f32;
        let top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
        let bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
        top + (bottom - top) * fy
    }
}

/// One recognised line of text and where it is in the image.
#[derive(Debug, Clone)]
pub struct Line {
    pub text: String,
    pub score: f32,
    pub quad: Quad,
}

pub struct Engine {
    det: Session,
    rec: Session,
    /// CTC classes: index 0 is the blank, the last one a space.
    charset: Vec<String>,
}

impl Engine {
    /// Loads `det.onnx`, `rec.onnx` and `dict.txt` from `dir`.
    pub fn load(dir: &Path) -> Result<Self> {
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(8);
        let session = |file: &str| -> Result<Session> {
            Ok(Session::builder()?
                .with_optimization_level(GraphOptimizationLevel::Level3)?
                .with_intra_threads(threads)?
                .commit_from_file(dir.join(file))?)
        };
        let dict = std::fs::read_to_string(dir.join("dict.txt"))?;
        let charset = std::iter::once(String::new())
            .chain(dict.lines().map(str::to_owned))
            .chain(std::iter::once(" ".to_owned()))
            .collect();
        Ok(Self { det: session("det.onnx")?, rec: session("rec.onnx")?, charset })
    }

    /// Every line of text in `image`, in reading order.
    pub fn recognize(&mut self, image: Image) -> Result<Vec<Line>> {
        let quads = det::detect(&mut self.det, image)?;
        let lines = rec::recognize(&mut self.rec, &self.charset, image, quads)?;
        Ok(layout::reading_order(lines))
    }

    /// The text of `image` as plain text: one row per line, in reading order.
    pub fn text(&mut self, image: Image) -> Result<String> {
        Ok(layout::to_text(&self.recognize(image)?))
    }
}
