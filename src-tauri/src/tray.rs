//! System tray icon + menu.
//!
//! Linux backend: tray-icon's **ksni** (StatusNotifierItem) backend, enabled via
//! the `tray-icon` feature in Cargo.toml. The default libappindicator backend
//! emits no mouse events at all; ksni does — KDE sends `Activate` on left click
//! and `SecondaryActivate` on middle click, and shows the DBusMenu on right
//! click. That is what makes click-to-restore possible on Wayland.
//!
//! Interactions:
//! - LEFT click (or double click)  → show/unminimize + focus the main window.
//!   SNI has no native double-click, but a double click is two left clicks and
//!   the first one already restores — the gesture works either way. Windows and
//!   macOS additionally deliver a real `DoubleClick` event, handled the same.
//! - MIDDLE click                  → toggle the floating widget.
//! - RIGHT click                   → the menu (host-rendered on Linux).
//!
//! Menu items:
//! - `Show SnagCraft`  — same as a left click
//! - `Capture`         — emit `tray-capture`; the frontend starts the flow
//! - `Floating widget` — toggle the quick-capture widget
//! - `Quit`            — set the force-quit flag, then exit (bypasses the guard)

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Runtime};

/// Whether a tray icon actually exists in this session. Hide-to-tray is only
/// safe when it does — otherwise the window would vanish with no way back.
static TRAY_READY: AtomicBool = AtomicBool::new(false);

pub fn is_available() -> bool {
    TRAY_READY.load(Ordering::SeqCst)
}

/// Small tray icon. 32x32 is the AppIndicator standard size.
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/32x32.png");

const ID_SHOW: &str = "tray-show";
const ID_CAPTURE: &str = "tray-capture-item";
const ID_WIDGET: &str = "tray-widget";
const ID_UPDATE: &str = "tray-update";
const ID_QUIT: &str = "tray-quit";

/// Show the main window from anywhere (tray click, second launch, …).
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Build the tray icon and menu. Called once from `lib.rs` setup.
pub fn init_tray<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id(ID_SHOW, "Show SnagCraft").build(app)?;
    let capture = MenuItemBuilder::with_id(ID_CAPTURE, "Capture").build(app)?;
    let widget = MenuItemBuilder::with_id(ID_WIDGET, "Floating widget").build(app)?;
    let update = MenuItemBuilder::with_id(ID_UPDATE, "Check for updates…").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id(ID_QUIT, "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &capture, &widget, &sep, &update, &quit])
        .build()?;

    let icon = tauri::image::Image::from_bytes(TRAY_ICON_PNG)?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("SnagCraft — click to open")
        .menu(&menu)
        // Left click is a restore gesture on every platform, so it must NOT be
        // swallowed by the menu; the menu belongs to right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            ID_SHOW => show_main(app),
            ID_CAPTURE => {
                // Frontend owns the capture flow (window hide, countdown,
                // editor); the tray only signals intent.
                let _ = app.emit("tray-capture", ());
            }
            ID_WIDGET => {
                let _ = crate::windows::toggle_widget_for(app);
            }
            ID_UPDATE => {
                // Same flow as File → Check for updates…, but the window may be
                // hidden (tray-only): show it first so the dialog is visible.
                show_main(app);
                let _ = app.emit("tray-update-check", ());
            }
            ID_QUIT => crate::windows::request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                // ksni (Linux) reports every left click as Click/Up; a double
                // click is simply two of these, and restoring twice is a no-op.
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => show_main(app),
                // Native double click on Windows/macOS.
                TrayIconEvent::DoubleClick { .. } => show_main(app),
                TrayIconEvent::Click {
                    button: MouseButton::Middle,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    let _ = crate::windows::toggle_widget_for(app);
                }
                _ => {}
            }
        })
        .build(app)?;

    TRAY_READY.store(true, Ordering::SeqCst);
    Ok(())
}
