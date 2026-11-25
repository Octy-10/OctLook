//! `std::io` view of the `IStream` Explorer hands the handler.

use std::io::{self, Read, Seek, SeekFrom};

use windows::{
    core::Result,
    Win32::{
        Foundation::ERROR_BAD_FORMAT,
        System::Com::{CoTaskMemFree, IStream, STATFLAG_DEFAULT, STATSTG, STREAM_SEEK_CUR, STREAM_SEEK_END, STREAM_SEEK_SET},
    },
};

pub struct StreamReader(pub IStream);

impl Read for StreamReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut read = 0u32;
        let len = buf.len().min(u32::MAX as usize) as u32;
        // SAFETY: `buf` is valid for `len` bytes. S_FALSE (short read at the
        // end of the stream) counts as success.
        unsafe { self.0.Read(buf.as_mut_ptr().cast(), len, Some(&mut read)) }.ok().map_err(io::Error::other)?;
        Ok(read as usize)
    }
}

impl Seek for StreamReader {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let (offset, origin) = match pos {
            SeekFrom::Start(n) => (n as i64, STREAM_SEEK_SET),
            SeekFrom::Current(n) => (n, STREAM_SEEK_CUR),
            SeekFrom::End(n) => (n, STREAM_SEEK_END),
        };
        let mut at = 0u64;
        // SAFETY: `at` outlives the call.
        unsafe { self.0.Seek(offset, origin, Some(&mut at)) }.map_err(io::Error::other)?;
        Ok(at)
    }
}

/// File extension from the stream's name (Explorer's file streams carry it).
pub fn extension(stream: &IStream) -> Result<String> {
    let mut stat = STATSTG::default();
    // SAFETY: `stat` is a valid out-parameter; COM allocates `pwcsName`,
    // which is freed exactly once here.
    let name = unsafe {
        stream.Stat(&mut stat, STATFLAG_DEFAULT)?;
        let name = if stat.pwcsName.is_null() { String::new() } else { stat.pwcsName.to_string().unwrap_or_default() };
        CoTaskMemFree(Some(stat.pwcsName.0 as _));
        name
    };
    name.rsplit_once('.').map(|(_, ext)| ext.to_owned()).ok_or_else(|| ERROR_BAD_FORMAT.to_hresult().into())
}
