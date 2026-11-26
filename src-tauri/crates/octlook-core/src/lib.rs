//! Decoding services shared by the OctLook viewer and its Explorer
//! thumbnail handler. No UI, IPC or OS-shell concerns live here.

pub mod decode;
mod error;
pub mod font;
pub mod format;
pub mod meta;
pub mod text;
pub mod thumbnail;

pub use error::{Error, Result};
