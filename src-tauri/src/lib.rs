#[cfg(windows)]
mod com;
mod commands;
mod default_app;
mod error;
mod folder;
mod ocr;
#[cfg(windows)]
mod resident;
#[cfg(windows)]
mod shell_integration;
#[cfg(windows)]
mod spacebar;
mod thumbs;
mod wire;

use std::sync::Arc;

use tauri::{webview::PageLoadEvent, Manager};

pub fn run() {
    #[cfg(windows)]
    if let Some(code) = shell_integration::run_cli() {
        std::process::exit(code);
    }
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = resident::plugins(builder);
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(updater())
        .manage(Arc::new(thumbs::Thumbnailer::new()))
        .manage(commands::LaunchPath::from_args())
        .setup(|app| {
            app.manage(Arc::new(ocr::Ocr::new(app.path().resource_dir()?.join("ocr"))));
            #[cfg(windows)]
            resident::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::decode_image,
            commands::thumbnail,
            commands::list_folder,
            commands::file_info,
            commands::read_text,
            commands::font_info,
            commands::default_app,
            commands::open_with_default,
            commands::move_to_trash,
            commands::write_file,
            commands::recognize_text,
            commands::launch_path,
            commands::supported_extensions,
            #[cfg(windows)]
            commands::resident_settings,
            #[cfg(windows)]
            commands::set_space_preview,
            #[cfg(windows)]
            commands::set_autostart,
            #[cfg(windows)]
            commands::quicklook_present,
            #[cfg(windows)]
            commands::quicklook_close,
            #[cfg(windows)]
            commands::open_in_main,
            #[cfg(windows)]
            commands::quicklook_pin,
            #[cfg(windows)]
            commands::quicklook_ready,
        ])
        .on_window_event(|_window, _event| {
            #[cfg(windows)]
            resident::on_window_event(_window, _event);
        })
        // Windows start hidden so users never see an unstyled flash. The main window
        // stays hidden after a background start; preview windows show themselves once their file loads.
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            #[cfg(windows)]
            if resident::launched_in_background() {
                return;
            }
            if webview.label() == "main" {
                if let Some(window) = webview.app_handle().get_webview_window("main") {
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

/// Windows: an update installs over the running copy (`/D=` its directory),
/// wherever the user put it, instead of where the installer's registry says.
fn updater() -> tauri::plugin::TauriPlugin<tauri::Wry, tauri_plugin_updater::Config> {
    let builder = tauri_plugin_updater::Builder::new();
    // NSIS takes `/D=` unquoted and last, which is where the plugin appends it.
    #[cfg(windows)]
    let builder = builder.installer_args(std::env::current_exe().ok().and_then(|exe| Some(format!("/D={}", exe.parent()?.display()))));
    builder.build()
}
