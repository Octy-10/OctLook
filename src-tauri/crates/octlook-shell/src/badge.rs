//! Format badge in the thumbnail's bottom-right corner, so a PSD can be
//! told apart from a flattened PNG at a glance. Plain text labels in each
//! app's own colours (Ps blue on navy, Ai orange on brown…) so they read like
//! the app icons users know; vendor logos are trademarks and never embedded.
//! Skipped where Explorer stamps the default app's icon there (see `overlay`).

use image::{Rgba, RgbaImage};
use octlook_core::format::{self, Format};
use windows::{
    core::w,
    Win32::{
        Foundation::{COLORREF, SIZE},
        Graphics::Gdi::{
            CreateCompatibleDC, CreateFontW, DeleteDC, DeleteObject, GdiFlush, GetTextExtentPoint32W, SelectObject,
            SetBkMode, SetTextColor, TextOutW, ANTIALIASED_QUALITY, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH,
            FF_SWISS, FW_BOLD, OUT_DEFAULT_PRECIS, TRANSPARENT,
        },
    },
};

use crate::bitmap;

/// Below this badge height (px) the label is unreadable: draw nothing.
const MIN_HEIGHT: f32 = 12.0;
const OPACITY: f32 = 0.94;

pub fn apply(img: &mut RgbaImage, ext: &str) {
    let (w, h) = (img.width() as f32, img.height() as f32);
    let height = (w.max(h) * 0.15).min(w.min(h) * 0.32).round();
    if height < MIN_HEIGHT {
        return;
    }
    let label = ext.to_ascii_uppercase();
    let pad = (height * 0.36).round();
    let max_text = w * 0.7 - 2.0 * pad;
    let em = height * 0.72;
    let Some(mut text) = text_mask(&label, em) else { return };
    if text.width as f32 > max_text {
        // Long labels (AFDESIGN, PROCREATE…) shrink rather than overflow.
        match text_mask(&label, em * max_text / text.width as f32) {
            Some(t) if t.width as f32 <= max_text && t.height as f32 >= height * 0.3 => text = t,
            _ => return,
        }
    }

    let width = text.width as f32 + 2.0 * pad;
    let margin = (height * 0.28).max(2.0).round();
    let (x0, y0) = (w - margin - width, h - margin - height);
    let rect = RoundRect { x0, y0, x1: x0 + width, y1: y0 + height, radius: height * 0.3 };
    let (background, ink) = palette(ext);
    for py in y0.floor().max(0.0) as u32..(rect.y1.ceil() as u32).min(img.height()) {
        for px in x0.floor().max(0.0) as u32..(rect.x1.ceil() as u32).min(img.width()) {
            blend(img.get_pixel_mut(px, py), background, rect.coverage(px as f32 + 0.5, py as f32 + 0.5) * OPACITY);
        }
    }

    let tx = (x0 + (width - text.width as f32) / 2.0).round() as i64;
    let ty = (y0 + (height - text.height as f32) / 2.0).round() as i64;
    for (i, &m) in text.coverage.iter().enumerate() {
        let (px, py) = (tx + (i as u32 % text.width) as i64, ty + (i as u32 / text.width) as i64);
        if m > 0 && px >= 0 && py >= 0 && (px as u32) < img.width() && (py as u32) < img.height() {
            blend(img.get_pixel_mut(px as u32, py as u32), ink, m as f32 / 255.0);
        }
    }
}

const WHITE: [u8; 3] = [0xFF; 3];

/// (background, label) colours, taken from each app's own icon.
fn palette(ext: &str) -> ([u8; 3], [u8; 3]) {
    match format::from_extension(ext, b"") {
        Some(Format::Psd) => ([0x00, 0x1E, 0x36], [0x31, 0xA8, 0xFF]),
        Some(Format::Ai { .. } | Format::Eps) => ([0x33, 0x00, 0x00], [0xFF, 0x9A, 0x00]),
        Some(Format::Indd) => ([0x49, 0x02, 0x1F], [0xFF, 0x33, 0x66]),
        Some(Format::ZipPreview("Adobe XD")) => ([0x47, 0x01, 0x37], [0xFF, 0x61, 0xF6]),
        Some(Format::Cdr) => ([0x1E, 0x8E, 0x3E], WHITE),
        Some(Format::ZipPreview("Sketch")) => ([0xFD, 0xB3, 0x00], [0x1A, 0x1A, 0x1A]),
        Some(Format::ZipPreview("Figma")) => ([0x1E, 0x1E, 0x1E], WHITE),
        Some(Format::ZipPreview("Procreate")) => ([0x14, 0x14, 0x14], WHITE),
        Some(Format::ZipPreview("Krita")) => ([0x26, 0x7E, 0xD2], WHITE),
        // One extension per Affinity app, each with its own colour.
        Some(Format::Affinity) => match ext.to_ascii_lowercase().as_str() {
            "afphoto" => ([0x7B, 0x3F, 0xD6], WHITE),
            "afpub" => ([0xC9, 0x28, 0x4D], WHITE),
            _ => ([0x1B, 0x72, 0xBE], WHITE),
        },
        Some(Format::Svg) => ([0xFF, 0xB1, 0x3B], [0x1A, 0x1A, 0x1A]),
        _ => ([0x50, 0x50, 0x58], WHITE),
    }
}

struct RoundRect {
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    radius: f32,
}

impl RoundRect {
    /// Anti-aliased coverage of the pixel centred at (x, y), from the signed
    /// distance to the rounded rectangle.
    fn coverage(&self, x: f32, y: f32) -> f32 {
        let (hw, hh) = ((self.x1 - self.x0) / 2.0, (self.y1 - self.y0) / 2.0);
        let qx = (x - (self.x0 + hw)).abs() - (hw - self.radius);
        let qy = (y - (self.y0 + hh)).abs() - (hh - self.radius);
        let outside = qx.max(0.0).hypot(qy.max(0.0));
        let distance = outside + qx.max(qy).min(0.0) - self.radius;
        (0.5 - distance).clamp(0.0, 1.0)
    }
}

/// Straight-alpha "source over".
fn blend(dst: &mut Rgba<u8>, rgb: [u8; 3], alpha: f32) {
    if alpha <= 0.0 {
        return;
    }
    let below = dst[3] as f32 / 255.0 * (1.0 - alpha);
    let out = alpha + below;
    for c in 0..3 {
        dst[c] = ((rgb[c] as f32 * alpha + dst[c] as f32 * below) / out).round() as u8;
    }
    dst[3] = (out * 255.0).round() as u8;
}

/// Glyph coverage (0–255), trimmed to the ink's bounding box so caps-only
/// labels centre optically regardless of the font's ascent and descent.
struct TextMask {
    width: u32,
    height: u32,
    coverage: Vec<u8>,
}

fn text_mask(label: &str, em: f32) -> Option<TextMask> {
    let wide: Vec<u16> = label.encode_utf16().collect();
    // SAFETY: every GDI object created here is selected out and deleted
    // before returning; the DIB memory is read only while the bitmap lives.
    unsafe {
        let dc = CreateCompatibleDC(None);
        if dc.is_invalid() {
            return None;
        }
        let font = CreateFontW(
            -(em.round() as i32),
            0,
            0,
            0,
            FW_BOLD.0 as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            ANTIALIASED_QUALITY,
            (DEFAULT_PITCH.0 | FF_SWISS.0) as u32,
            w!("Segoe UI"),
        );
        let previous_font = SelectObject(dc, font.into());
        let mask = (|| {
            let mut size = SIZE::default();
            GetTextExtentPoint32W(dc, &wide, &mut size).ok().ok()?;
            let (w, h) = (u32::try_from(size.cx).ok()?, u32::try_from(size.cy).ok()?);
            let (dib, bits) = bitmap::dib(w, h).ok()?;
            let previous_bitmap = SelectObject(dc, dib.into());
            SetTextColor(dc, COLORREF(0x00FF_FFFF));
            SetBkMode(dc, TRANSPARENT);
            let drawn = TextOutW(dc, 0, 0, &wide).as_bool();
            let _ = GdiFlush();
            let green: Vec<u8> = std::slice::from_raw_parts(bits, (w * h * 4) as usize).chunks_exact(4).map(|p| p[1]).collect();
            SelectObject(dc, previous_bitmap);
            let _ = DeleteObject(dib.into());
            drawn.then(|| trim(&green, w, h)).flatten()
        })();
        SelectObject(dc, previous_font);
        let _ = DeleteObject(font.into());
        let _ = DeleteDC(dc);
        mask
    }
}

fn trim(coverage: &[u8], w: u32, h: u32) -> Option<TextMask> {
    let inked = |x: u32, y: u32| coverage[(y * w + x) as usize] > 0;
    let rows: Vec<u32> = (0..h).filter(|&y| (0..w).any(|x| inked(x, y))).collect();
    let cols: Vec<u32> = (0..w).filter(|&x| (0..h).any(|y| inked(x, y))).collect();
    let (&top, &bottom, &left, &right) = (rows.first()?, rows.last()?, cols.first()?, cols.last()?);
    let (width, height) = (right - left + 1, bottom - top + 1);
    let coverage = (top..=bottom)
        .flat_map(|y| (left..=right).map(move |x| coverage[(y * w + x) as usize]))
        .collect();
    Some(TextMask { width, height, coverage })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_draws_in_bottom_right_only() {
        let mut img = RgbaImage::from_pixel(256, 256, Rgba([0, 0, 0, 0]));
        apply(&mut img, "psd");
        assert_eq!(img.get_pixel(10, 10)[3], 0, "top-left untouched");
        assert!((200..250).any(|x| img.get_pixel(x, 240)[3] > 200), "badge painted bottom-right");
        // Photoshop's label blue (#31A8FF) on its navy (#001E36).
        assert!((200..250).flat_map(|x| (215..250).map(move |y| (x, y))).any(|(x, y)| img.get_pixel(x, y)[2] > 200), "blue label ink");
    }

    #[test]
    fn tiny_thumbnails_get_no_badge() {
        let mut img = RgbaImage::from_pixel(48, 20, Rgba([9, 9, 9, 255]));
        apply(&mut img, "psd");
        assert!(img.pixels().all(|p| p.0 == [9, 9, 9, 255]));
    }
}
