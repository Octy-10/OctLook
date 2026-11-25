//! DB text detection: a per-pixel text probability map, split into connected
//! regions, each boxed by its minimum-area rectangle and grown back out.

use ort::{inputs, session::Session, value::Tensor};

use crate::{
    geometry::{min_area_rect, Point, Quad},
    Image, Result,
};

/// The network sees the image at its own resolution, within these bounds (PP-OCRv5 defaults).
const MIN_SIDE: f32 = 64.0;
const MAX_SIDE: f32 = 4000.0;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];
/// Probability above which a pixel counts as text.
const THRESH: f32 = 0.3;
/// Mean probability a region needs to be kept.
const BOX_THRESH: f32 = 0.6;
const UNCLIP_RATIO: f32 = 1.5;
const MIN_SIZE: f32 = 3.0;
const MAX_CANDIDATES: usize = 1000;

/// Multiple of 32 nearest to `v`, at least 32: the network downsamples five times.
fn stride32(v: f32) -> usize {
    ((v / 32.0).round() as usize).max(1) * 32
}

pub fn detect(session: &mut Session, image: Image) -> Result<Vec<Quad>> {
    let (w, h) = (image.width as f32, image.height as f32);
    let mut scale = (MIN_SIDE / w.min(h)).max(1.0);
    scale = scale.min(MAX_SIDE / w.max(h));
    let (dw, dh) = (stride32(w * scale), stride32(h * scale));
    let (sx, sy) = (w / dw as f32, h / dh as f32);

    // NCHW, BGR (the channel order the model was trained on), ImageNet-normalised.
    let plane = dw * dh;
    let mut input = vec![0f32; 3 * plane];
    for y in 0..dh {
        for x in 0..dw {
            let (fx, fy) = ((x as f32 + 0.5) * sx, (y as f32 + 0.5) * sy);
            for (c, rgb) in [2, 1, 0].into_iter().enumerate() {
                input[c * plane + y * dw + x] = (image.sample(fx, fy, rgb) / 255.0 - MEAN[c]) / STD[c];
            }
        }
    }
    let outputs = session.run(inputs![Tensor::from_array(([1usize, 3, dh, dw], input))?])?;
    let (_, prob) = outputs[0].try_extract_tensor::<f32>()?;

    let quads = regions(prob, dw, dh)
        .into_iter()
        .filter_map(|region| {
            let quad = min_area_rect(region.outline)?;
            if quad.width.min(quad.height) < MIN_SIZE || region.score < BOX_THRESH {
                return None;
            }
            let quad = quad.unclipped(UNCLIP_RATIO);
            if quad.width.min(quad.height) < MIN_SIZE + 2.0 {
                return None;
            }
            // Back to image pixels; the two axes may be scaled slightly differently.
            min_area_rect(quad.corners().iter().map(|&(x, y)| (x * sx, y * sy)).collect())
        })
        .collect();
    Ok(quads)
}

struct Region {
    /// Left and right ends of every row of the region: enough for its convex hull.
    outline: Vec<Point>,
    /// Mean text probability over the region.
    score: f32,
}

/// 8-connected regions of above-threshold pixels.
fn regions(prob: &[f32], w: usize, h: usize) -> Vec<Region> {
    let mut seen = vec![false; w * h];
    let mut found = Vec::new();
    let mut stack = Vec::new();
    for start in 0..w * h {
        if seen[start] || prob[start] <= THRESH {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        // (min x, max x) of every row, from the first: scanning order makes `start` the topmost pixel.
        let top = start / w;
        let mut rows: Vec<(usize, usize)> = Vec::new();
        let (mut sum, mut count) = (0f32, 0usize);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            sum += prob[i];
            count += 1;
            if rows.len() <= y - top {
                rows.resize(y - top + 1, (usize::MAX, 0));
            }
            let row = &mut rows[y - top];
            *row = (row.0.min(x), row.1.max(x));
            for ny in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                for nx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                    let j = ny * w + nx;
                    if !seen[j] && prob[j] > THRESH {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        let outline = rows
            .iter()
            .enumerate()
            .flat_map(|(dy, &(x0, x1))| {
                let (y, x0, x1) = ((top + dy) as f32, x0 as f32, x1 as f32 + 1.0);
                [(x0, y), (x1, y), (x0, y + 1.0), (x1, y + 1.0)]
            })
            .collect();
        found.push(Region { outline, score: sum / count as f32 });
        if found.len() == MAX_CANDIDATES {
            break;
        }
    }
    found
}
