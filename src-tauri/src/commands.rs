//! IPC controllers: argument plumbing only; work happens in the services.

use std::{path::PathBuf, sync::Arc};

use parking_lot::Mutex;

use octlook_core::{
    decode::{self, Purpose},
    format, meta,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    State,
};

use crate::{
    error::{AppError, Result},
    folder,
    ocr::Ocr,
    thumbs::Thumbnailer,
    wire,
};

/// File the app was asked to open and the page has not picked up yet: from
/// the command line ("Open with…" on Windows) or, on macOS, from Finder's
/// open-document event, which can arrive before the page asks for it.
pub struct LaunchPath(Mutex<Option<PathBuf>>);

impl LaunchPath {
    pub fn from_args() -> Self {
        Self(Mutex::new(std::env::args_os().skip(1).map(PathBuf::from).find(|p| p.exists())))
    }

    #[cfg(target_os = "macos")]
    pub fn set(&self, path: PathBuf) {
        *self.0.lock() = Some(path);
    }
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| AppError::Task(e.to_string()))?
}

#[tauri::command]
pub async fn decode_image(path: PathBuf) -> Result<Response> {
    blocking(move || Ok(Response::new(wire::encode(decode::decode(&path, Purpose::View)?)))).await
}

#[tauri::command]
pub async fn thumbnail(path: PathBuf, size: u32, thumbs: State<'_, Arc<Thumbnailer>>) -> Result<Response> {
    let _permit = thumbs.permits.acquire().await.map_err(|e| AppError::Task(e.to_string()))?;
    let worker = Arc::clone(&thumbs);
    let frame = blocking(move || worker.render(&path, size.clamp(32, 1024))).await?;
    Ok(Response::new(frame.as_ref().clone()))
}

#[tauri::command]
pub async fn list_folder(path: PathBuf) -> Result<folder::Listing> {
    blocking(move || Ok(folder::list(&path)?)).await
}

#[tauri::command]
pub async fn file_info(path: PathBuf) -> Result<meta::FileInfo> {
    blocking(move || Ok(meta::file_info(&path)?)).await
}

#[tauri::command]
pub async fn move_to_trash(path: PathBuf) -> Result<()> {
    blocking(move || Ok(trash::delete(&path)?)).await
}

/// Writes an exported image to the path the user picked in the save dialog.
#[tauri::command]
pub async fn write_file(request: Request<'_>) -> Result<()> {
    let InvokeBody::Raw(body) = request.body() else { return Err(AppError::BadRequest) };
    let (bytes, path) = wire::split_path(body).ok_or(AppError::BadRequest)?;
    let (bytes, path) = (bytes.to_vec(), path.to_path_buf());
    blocking(move || Ok(std::fs::write(path, bytes)?)).await
}

/// Recognises the text in an image sent as `[RGBA pixels][width: u32 LE]`.
#[tauri::command]
pub async fn recognize_text(request: Request<'_>, ocr: State<'_, Arc<Ocr>>) -> Result<String> {
    let InvokeBody::Raw(body) = request.body() else { return Err(AppError::BadRequest) };
    let (pixels, width) = wire::split_u32(body).ok_or(AppError::BadRequest)?;
    let (pixels, ocr) = (pixels.to_vec(), Arc::clone(&ocr));
    blocking(move || ocr.text(&pixels, width as usize)).await
}

#[tauri::command]
pub fn launch_path(launch: State<'_, LaunchPath>) -> Option<PathBuf> {
    launch.0.lock().take()
}

#[tauri::command]
pub fn supported_extensions() -> Vec<&'static str> {
    format::supported_extensions()
}
