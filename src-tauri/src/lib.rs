mod commands;
mod error;
mod folder;
#[cfg(windows)]
mod shell_integration;
mod thumbs;
mod wire;

use std::sync::Arc;

use tauri::{webview::PageLoadEvent, Manager};

pub fn run() {
    #[cfg(windows)]
    if let Some(code) = shell_integration::run_cli() {
        std::process::exit(code);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Arc::new(thumbs::Thumbnailer::new()))
        .manage(commands::LaunchPath::from_args())
        .invoke_handler(tauri::generate_handler![
            commands::decode_image,
            commands::thumbnail,
            commands::list_folder,
            commands::file_info,
            commands::move_to_trash,
            commands::launch_path,
            commands::supported_extensions,
        ])
        // The window starts hidden so users never see an unstyled flash.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Some(window) = webview.app_handle().get_webview_window(webview.label()) {
                    let _ = window.show();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start OctLook");
}
