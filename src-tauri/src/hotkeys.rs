//! Global hotkeys.
//!
//! Linux (Wayland): `org.freedesktop.portal.GlobalShortcuts`.
//! Why not `tauri-plugin-global-shortcut` there: it wraps `global-hotkey`,
//! which is **X11-only on Linux** — under a KDE Wayland session there is no
//! root window to grab, so registration either fails or silently never fires.
//!
//! Windows/macOS: `tauri-plugin-global-shortcut` IS the sanctioned path
//! (RegisterHotKey / Carbon event hotkeys); the plugin is registered in
//! `lib.rs` on those platforms only and bound in `register_hotkeys` below.
//!
//! The portal is the only sanctioned path on Wayland: the *compositor* owns the
//! binding (KDE routes it through KGlobalAccel / System Settings → Shortcuts)
//! and the app receives `Activated` signals.
//!
//! Flow:
//!
//! ```text
//! register_hotkeys([{id, trigger}])
//!   └─ GlobalShortcuts portal (linux)
//!        ├─ new() + create_session()      -- fails? → backend "none", no crash
//!        ├─ bind_shortcuts()               -- MAY BLOCK until the user accepts
//!        │                                   KDE's approval dialog; the reply
//!        │                                   can contain FEWER shortcuts than
//!        │                                   requested → we report only what
//!        │                                   was actually granted
//!        └─ receive_activated() → task emits "hotkey-activated" {id}
//! ```
//!
//! `unregister_hotkeys()` stops the reader task, closes the portal session and
//! resets the status to `backend: "none"`.
//!
//! Only one `BindShortcuts` call is allowed per portal *session*, so re-binding
//! always means a new session — that is what `register_hotkeys` does.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// A hotkey the frontend wants bound. `trigger` is either a human/X11-ish combo
/// (`"CTRL+SHIFT+P"`, `"Print"`, `"SHIFT+Print"`) or an already valid XDG
/// shortcuts string (`"<Control><Shift>p"`), which is passed through untouched.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyDef {
    pub id: String,
    pub trigger: String,
}

/// A shortcut the compositor really bound. `trigger` is the portal's
/// user-readable description of the active binding (e.g. `"Ctrl+Shift+P"`), not
/// necessarily the one we asked for.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrantedShortcut {
    pub id: String,
    pub trigger: String,
}

/// What the UI needs to be honest about hotkeys: which backend is live and
/// which combos are actually bound right now.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    /// `"portal"` (Wayland GlobalShortcuts), `"native"` (Windows/macOS
    /// global-shortcut plugin) or `"none"` (nothing bound).
    pub backend: String,
    pub granted: Vec<GrantedShortcut>,
}

impl HotkeyStatus {
    fn none() -> Self {
        Self {
            backend: "none".to_string(),
            granted: Vec::new(),
        }
    }
}

/// Managed state: the last reported status plus the handles that keep the
/// portal session (and its reader task) alive.
pub struct HotkeyState {
    status: Mutex<HotkeyStatus>,
    /// Sending on this channel tells the reader task to close the session.
    #[cfg(target_os = "linux")]
    stop: Mutex<Option<tauri::async_runtime::Sender<()>>>,
    #[cfg(target_os = "linux")]
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Default for HotkeyState {
    fn default() -> Self {
        Self {
            status: Mutex::new(HotkeyStatus::none()),
            #[cfg(target_os = "linux")]
            stop: Mutex::new(None),
            #[cfg(target_os = "linux")]
            task: Mutex::new(None),
        }
    }
}

impl HotkeyState {
    pub fn new() -> Self {
        Self::default()
    }

    fn status(&self) -> HotkeyStatus {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn set_status(&self, status: HotkeyStatus) -> HotkeyStatus {
        let mut guard = self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = status;
        guard.clone()
    }

    /// Stop the reader task (if any) and drop the handles. Safe to call when
    /// nothing is bound. Returns whether a session was actually torn down.
    fn stop_task(&self) -> bool {
        #[cfg(target_os = "linux")]
        {
            let had_stop = self
                .stop
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            let was_bound = had_stop.is_some();
            if let Some(stop) = had_stop {
                // Wakes the reader task; it closes the portal session itself
                // before exiting. The sender is dropped right after, which also
                // ends the channel.
                let _ = stop.try_send(());
            }
            // Detach rather than abort: aborting mid-`session.close()` would
            // cancel the close and leave the compositor holding the combos.
            let _ = self
                .task
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            was_bound
        }
        #[cfg(not(target_os = "linux"))]
        {
            false
        }
    }
}

/// Translate `"CTRL+SHIFT+P"` / `"Print"` / `"SHIFT+Print"` into the XDG
/// "shortcuts" spec form (`"<Control><Shift>p"`, `"Print"`, `"<Shift>Print"`).
///
/// Input that already looks like an XDG accelerator (`a<b` somewhere) is
/// returned unchanged.
pub fn xdg_trigger(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    // `<Control><Shift>p` — already in spec form.
    if trimmed.contains('<') {
        return trimmed.to_string();
    }

    let mut out = String::new();
    let mut key: Option<String> = None;

    for raw in trimmed.split('+') {
        let token = raw.trim();
        if token.is_empty() {
            continue;
        }
        match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "ctl" => out.push_str("<Control>"),
            "shift" => out.push_str("<Shift>"),
            "alt" | "option" | "opt" => out.push_str("<Alt>"),
            "super" | "meta" | "win" | "cmd" | "command" => out.push_str("<Super>"),
            _ => key = Some(normalize_key(token)),
        }
    }

    match key {
        // Modifiers only (a bad config): fall back to the raw text rather than
        // binding every key on the keyboard.
        None => trimmed.to_string(),
        Some(key) => {
            out.push_str(&key);
            out
        }
    }
}

/// Keysym-ish normalisation: single characters are lowercased (the spec's
/// examples use `p`, not `P`), named keys keep their canonical spelling,
/// everything else is kept verbatim.
fn normalize_key(token: &str) -> String {
    if token.chars().count() == 1 {
        // Letters only; digits and punctuation have no case.
        return token.to_ascii_lowercase();
    }
    match token.to_ascii_lowercase().as_str() {
        "print" | "printscreen" | "prtsc" => "Print".to_string(),
        "space" => "space".to_string(),
        "escape" | "esc" => "Escape".to_string(),
        "return" => "Return".to_string(),
        "enter" => "Return".to_string(),
        "tab" => "Tab".to_string(),
        "delete" | "del" => "Delete".to_string(),
        "backspace" => "BackSpace".to_string(),
        "insert" | "ins" => "Insert".to_string(),
        "home" => "Home".to_string(),
        "end" => "End".to_string(),
        "pageup" | "pgup" => "Page_Up".to_string(),
        "pagedown" | "pgdn" => "Page_Down".to_string(),
        "left" => "Left".to_string(),
        "right" => "Right".to_string(),
        "up" => "Up".to_string(),
        "down" => "Down".to_string(),
        other => {
            // `f1`..`f12`, `Print`-style names we do not know: uppercase the
            // leading letter so `f5` becomes `F5` and `Print` stays `Print`.
            let mut chars = other.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        }
    }
}

/// Human text for the compositor's approval dialog. Unknown ids fall back to
/// the id itself so a new shortcut still gets a sensible label.
fn description_for(id: &str) -> String {
    match id {
        "capture-full" | "capture_full" => "Capture the whole screen".to_string(),
        "capture-region" | "capture_region" => "Capture a region".to_string(),
        "delayed-capture" | "delayed_capture" => "Delayed capture".to_string(),
        "open-widget" | "open_widget" | "toggle-widget" | "toggle_widget" => {
            "Show the quick capture widget".to_string()
        }
        other => format!("SnagCraft: {other}"),
    }
}

/// One modifier token in the `global-hotkey` parser's spelling.
/// Only called from the non-Linux bind path; kept cross-platform (lint
/// silenced) so the `native_trigger` unit tests run everywhere.
#[allow(dead_code)]
fn native_mod(token: &str) -> Option<&'static str> {
    match token.to_ascii_lowercase().as_str() {
        "ctrl" | "control" | "ctl" => Some("Ctrl"),
        "shift" => Some("Shift"),
        "alt" | "option" | "opt" => Some("Alt"),
        "super" | "meta" | "win" | "cmd" | "command" => Some("Super"),
        "commandorcontrol" | "commandorctrl" | "cmdorctrl" | "cmdorcontrol" => {
            Some("CommandOrControl")
        }
        _ => None,
    }
}

/// One main-key token in the `global-hotkey` parser's spelling. It accepts
/// e.g. `PRINTSCREEN` but NOT `PRINT`, `ENTER` but not `RETURN` — this is the
/// translation layer from our internal/XDG-ish spelling.
#[allow(dead_code)]
fn native_key(token: &str) -> String {
    if token.chars().count() == 1 {
        return token.to_ascii_uppercase();
    }
    match token.to_ascii_lowercase().as_str() {
        "print" | "printscreen" | "prtsc" => "PrintScreen".to_string(),
        "esc" | "escape" => "Escape".to_string(),
        "enter" | "return" => "Enter".to_string(),
        "backspace" => "Backspace".to_string(),
        "del" | "delete" => "Delete".to_string(),
        "ins" | "insert" => "Insert".to_string(),
        "pgup" | "pageup" => "PageUp".to_string(),
        "pgdn" | "pagedown" => "PageDown".to_string(),
        "space" => "Space".to_string(),
        "tab" => "Tab".to_string(),
        "home" => "Home".to_string(),
        "end" => "End".to_string(),
        "up" => "ArrowUp".to_string(),
        "down" => "ArrowDown".to_string(),
        "left" => "ArrowLeft".to_string(),
        "right" => "ArrowRight".to_string(),
        other => {
            // `f5` → `F5`, unknown names get a canonical leading uppercase —
            // the parser is the final judge (an unparsable combo is skipped).
            let mut chars = other.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        }
    }
}

/// Translate `"CTRL+SHIFT+P"` / `"Print"` / `"SHIFT+Print"` — or an XDG spec
/// string like `"<Control><Shift>p"` — into the `global-hotkey` parser form
/// (`"Ctrl+Shift+P"`, `"PrintScreen"`, `"Shift+PrintScreen"`).
///
/// Modifier-only or empty input is returned unchanged: it fails to parse and
/// the bind step skips it honestly instead of binding "any key".
#[allow(dead_code)]
pub fn native_trigger(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut mods: Vec<&'static str> = Vec::new();
    let mut key: Option<String> = None;

    if trimmed.contains('<') {
        // XDG spec form: leading `<Axis>` groups, then the key.
        let mut rest = trimmed;
        while let Some(stripped) = rest.strip_prefix('<') {
            let Some(close) = stripped.find('>') else {
                break;
            };
            let axis = &stripped[..close];
            match native_mod(axis) {
                Some(m) => mods.push(m),
                None => break,
            }
            rest = &stripped[close + 1..];
        }
        let tail = rest.trim();
        if !tail.is_empty() && !tail.contains('<') {
            key = Some(native_key(tail));
        }
    } else {
        for raw in trimmed.split('+') {
            let token = raw.trim();
            if token.is_empty() {
                continue;
            }
            match native_mod(token) {
                Some(m) => mods.push(m),
                None => key = Some(native_key(token)),
            }
        }
    }

    match key {
        None => trimmed.to_string(),
        Some(key) => {
            let mut out = String::new();
            for m in mods {
                out.push_str(m);
                out.push('+');
            }
            out.push_str(&key);
            out
        }
    }
}

#[cfg(target_os = "linux")]
mod portal {
    //! The Wayland/X11-portal backend.
    //!
    //! `futures_core::Stream` is not a direct dependency of this crate (and
    //! `Cargo.toml` is owned elsewhere), so the trait is borrowed through
    //! zbus's macro-support re-export — the same trait object ashpd's
    //! `impl Stream` returns.
    use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
    use ashpd::desktop::{CreateSessionOptions, Session};
    use ashpd::zbus::export::futures_core::Stream;
    use std::pin::Pin;
    use std::task::Poll;
    use tauri::{AppHandle, Emitter};

    use super::{description_for, xdg_trigger, GrantedShortcut, HotkeyDef, HotkeyStatus};

    /// Everything needed to keep a binding session alive.
    pub struct Bound {
        pub status: HotkeyStatus,
        pub stop: tauri::async_runtime::Sender<()>,
        pub task: tauri::async_runtime::JoinHandle<()>,
    }

    /// Bind `defs` through the portal. On any failure the caller degrades to
    /// `backend: "none"` — a missing portal must never take the app down.
    pub async fn bind(app: AppHandle, defs: &[HotkeyDef]) -> Result<Bound, String> {
        let proxy = GlobalShortcuts::new()
            .await
            .map_err(|err| format!("GlobalShortcuts portal unavailable: {err}"))?;

        let session: Session<GlobalShortcuts> = proxy
            .create_session(CreateSessionOptions::default())
            .await
            .map_err(|err| format!("could not create a shortcuts session: {err}"))?;

        let triggers: Vec<String> = defs.iter().map(|d| xdg_trigger(&d.trigger)).collect();
        let requested: Vec<NewShortcut> = defs
            .iter()
            .zip(triggers.iter())
            .map(|(def, trigger)| {
                NewShortcut::new(def.id.clone(), description_for(&def.id))
                    .preferred_trigger(Some(trigger.as_str()))
            })
            .collect();

        // This call can block for as long as the compositor's approval dialog is
        // on screen (first run, and whenever the combo changes). It is awaited
        // on the async runtime, so the UI stays responsive.
        let request = proxy
            .bind_shortcuts(&session, &requested, None, Default::default())
            .await
            .map_err(|err| format!("BindShortcuts failed: {err}"))?;
        let bound = request
            .response()
            .map_err(|err| format!("shortcuts were not granted: {err}"))?;

        // The reply may hold fewer shortcuts than we asked for (user declined,
        // combo already taken) — report only what is really bound.
        let granted: Vec<GrantedShortcut> = bound
            .shortcuts()
            .iter()
            .map(|shortcut| {
                let id = shortcut.id().to_string();
                let described = shortcut.trigger_description().trim().to_string();
                let trigger = if described.is_empty() {
                    defs.iter()
                        .find(|d| d.id == id)
                        .map(|d| d.trigger.clone())
                        .unwrap_or_default()
                } else {
                    described
                };
                GrantedShortcut { id, trigger }
            })
            .collect();

        let status = HotkeyStatus {
            backend: "portal".to_string(),
            granted,
        };

        let mut stream = Box::pin(
            proxy
                .receive_activated()
                .await
                .map_err(|err| format!("cannot listen for activations: {err}"))?,
        );

        let (stop, mut stop_rx) = tauri::async_runtime::channel::<()>(1);
        let app_task = app.clone();
        let task = tauri::async_runtime::spawn(async move {
            loop {
                let event = std::future::poll_fn(|cx| {
                    if Pin::new(&mut stop_rx).poll_recv(cx).is_ready() {
                        return Poll::Ready(None);
                    }
                    stream.as_mut().poll_next(cx)
                })
                .await;

                match event {
                    Some(activated) => {
                        let id = activated.shortcut_id().to_string();
                        if let Err(err) =
                            app_task.emit("hotkey-activated", serde_json::json!({ "id": id }))
                        {
                            eprintln!("snagcraft: could not emit hotkey-activated: {err}");
                        }
                    }
                    None => break,
                }
            }
            // Ends the portal session so the compositor releases the combos.
            let _ = session.close().await;
        });

        Ok(Bound { status, stop, task })
    }
}

/// Bind (or rebind) the requested shortcuts and report what was granted.
///
/// Never returns `Err` for "the portal is missing": hotkeys degrade to
/// `backend: "none"` with an empty grant list, which is what the settings UI
/// shows alongside the tray/`--capture` fallbacks.
#[tauri::command]
pub async fn register_hotkeys(
    app: tauri::AppHandle,
    state: tauri::State<'_, HotkeyState>,
    shortcuts: Vec<HotkeyDef>,
) -> Result<HotkeyStatus, String> {
    // Rebinding needs a fresh portal session (one BindShortcuts per session).
    // If a session was live, give the compositor a moment to release the old
    // grabs so the new bind is not rejected as "already taken".
    if state.stop_task() {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }

    let cleaned: Vec<HotkeyDef> = shortcuts
        .into_iter()
        .filter(|def| !def.id.trim().is_empty() && !def.trigger.trim().is_empty())
        .collect();

    if cleaned.is_empty() {
        return Ok(state.set_status(HotkeyStatus::none()));
    }

    #[cfg(target_os = "linux")]
    {
        match portal::bind(app, &cleaned).await {
            Ok(bound) => {
                *state
                    .stop
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(bound.stop);
                *state
                    .task
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(bound.task);
                Ok(state.set_status(bound.status))
            }
            Err(err) => {
                eprintln!("snagcraft: global hotkeys unavailable ({err}); backend=none");
                Ok(state.set_status(HotkeyStatus::none()))
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        use tauri::Emitter as _;
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

        let gs = app.global_shortcut();
        // Clean rebind: previous registrations (and their handler-map entries)
        // go first, then each requested combo is registered on its own — a
        // combo another app already holds fails alone, never takes the rest.
        let _ = gs.unregister_all();

        let mut granted = Vec::new();
        for def in &cleaned {
            let trigger = native_trigger(&def.trigger);
            let Ok(shortcut) = trigger.parse::<Shortcut>() else {
                eprintln!(
                    "snagcraft: cannot parse hotkey {:?} (→ {:?}) for native binding",
                    def.trigger, trigger
                );
                continue;
            };
            let id = def.id.clone();
            match gs.on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if let Err(err) = app.emit("hotkey-activated", serde_json::json!({ "id": id }))
                    {
                        eprintln!("snagcraft: could not emit hotkey-activated: {err}");
                    }
                }
            }) {
                Ok(()) => granted.push(GrantedShortcut {
                    id: def.id.clone(),
                    trigger,
                }),
                Err(err) => eprintln!("snagcraft: could not bind {} ({}): {err}", def.id, trigger),
            }
        }

        let status = if granted.is_empty() {
            // Nothing bound (all combos taken/unparsable) — stay honest.
            HotkeyStatus::none()
        } else {
            HotkeyStatus {
                backend: "native".to_string(),
                granted,
            }
        };
        Ok(state.set_status(status))
    }
}

/// Last known hotkey state (backend + actually granted combos).
#[tauri::command]
pub fn get_hotkey_status(state: tauri::State<'_, HotkeyState>) -> HotkeyStatus {
    state.status()
}

/// Release every binding and close the portal session (Linux) or unregister
/// every native shortcut (Windows/macOS).
#[tauri::command]
pub async fn unregister_hotkeys(
    app: tauri::AppHandle,
    state: tauri::State<'_, HotkeyState>,
) -> Result<HotkeyStatus, String> {
    state.stop_task();
    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let _ = app.global_shortcut().unregister_all();
    }
    #[cfg(target_os = "linux")]
    let _ = app;
    Ok(state.set_status(HotkeyStatus::none()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trigger_converts_modifiers_to_xdg_axes() {
        assert_eq!(xdg_trigger("CTRL+SHIFT+P"), "<Control><Shift>p");
        assert_eq!(xdg_trigger("ctrl+p"), "<Control>p");
        assert_eq!(xdg_trigger("ALT+F5"), "<Alt>F5");
        assert_eq!(xdg_trigger("Super+Print"), "<Super>Print");
    }

    #[test]
    fn trigger_handles_bare_named_keys() {
        assert_eq!(xdg_trigger("Print"), "Print");
        assert_eq!(xdg_trigger("SHIFT+Print"), "<Shift>Print");
        assert_eq!(xdg_trigger("  ESCAPE  "), "Escape");
        assert_eq!(xdg_trigger("Ctrl+Space"), "<Control>space");
        assert_eq!(xdg_trigger("Ctrl+PageDown"), "<Control>Page_Down");
    }

    #[test]
    fn trigger_passes_through_existing_xdg_strings() {
        assert_eq!(xdg_trigger("<Control><Shift>p"), "<Control><Shift>p");
        assert_eq!(xdg_trigger("<Super>Print"), "<Super>Print");
    }

    #[test]
    fn trigger_never_emits_a_modifier_only_binding() {
        // A config that is only modifiers must not bind "any key".
        assert_eq!(xdg_trigger("CTRL+SHIFT"), "CTRL+SHIFT");
        assert_eq!(xdg_trigger(""), "");
    }

    #[test]
    fn native_trigger_maps_internal_form_to_plugin_form() {
        assert_eq!(native_trigger("PRINT"), "PrintScreen");
        assert_eq!(native_trigger("Print"), "PrintScreen");
        assert_eq!(native_trigger("SHIFT+PRINT"), "Shift+PrintScreen");
        assert_eq!(native_trigger("CTRL+SHIFT+P"), "Ctrl+Shift+P");
        assert_eq!(native_trigger("ALT+F5"), "Alt+F5");
        assert_eq!(native_trigger("ctrl+space"), "Ctrl+Space");
        assert_eq!(native_trigger("WIN+D"), "Super+D");
        assert_eq!(native_trigger("PGDN"), "PageDown");
        assert_eq!(native_trigger("RETURN"), "Enter");
    }

    #[test]
    fn native_trigger_converts_xdg_form() {
        assert_eq!(native_trigger("<Control><Shift>p"), "Ctrl+Shift+P");
        assert_eq!(native_trigger("<Super>Print"), "Super+PrintScreen");
        assert_eq!(native_trigger("<Alt>F5"), "Alt+F5");
    }

    #[test]
    fn native_trigger_refuses_modifier_only() {
        // Unparsable by the plugin on purpose → the bind step skips it.
        assert_eq!(native_trigger("CTRL+SHIFT"), "CTRL+SHIFT");
        assert_eq!(native_trigger(""), "");
    }

    #[test]
    fn status_starts_unbound() {
        let state = HotkeyState::new();
        let status = state.status();
        assert_eq!(status.backend, "none");
        assert!(status.granted.is_empty());
    }

    #[test]
    fn status_serialises_camel_case_for_the_frontend() {
        let status = HotkeyStatus {
            backend: "portal".to_string(),
            granted: vec![GrantedShortcut {
                id: "capture-full".to_string(),
                trigger: "Ctrl+Shift+P".to_string(),
            }],
        };
        let json = serde_json::to_value(&status).expect("status serialises");
        assert_eq!(json["backend"], "portal");
        assert_eq!(json["granted"][0]["id"], "capture-full");
    }

    #[test]
    fn descriptions_are_human_readable() {
        assert_eq!(description_for("capture-full"), "Capture the whole screen");
        assert_eq!(description_for("capture-region"), "Capture a region");
        assert!(description_for("custom-id").contains("custom-id"));
    }
}
