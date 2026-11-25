//! CTC recognition of detected lines, batched by aspect ratio.

use ort::{inputs, session::Session, value::Tensor};

use crate::{geometry::Quad, Image, Line, Result};

const HEIGHT: usize = 48;
/// Batches are at least this wide (the model's training width) and at most the widest it accepts.
const MIN_WIDTH: usize = 320;
const MAX_WIDTH: usize = 3200;
const BATCH: usize = 6;
/// Boxes this much taller than wide hold vertical text and are read top to bottom.
pub(crate) const VERTICAL: f32 = 1.5;
/// Lines recognised with less mean confidence are noise, not text.
const MIN_SCORE: f32 = 0.5;
/// Samples per output pixel along each axis are capped here when shrinking a large line.
const MAX_SUPERSAMPLE: usize = 4;

pub fn recognize(session: &mut Session, charset: &[String], image: Image, quads: Vec<Quad>) -> Result<Vec<Line>> {
    let reading: Vec<Quad> = quads.iter().map(|q| if q.height >= q.width * VERTICAL { q.turned() } else { *q }).collect();
    let ratio = |i: usize| reading[i].width / reading[i].height;
    let mut order: Vec<usize> = (0..quads.len()).collect();
    order.sort_by(|&a, &b| ratio(a).total_cmp(&ratio(b)));

    let mut lines = Vec::with_capacity(quads.len());
    for batch in order.chunks(BATCH) {
        let widest = batch.iter().map(|&i| ratio(i)).fold(MIN_WIDTH as f32 / HEIGHT as f32, f32::max);
        let width = ((HEIGHT as f32 * widest).ceil() as usize).min(MAX_WIDTH);
        let plane = HEIGHT * width;
        // Zero is mid-grey after normalisation: the padding right of shorter lines.
        let mut input = vec![0f32; batch.len() * 3 * plane];
        for (n, &i) in batch.iter().enumerate() {
            crop(image, &reading[i], width, &mut input[n * 3 * plane..(n + 1) * 3 * plane]);
        }
        let outputs = session.run(inputs![Tensor::from_array(([batch.len(), 3, HEIGHT, width], input))?])?;
        let (shape, probs) = outputs[0].try_extract_tensor::<f32>()?;
        let (steps, classes) = (shape[1] as usize, shape[2] as usize);
        for (n, &i) in batch.iter().enumerate() {
            let (text, score) = decode(&probs[n * steps * classes..(n + 1) * steps * classes], classes, charset);
            let text = text.trim();
            if !text.is_empty() && score >= MIN_SCORE {
                lines.push(Line { text: text.to_owned(), score, quad: quads[i] });
            }
        }
    }
    Ok(lines)
}

/// Samples `quad` upright into the left of a CHW, BGR, [-1, 1] buffer `width` wide.
fn crop(image: Image, quad: &Quad, width: usize, out: &mut [f32]) {
    let plane = HEIGHT * width;
    let target = ((HEIGHT as f32 * quad.width / quad.height).ceil() as usize).clamp(1, width);
    // Box-filter large lines down instead of point-sampling them, which would drop thin strokes.
    let k = ((quad.height / HEIGHT as f32).ceil() as usize).clamp(1, MAX_SUPERSAMPLE);
    let weight = 1.0 / (k * k) as f32;
    for y in 0..HEIGHT {
        for x in 0..target {
            let mut bgr = [0f32; 3];
            for sy in 0..k {
                for sx in 0..k {
                    let u = (x as f32 + (sx as f32 + 0.5) / k as f32) / target as f32;
                    let v = (y as f32 + (sy as f32 + 0.5) / k as f32) / HEIGHT as f32;
                    let (px, py) = quad.at(u, v);
                    for (c, rgb) in [2, 1, 0].into_iter().enumerate() {
                        bgr[c] += image.sample(px, py, rgb) * weight;
                    }
                }
            }
            for (c, value) in bgr.into_iter().enumerate() {
                out[c * plane + y * width + x] = value / 127.5 - 1.0;
            }
        }
    }
}

/// Greedy CTC decoding: best class per step, repeats merged, blanks dropped.
fn decode(probs: &[f32], classes: usize, charset: &[String]) -> (String, f32) {
    let (mut text, mut total, mut count, mut previous) = (String::new(), 0f32, 0usize, 0usize);
    for step in probs.chunks_exact(classes) {
        let (best, p) = step.iter().copied().enumerate().fold((0, f32::MIN), |a, b| if b.1 > a.1 { b } else { a });
        if best != 0 && best != previous {
            if let Some(c) = charset.get(best) {
                text.push_str(c);
                total += p;
                count += 1;
            }
        }
        previous = best;
    }
    (text, if count == 0 { 0.0 } else { total / count as f32 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ctc_merges_repeats_and_drops_blanks() {
        let charset: Vec<String> = ["", "a", "b", " "].map(str::to_owned).to_vec();
        // a a _ a b _ → "aab"
        let steps = [[0.1, 0.9, 0.0, 0.0], [0.1, 0.8, 0.1, 0.0], [0.9, 0.1, 0.0, 0.0], [0.2, 0.7, 0.1, 0.0], [0.0, 0.0, 1.0, 0.0], [1.0, 0.0, 0.0, 0.0]];
        let (text, score) = decode(&steps.concat(), 4, &charset);
        assert_eq!(text, "aab");
        assert!((score - (0.9 + 0.7 + 1.0) / 3.0).abs() < 1e-6);
    }
}
