//! Text files for the text viewer: encoding detection (GBK and UTF-16 files
//! are common on Chinese Windows) and a size cap that keeps the UI fluid.

use std::{fs::File, io::Read, path::Path};

use chardetng::EncodingDetector;
use encoding_rs::Encoding;
use serde::Serialize;

use crate::{Error, Result};

/// Larger files are shown up to this many bytes.
const LIMIT: usize = 2 << 20;
/// NUL bytes this early mean a binary file, not text in an unusual encoding.
const SNIFF: usize = 8 << 10;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    pub encoding: &'static str,
    pub truncated: bool,
}

/// The first `limit` bytes (at most 2 MB) of a text file, decoded.
pub fn read(path: &Path, limit: Option<usize>) -> Result<TextFile> {
    let limit = limit.unwrap_or(LIMIT).min(LIMIT);
    let mut buf = Vec::new();
    File::open(path)?.take(limit as u64 + 1).read_to_end(&mut buf)?;
    let truncated = buf.len() > limit;
    buf.truncate(limit);
    decode(&buf, truncated)
}

fn decode(buf: &[u8], truncated: bool) -> Result<TextFile> {
    let (encoding, bom) = Encoding::for_bom(buf).unwrap_or_else(|| {
        let mut detector = EncodingDetector::new();
        detector.feed(buf, !truncated);
        (detector.guess(None, true), 0)
    });
    let utf16 = encoding == encoding_rs::UTF_16LE || encoding == encoding_rs::UTF_16BE;
    if !utf16 && memchr::memchr(0, &buf[..buf.len().min(SNIFF)]).is_some() {
        return Err(Error::Unsupported("这不是文本文件".into()));
    }
    let (text, _) = encoding.decode_without_bom_handling(&buf[bom..]);
    Ok(TextFile { text: text.into_owned(), encoding: encoding.name(), truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_utf8_gbk_and_utf16() {
        assert_eq!(decode("设计稿，一眼看透。".as_bytes(), false).unwrap().encoding, "UTF-8");

        let (gbk, _, _) = encoding_rs::GBK.encode("设计稿，一眼看透。这是一段较长的中文文本，用于编码识别。");
        let file = decode(&gbk, false).unwrap();
        assert_eq!(file.encoding, "GBK");
        assert!(file.text.starts_with("设计稿"));

        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("hi".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        let file = decode(&utf16, false).unwrap();
        assert_eq!((file.encoding, file.text.as_str()), ("UTF-16LE", "hi"));
    }

    #[test]
    fn rejects_binary() {
        assert!(decode(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR", false).is_err());
    }
}
