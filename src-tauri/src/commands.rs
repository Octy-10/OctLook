//! IPC controllers: argument plumbing only; work happens in the services.

use std::{path::PathBuf, sync::Arc};

use octlook_core::{
    decode::{self, Purpose},
    format, meta,
};
use tauri::{ipc::Response, State};

use crate::{
    error::{AppError, Result},
    folder,
    thumbs::Thumbnailer,
    wire,
};

/// File passed on the command line ("Open with…" / file association).
pub struct LaunchPath(Option<PathBuf>);

impl LaunchPath {
    pub fn from_args() -> Self {
        Self(std::env::args_os().skip(1).map(PathBuf::from).find(|p| p.exists()))
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

#[tauri::command]
pub fn launch_path(launch: State<'_, LaunchPath>) -> Option<PathBuf> {
    launch.0.clone()
}

#[tauri::command]
pub fn supported_extensions() -> Vec<&'static str> {
    format::supported_extensions()
}
