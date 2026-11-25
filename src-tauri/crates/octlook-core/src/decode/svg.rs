//! SVG rasterisation with resvg, for Explorer thumbnails. The viewer itself
//! shows SVG through the WebView, which also runs CSS and animations.

use std::sync::{Arc, OnceLock};

use image::RgbaImage;
use resvg::{
    tiny_skia::{Pixmap, Transform},
    usvg::{fontdb, ImageHrefResolver, Options, Tree},
};

use crate::{Error, Result};

/// System fonts, scanned once per process and only for documents with text.
fn system_fonts() -> Arc<fontdb::Database> {
    static FONTS: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            Arc::new(db)
        })
        .clone()
}

/// Renders the document scaled to fit `size × size`. Vectors have no native
/// resolution, so small icons are enlarged rather than left tiny.
pub fn render(data: &[u8], size: u32) -> Result<RgbaImage> {
    let mut options = Options {
        // Thumbnails run inside Explorer: embedded `data:` images only, never files named by the document.
        image_href_resolver: ImageHrefResolver { resolve_string: Box::new(|_, _| None), ..Default::default() },
        ..Default::default()
    };
    if memchr::memmem::find(data, b"<text").is_some() {
        options.fontdb = system_fonts();
    }
    let tree = Tree::from_data(data, &options)?;

    let scale = size as f32 / tree.size().width().max(tree.size().height());
    let (w, h) = ((tree.size().width() * scale).round().max(1.0) as u32, (tree.size().height() * scale).round().max(1.0) as u32);
    let mut pixmap = Pixmap::new(w, h).ok_or(Error::Corrupt("SVG 尺寸无效"))?;
    resvg::render(&tree, Transform::from_scale(scale, scale), &mut pixmap.as_mut());

    let straight = pixmap.pixels().iter().flat_map(|p| {
        let c = p.demultiply();
        [c.red(), c.green(), c.blue(), c.alpha()]
    });
    Ok(RgbaImage::from_raw(w, h, straight.collect()).expect("buffer sized to pixmap"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ICON: &[u8] = br##"<?xml version="1.0"?>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><rect width="12" height="12" fill="#ff0000"/></svg>"##;

    #[test]
    fn fits_the_long_edge_and_keeps_transparency() {
        let img = render(ICON, 256).unwrap();
        assert_eq!(img.dimensions(), (256, 128));
        assert_eq!(img.get_pixel(10, 10).0, [255, 0, 0, 255]);
        assert_eq!(img.get_pixel(200, 10).0[3], 0);
    }

    #[test]
    fn rejects_non_svg_data() {
        assert!(render(b"not an svg", 64).is_err());
    }
}
