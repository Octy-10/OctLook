//! Resident mode (Windows): with Space preview on, OctLook lives in the tray
//! and starts with the system (in the background), so Explorer can call on it
//! at any time. A second launch hands its file to the running instance.

use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Builder, Emitter, Manager, Window, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use crate::{
    error::{AppError, Result},
    spacebar,
};

/// Passed by the autostart entry: start without showing the main window.
const BACKGROUND: &str = "--background";
const TRAY: &str = "tray";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub space_preview: bool,
    /// Not stored: the autostart entry itself is the source of truth.
    #[serde(skip_deserializing)]
    pub autostart: bool,
}

pub fn plugins(builder: Builder<Wry>) -> Builder<Wry> {
    builder
        // Must come first, before any other plugin sees the second instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main(app, argv.into_iter().skip(1).map(PathBuf::from).find(|p| p.exists()));
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![BACKGROUND])))
}

pub fn launched_in_background() -> bool {
    std::env::args().any(|arg| arg == BACKGROUND)
}

pub fn setup(app: &AppHandle) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "打开 OctLook", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("OctLook")
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    let launch = app.autolaunch();
    let on = match load(app) {
        Some(on) => {
            // Re-registers this executable, so a moved or reinstalled app still starts.
            if launch.is_enabled().unwrap_or(false) {
                let _ = launch.enable();
            }
            on
        }
        None => {
            // First run: Space preview and starting with Windows are on by default.
            let _ = launch.enable();
            let _ = save(app, true);
            true
        }
    };
    Ok(apply(app, on)?)
}

/// The main window hides to the tray while Space preview needs the app running.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && spacebar::enabled() {
            api.prevent_close();
            let _ = window.hide();
            // Lets the page drop the open file instead of holding it in memory.
            let _ = window.emit_to("main", "main-hidden", ());
        }
    }
}

/// Brings the main window forward, opening `path` in it when given.
pub fn show_main(app: &AppHandle, path: Option<PathBuf>) {
    let Some(window) = app.get_webview_window("main") else { return };
    if let Some(path) = path {
        let _ = app.emit_to("main", "open-path", path);
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn settings(app: &AppHandle) -> Settings {
    Settings { space_preview: spacebar::enabled(), autostart: app.autolaunch().is_enabled().unwrap_or(false) }
}

pub fn set_space_preview(app: &AppHandle, on: bool) -> Result<Settings> {
    apply(app, on)?;
    save(app, on)?;
    if !on {
        // Starting with Windows only serves Space preview.
        set_autostart(app, false)?;
    }
    Ok(settings(app))
}

pub fn set_autostart(app: &AppHandle, on: bool) -> Result<Settings> {
    let launch = app.autolaunch();
    if on { launch.enable() } else { launch.disable() }.map_err(|e| AppError::Task(e.to_string()))?;
    Ok(settings(app))
}

fn apply(app: &AppHandle, on: bool) -> Result<()> {
    spacebar::set_enabled(app, on)?;
    if let Some(tray) = app.tray_by_id(TRAY) {
        tray.set_visible(on)?;
    }
    Ok(())
}

fn settings_file(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join("settings.json"))
}

/// The stored Space preview switch; None on first run.
fn load(app: &AppHandle) -> Option<bool> {
    let stored: Settings = serde_json::from_slice(&fs::read(settings_file(app).ok()?).ok()?).ok()?;
    Some(stored.space_preview)
}

fn save(app: &AppHandle, space_preview: bool) -> Result<()> {
    let file = settings_file(app)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(file, serde_json::json!({ "spacePreview": space_preview }).to_string())?;
    Ok(())
}
