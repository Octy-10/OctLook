//! Tells whether a PDF-compatible AI file's pages actually draw anything.
//!
//! Illustrator may store only an empty artboard in the PDF part while the
//! artwork lives in its private data (and in the XMP preview). Rendering that
//! PDF shows a blank page, so the viewer falls back to the preview instead.
//!
//! This is a probe, not a PDF parser: it answers `true` only when every page
//! was found and its content streams provably contain no painting operator.
//! Anything it cannot read (object streams, unknown filters…) counts as
//! artwork, keeping the full-quality PDF path.

use std::io::Read;

/// Operators that put marks on the page: path painting, shadings,
/// XObjects (images, forms), text showing and inline images.
const PAINTING: &[&[u8]] = &[
    b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*", b"S", b"s", b"sh", b"Do", b"Tj", b"TJ", b"'", b"\"", b"BI",
];

pub fn is_blank(pdf: &[u8]) -> bool {
    let mut pages = 0;
    for body in objects(pdf) {
        let Some(dict) = page_dict(body) else { continue };
        pages += 1;
        let refs = contents(dict);
        if refs.is_empty() || !refs.iter().all(|&id| stream_of(pdf, id).is_some_and(|ops| !paints(&ops))) {
            return false;
        }
    }
    pages > 0
}

/// Bodies of every `N 0 obj … endobj` in file order.
fn objects(pdf: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut rest = pdf;
    std::iter::from_fn(move || {
        let start = find(rest, b" 0 obj")? + 6;
        let len = find(&rest[start..], b"endobj")?;
        let body = &rest[start..start + len];
        rest = &rest[start + len..];
        Some(body)
    })
}

/// The dictionary of a `/Type /Page` object (never `/Pages`).
fn page_dict(body: &[u8]) -> Option<&[u8]> {
    let dict = match find(body, b"stream") {
        Some(end) => &body[..end],
        None => body,
    };
    let at = find(dict, b"/Type")? + 5;
    let value = trim_start(&dict[at..]);
    (value.starts_with(b"/Page") && !value[5..].first().is_some_and(u8::is_ascii_alphanumeric)).then_some(dict)
}

/// Object numbers in `/Contents N 0 R` or `/Contents [N 0 R …]`.
fn contents(dict: &[u8]) -> Vec<u32> {
    let Some(at) = find(dict, b"/Contents") else { return Vec::new() };
    let value = trim_start(&dict[at + 9..]);
    let span = if value.starts_with(b"[") {
        find(value, b"]").map_or(value, |end| &value[1..end])
    } else {
        find(value, b"R").map_or(value, |end| &value[..end])
    };
    let numbers: Vec<u32> = span
        .split(|b| !b.is_ascii_digit())
        .filter(|t| !t.is_empty())
        .filter_map(|t| std::str::from_utf8(t).ok()?.parse().ok())
        .collect();
    // Triplets of "N G R": keep the object numbers.
    numbers.chunks(2).map(|pair| pair[0]).collect()
}

/// The decoded content stream of object `id`, if it is plain or FlateDecode.
fn stream_of(pdf: &[u8], id: u32) -> Option<Vec<u8>> {
    let header = format!("{id} 0 obj");
    let mut at = 0;
    let start = loop {
        let hit = at + find(&pdf[at..], header.as_bytes())?;
        // Reject "12 0 obj" when looking for "2 0 obj".
        if hit == 0 || !pdf[hit - 1].is_ascii_digit() {
            break hit + header.len();
        }
        at = hit + 1;
    };
    let body = &pdf[start..start + find(&pdf[start..], b"endobj")?];
    let dict_end = find(body, b"stream")?;
    let dict = &body[..dict_end];
    let mut data = &body[dict_end + 6..];
    data = data.strip_prefix(b"\r\n").or_else(|| data.strip_prefix(b"\n")).or_else(|| data.strip_prefix(b"\r"))?;
    data = &data[..find(data, b"endstream")?];

    if find(dict, b"/Filter").is_none() {
        return Some(data.to_vec());
    }
    // Only a lone FlateDecode without predictors is understood: one "Decode"
    // in the whole dictionary. Filter chains and /DecodeParms are "unknown".
    if dict.windows(6).filter(|w| *w == b"Decode").count() != 1 || find(dict, b"/FlateDecode").is_none() {
        return None;
    }
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(data).read_to_end(&mut out).ok()?;
    Some(out)
}

/// True when any token outside strings is a painting operator.
fn paints(ops: &[u8]) -> bool {
    let mut depth = 0u32; // inside a (string)
    let mut token = Vec::new();
    let mut escaped = false;
    for &b in ops.iter().chain(b" ") {
        if depth > 0 {
            match b {
                _ if escaped => escaped = false,
                b'\\' => escaped = true,
                b'(' => depth += 1,
                b')' => depth -= 1,
                _ => {}
            }
            continue;
        }
        if b.is_ascii_whitespace() || b"()<>[]{}/%".contains(&b) {
            if PAINTING.contains(&token.as_slice()) {
                return true;
            }
            token.clear();
            if b == b'(' {
                depth = 1;
            }
            continue;
        }
        token.push(b);
    }
    false
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn trim_start(s: &[u8]) -> &[u8] {
    let n = s.iter().take_while(|b| b.is_ascii_whitespace()).count();
    &s[n..]
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::{write::ZlibEncoder, Compression};

    use super::*;

    fn pdf(content: &[u8]) -> Vec<u8> {
        let mut z = ZlibEncoder::new(Vec::new(), Compression::default());
        z.write_all(content).unwrap();
        let stream = z.finish().unwrap();
        let mut doc = b"%PDF-1.6\n3 0 obj\n<</Type/Pages/Kids[5 0 R]/Count 1>>\nendobj\n5 0 obj\n<</Contents 36 0 R/MediaBox[0 0 80 80]/Type/Page>>\nendobj\n36 0 obj\n<</Filter/FlateDecode/Length 9>>stream\r\n".to_vec();
        doc.extend_from_slice(&stream);
        doc.extend_from_slice(b"\r\nendstream\rendobj\n%%EOF");
        doc
    }

    #[test]
    fn empty_layer_is_blank() {
        assert!(is_blank(&pdf(b"/OC /MC0 BDC \nEMC\n")));
    }

    #[test]
    fn any_mark_is_artwork() {
        assert!(!is_blank(&pdf(b"0 0 m 10 10 l S")));
        assert!(!is_blank(&pdf(b"q /Im0 Do Q")));
        assert!(!is_blank(&pdf(b"BT /F1 12 Tf (Hi) Tj ET")));
        assert!(!is_blank(&pdf(b"0 0 10 10 re f*")));
    }

    #[test]
    fn operator_letters_inside_strings_are_not_marks() {
        // "(S f Do)" is shown with no showing operator: only BT/ET and a string.
        assert!(is_blank(&pdf(b"BT (S f Do) ET")));
    }

    #[test]
    fn unreadable_documents_keep_the_pdf_path() {
        assert!(!is_blank(b"%PDF-1.6\n%%EOF"));
        assert!(!is_blank(b"%PDF-1.6\n5 0 obj\n<</Type/Page/Contents 9 0 R>>\nendobj\n"));
    }
}
