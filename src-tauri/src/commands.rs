//! IPC controllers: argument plumbing only; work happens in the services.

use std::{path::PathBuf, sync::Arc};

use parking_lot::Mutex;

use octlook_core::{
    decode::{self, Purpose},
    font, format, meta, text,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    State,
};

use crate::{
    default_app,
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
pub async fn read_text(path: PathBuf, limit: Option<usize>) -> Result<text::TextFile> {
    blocking(move || Ok(text::read(&path, limit)?)).await
}

#[tauri::command]
pub async fn font_info(path: PathBuf) -> Result<font::FontInfo> {
    blocking(move || Ok(font::info(&path)?)).await
}

/// The app that edits `path` (Photoshop for a PSD, a code editor for source…), never OctLook;
/// None hides the button, as for files the viewer fully serves.
#[tauri::command]
pub async fn default_app(path: PathBuf) -> Result<Option<default_app::DefaultApp>> {
    blocking(move || Ok(default_app::find(&path))).await
}

#[tauri::command]
pub async fn open_with_default(path: PathBuf) -> Result<()> {
    blocking(move || default_app::open(&path)).await
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

#[cfg(windows)]
#[tauri::command]
pub fn resident_settings(app: tauri::AppHandle) -> crate::resident::Settings {
    crate::resident::settings(&app)
}

/// Async: it may create the preview window, which a sync command (on the main thread) cannot.
#[cfg(windows)]
#[tauri::command]
pub async fn set_space_preview(app: tauri::AppHandle, on: bool) -> Result<crate::resident::Settings> {
    crate::resident::set_space_preview(&app, on)
}

#[cfg(windows)]
#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, on: bool) -> Result<crate::resident::Settings> {
    crate::resident::set_autostart(&app, on)
}

#[cfg(windows)]
#[tauri::command]
pub fn quicklook_present(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<()> {
    crate::spacebar::present(&window, width, height)
}

#[cfg(windows)]
#[tauri::command]
pub fn quicklook_close() {
    crate::spacebar::close();
}

#[cfg(windows)]
#[tauri::command]
pub fn open_in_main(app: tauri::AppHandle, path: PathBuf) {
    crate::spacebar::close();
    crate::resident::show_main(&app, Some(path));
}
