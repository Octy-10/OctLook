//! Binary IPC frame shared by `decode_image` and `thumbnail`:
//!
//! ```text
//! [ payload bytes ][ header JSON (UTF-8) ][ header length: u32 LE ]
//! ```
//!
//! The header trails the payload so large pixel buffers are moved into the
//! response instead of being copied behind a prefix.

use std::path::Path;

use serde::Serialize;

use octlook_core::decode::{Decoded, Meta, Payload};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Header<'a> {
    kind: &'static str,
    mime: Option<&'static str>,
    width: Option<u32>,
    height: Option<u32>,
    #[serde(flatten)]
    meta: &'a Meta,
}

pub fn encode(decoded: Decoded) -> Vec<u8> {
    let Decoded { payload, meta } = decoded;
    let (kind, mime, size, body) = match payload {
        Payload::Native => ("native", None, None, Vec::new()),
        Payload::Pdf(bytes) => ("pdf", Some("application/pdf"), None, bytes),
        Payload::Encoded { bytes, mime } => ("encoded", Some(mime), None, bytes),
        Payload::Pixels(px) => ("pixels", None, Some(px.dimensions()), px.into_raw()),
    };
    let header = Header { kind, mime, width: size.map(|s| s.0), height: size.map(|s| s.1), meta: &meta };
    let json = serde_json::to_vec(&header).expect("header is always serialisable");
    let mut frame = body;
    frame.reserve_exact(json.len() + 4);
    frame.extend_from_slice(&json);
    frame.extend_from_slice(&(json.len() as u32).to_le_bytes());
    frame
}

/// Splits an upload body, `[payload][UTF-8 path][path length: u32 LE]`, the
/// same trailer layout in the other direction (see `api.writeFile`).
pub fn split_path(body: &[u8]) -> Option<(&[u8], &Path)> {
    let (rest, length) = body.split_last_chunk::<4>()?;
    let (payload, path) = rest.split_at_checked(rest.len().checked_sub(u32::from_le_bytes(*length) as usize)?)?;
    Some((payload, Path::new(std::str::from_utf8(path).ok()?)))
}

/// Splits `[payload][u32 LE]` into the payload and the trailing number.
pub fn split_u32(body: &[u8]) -> Option<(&[u8], u32)> {
    let (payload, value) = body.split_last_chunk::<4>()?;
    Some((payload, u32::from_le_bytes(*value)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(payload: &[u8], path: &str) -> Vec<u8> {
        [payload, path.as_bytes(), &(path.len() as u32).to_le_bytes()].concat()
    }

    #[test]
    fn splits_payload_and_path() {
        let body = body(b"\x89PNG", "D:\\图\\a.png");
        assert_eq!(split_path(&body), Some((&b"\x89PNG"[..], Path::new("D:\\图\\a.png"))));
    }

    #[test]
    fn rejects_malformed_bodies() {
        assert_eq!(split_path(b"ab"), None);
        assert_eq!(split_path(&[1, 2, 99, 0, 0, 0]), None); // length past the start
        assert_eq!(split_path(&[0xff, 1, 0, 0, 0]), None); // path is not UTF-8
    }
}
