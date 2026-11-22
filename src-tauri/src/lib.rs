mod capture;
mod cli;
mod clipboard;
mod commands;
mod export;
mod hotkeys;
mod ocr;
// Single-frame ScreenCast portal grab (window/monitor capture, Wave 10). Linux
// only: the other platforms have no ScreenCast portal.
#[cfg(target_os = "linux")]
mod portal_capture;
mod recording;
mod scrolling;
mod timelapse;
mod tray;
mod upload;
mod windows;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // --help / --version answer on the console, no GUI.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if cli::early_exit(&args) {
        return;
    }
    tauri::Builder::default()
        // System-application behaviour: a second launch (hotkey companion,
        // `snagcraft --capture`, "Open with" on an image) focuses the running
        // window and forwards the request instead of opening a new instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let req = cli::parse_args(&argv[1..]);
            cli::dispatch(app, &req);
        }))
        .plugin(tauri_plugin_dialog::init())
        // Launch-at-login (Settings → General). Linux uses XDG autostart and
        // resolves the AppImage path via $APPIMAGE, so the .desktop entry keeps
        // pointing at the real file, not the temporary FUSE mount.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Close-guard state: force-quit flag, editor-dirty flag, minimize-to-tray
        // preference. All three are driven by the commands in `windows.rs`.
        .manage(windows::AppFlags::new())
        .manage(windows::HudWindowSize::default())
        // Global-hotkey state: the live backend, the granted combos and the
        // handles that keep the portal session alive (see `hotkeys.rs`).
        .manage(hotkeys::HotkeyState::new())
        // Screen recording (Wave 8): stop signal, capture thread and — on Linux —
        // the live ScreenCast portal session (see `recording.rs`).
        .manage(recording::RecordingState::new())
        // Scrolling capture (Wave 9): portal cast + stitcher thread (see
        // `scrolling/mod.rs`).
        .manage(scrolling::ScrollingState::new())
        .invoke_handler(tauri::generate_handler![
            commands::capture_screenshot,
            cli::launch_request,
            // Wave 10: single-frame capture of one window or one monitor
            // (ScreenCast portal picker -> PipeWire -> one frame -> PNG)
            commands::capture_window,
            commands::capture_monitor,
            // Multi-monitor on Windows/macOS: in-app screen chooser (issue #1)
            commands::list_monitors,
            commands::capture_monitor_index,
            // Window capture on Windows/macOS: in-app window chooser
            commands::list_windows,
            commands::capture_window_id,
            commands::save_png,
            commands::copy_png,
            commands::copy_text,
            commands::get_version,
            commands::set_fullscreen,
            commands::default_save_dir,
            commands::pick_save_dir,
            commands::save_png_to_dir,
            commands::read_image_file,
            commands::list_folder_media,
            // Wave 11: Save As — native dialog, PNG/JPEG/WebP + quality
            commands::save_image_as,
            commands::recording_diagnostics,
            commands::open_path,
            commands::recording_thumb,
            export::save_image,
            windows::force_close,
            windows::set_dirty,
            windows::is_dirty,
            windows::set_minimize_to_tray,
            windows::get_minimize_to_tray,
            windows::set_hud_mode,
            // Floating quick-capture widget
            windows::open_widget,
            windows::close_widget,
            windows::toggle_widget,
            windows::widget_capture,
            // Wayland GlobalShortcuts portal (degrades to backend="none")
            hotkeys::register_hotkeys,
            hotkeys::get_hotkey_status,
            hotkeys::unregister_hotkeys,
            // Wave 7: grab text (tesseract)
            ocr::ocr_image,
            ocr::ocr_available,
            ocr::ocr_languages,
            // Wave 8: screen recording (ScreenCast portal -> PipeWire -> ffmpeg)
            recording::start_recording,
            recording::stop_recording,
            recording::is_recording,
            // Wave 25: audio devices, pause/resume
            recording::list_audio_sources,
            recording::pause_recording,
            recording::resume_recording,
            // Wave 25: interval capture -> timelapse
            timelapse::make_timelapse,
            // Wave 25: generic upload + opening the returned link
            upload::upload_image,
            upload::open_url,
            // Wave 9: scrolling capture (manual-scroll stitch)
            scrolling::scrolling_start,
            scrolling::scrolling_done,
            scrolling::scrolling_cancel,
            scrolling::set_click_through
        ])
        .setup(|app| {
            // Order matters: the close guard must exist before the window can be
            // closed, and the tray is the only way back in after minimizing.
            windows::register_close_guard(app);
            // A missing appindicator/desktop integration is not fatal: log it and
            // carry on. `tray::is_available()` then keeps close-to-tray disabled
            // so the window can never hide with no way back.
            if let Err(err) = tray::init_tray(app) {
                eprintln!("snagcraft: system tray unavailable ({err}); continuing without it");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SnagCraft");
}
