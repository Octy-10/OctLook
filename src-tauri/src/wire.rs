//! Binary IPC frame shared by `decode_image` and `thumbnail`:
//!
//! ```text
//! [ payload bytes ][ header JSON (UTF-8) ][ header length: u32 LE ]
//! ```
//!
//! The header trails the payload so large pixel buffers are moved into the
//! response instead of being copied behind a prefix.

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
