//! Font metadata for the font viewer. The glyphs themselves are drawn by the
//! WebView (`FontFace`); this only names what is being shown.

use std::path::Path;

use serde::Serialize;
use ttf_parser::{fonts_in_collection, name_id, Face, Language};

use crate::{Error, Result};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInfo {
    pub family: Option<String>,
    pub style: Option<String>,
    pub version: Option<String>,
    pub designer: Option<String>,
    pub glyphs: u16,
    /// Faces in a collection (TTC / OTC); 1 for single fonts. The first is described.
    pub faces: u32,
    /// Whether common CJK ideographs are covered.
    pub cjk: bool,
}

/// WOFF / WOFF2 are compressed containers `ttf-parser` cannot read; the
/// viewer still renders them, just without these details.
pub fn info(path: &Path) -> Result<FontInfo> {
    let data = std::fs::read(path)?;
    let face = Face::parse(&data, 0).map_err(|_| Error::Corrupt("无法读取字体信息"))?;
    let name = |ids: &[u16]| ids.iter().find_map(|&id| localized(&face, id));
    Ok(FontInfo {
        family: name(&[name_id::TYPOGRAPHIC_FAMILY, name_id::FAMILY]),
        style: name(&[name_id::TYPOGRAPHIC_SUBFAMILY, name_id::SUBFAMILY]),
        version: name(&[name_id::VERSION]),
        designer: name(&[name_id::DESIGNER, name_id::MANUFACTURER]),
        glyphs: face.number_of_glyphs(),
        faces: fonts_in_collection(&data).unwrap_or(1),
        cjk: "设计永字".chars().all(|c| face.glyph_index(c).is_some()),
    })
}

/// The Chinese name when the font has one, otherwise English, otherwise any.
fn localized(face: &Face, id: u16) -> Option<String> {
    let names: Vec<_> = face.names().into_iter().filter(|n| n.name_id == id && n.is_unicode()).collect();
    let pick = |lang: Language| names.iter().find(|n| n.language() == lang).and_then(|n| n.to_string());
    pick(Language::Chinese_PeoplesRepublicOfChina)
        .or_else(|| pick(Language::English_UnitedStates))
        .or_else(|| names.iter().find_map(|n| n.to_string()))
        .filter(|s| !s.trim().is_empty())
}
