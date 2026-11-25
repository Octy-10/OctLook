mod commands;
mod error;
mod folder;
mod ocr;
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
        .setup(|app| {
            app.manage(Arc::new(ocr::Ocr::new(app.path().resource_dir()?.join("ocr"))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::decode_image,
            commands::thumbnail,
            commands::list_folder,
            commands::file_info,
            commands::move_to_trash,
            commands::write_file,
            commands::recognize_text,
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
        .build(tauri::generate_context!())
        .expect("failed to start OctLook")
        .run(|_app, _event| {
            // Finder opens documents with an Apple Event, not argv; this one also
            // arrives while the app is already running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                use tauri::Emitter;
                if let Some(path) = urls.iter().find_map(|url| url.to_file_path().ok()) {
                    _app.state::<commands::LaunchPath>().set(path.clone());
                    let _ = _app.emit("open-path", path);
                }
            }
        });
}
