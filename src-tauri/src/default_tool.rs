//! "Make SnagCraft the default screenshot tool" (Settings → Global hotkeys).
//!
//! On Cinnamon (Linux Mint) and GNOME the desktop itself grabs `Print` /
//! `Shift+Print` for its own screenshot tool, and the GlobalShortcuts portal
//! that `hotkeys.rs` uses is not implemented there (Mint's xapp portal has no
//! GlobalShortcuts at all). The sanctioned way to take the keys over on these
//! desktops is through their own keyboard settings:
//!
//! 1. clear the built-in screenshot bindings (gsettings media-keys / shell
//!    keybindings), and
//! 2. add custom keybindings that run `snagcraft --capture` / `--region` —
//!    the single-instance CLI path, which works whether or not the app is
//!    already running.
//!
//! This module does exactly that, with the user's explicit confirmation in the
//! UI, a backup of every previous value and a one-click restore. Verified
//! against the desktops' own sources:
//!
//! - Cinnamon `js/ui/keybindings.js`: watches `custom-list` on
//!   `org.cinnamon.desktop.keybindings`, skips the `__dummy__` entry, builds
//!   paths as `/org/cinnamon/desktop/keybindings/custom-keybindings/<entry>/`
//!   and shell-parses `command` (so the executable path is shell-quoted).
//!   The list holds SHORT names (`custom0`), not paths.
//! - GNOME (42+, verified on GNOME 49): `Print` lives in
//!   `org.gnome.shell.keybindings show-screenshot-ui`, `Shift+Print` in
//!   `screenshot`; older GNOME used `org.gnome.settings-daemon.plugins.media-keys
//!   screenshot` / `area-screenshot`. Both layouts are probed at runtime.
//!   The custom list holds FULL paths.
//!
//! MATE / XFCE / KDE are deliberately not touched: KDE already works through
//! the portal, and the others get an honest "not supported" status with the
//! manual `snagcraft --capture` recipe instead of guessed schema writes.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/* ------------------------------------------------------------ pure helpers */

/// Parse a GVariant `as` text (`['Print', '<Shift>Print']`, `@as []`, `[]`).
pub fn parse_list(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    // Hermetic keyfile-backend quirk: arrays under relocatable schemas come
    // back wrapped as a quoted string ("['Print']"). Real dconf never does
    // this; unwrapping keeps the keyfile integration test honest.
    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
        return parse_list(&parse_string(trimmed));
    }
    let trimmed = trimmed
        .strip_prefix("@as")
        .map(str::trim)
        .unwrap_or(trimmed);
    let Some(inner) = trimmed.strip_prefix('[').and_then(|s| s.strip_suffix(']')) else {
        return Vec::new();
    };
    split_items(inner).iter().map(|s| parse_string(s)).collect()
}

/// Split a GVariant array body on top-level commas (commas inside quoted
/// strings — a path may contain one — do not split).
fn split_items(inner: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut escaped = false;
    for ch in inner.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' && in_string {
            current.push(ch);
            escaped = true;
            continue;
        }
        if ch == '\'' {
            in_string = !in_string;
            current.push(ch);
            continue;
        }
        if ch == ',' && !in_string {
            items.push(current.trim().to_string());
            current.clear();
            continue;
        }
        current.push(ch);
    }
    if !current.trim().is_empty() {
        items.push(current.trim().to_string());
    }
    items
}

/// Parse a GVariant string text (`'foo'` or `"foo"`, with `\'` / `\\` escapes).
pub fn parse_string(raw: &str) -> String {
    let trimmed = raw.trim();
    let inner = match (
        trimmed
            .strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\'')),
        trimmed.strip_prefix('"').and_then(|s| s.strip_suffix('"')),
    ) {
        (Some(inner), _) | (_, Some(inner)) => inner,
        _ => return trimmed.to_string(),
    };
    let mut out = String::new();
    let mut escaped = false;
    for ch in inner.chars() {
        if escaped {
            out.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        out.push(ch);
    }
    out
}

/// Render a string as GVariant text for `gsettings set`.
pub fn format_string(value: &str) -> String {
    let mut out = String::from("'");
    for ch in value.chars() {
        if ch == '\\' || ch == '\'' {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('\'');
    out
}

/// Render a string list as GVariant `as` text for `gsettings set`.
pub fn format_list(values: &[String]) -> String {
    if values.is_empty() {
        return "@as []".to_string();
    }
    let items: Vec<String> = values.iter().map(|v| format_string(v)).collect();
    format!("[{}]", items.join(", "))
}

/// Quote an executable path for the DESKTOP's shell parser (Cinnamon runs the
/// command through `Util.spawnCommandLine`). Paths with spaces or other shell
/// metacharacters get single quotes; plain paths pass through untouched.
pub fn shell_quote(value: &str) -> String {
    let safe = !value.is_empty()
        && value.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '_' | '@' | '%' | '+' | '=' | ':' | ',' | '.' | '/' | '-')
        });
    if safe {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', r"'\''"))
    }
}

/* ---------------------------------------------------------------- profiles */

/// How the desktop's custom-keybinding list addresses its entries.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ListStyle {
    /// Cinnamon: `custom-list` holds short names (`custom0`).
    ShortNames,
    /// GNOME: `custom-keybindings` holds full dconf paths.
    FullPaths,
}

struct Profile {
    desktop: &'static str,
    /// (schema, key) pairs that may own Print / Shift+Print. Probed at
    /// runtime; only the ones that exist are cleared and backed up.
    owners: &'static [(&'static str, &'static str)],
    /// Where the custom-keybinding list may live (first hit wins).
    list_candidates: &'static [(&'static str, &'static str)],
    child_schema: &'static str,
    path_prefix: &'static str,
    style: ListStyle,
}

const CINNAMON: Profile = Profile {
    desktop: "Cinnamon",
    owners: &[
        ("org.cinnamon.desktop.keybindings.media-keys", "screenshot"),
        (
            "org.cinnamon.desktop.keybindings.media-keys",
            "area-screenshot",
        ),
    ],
    list_candidates: &[("org.cinnamon.desktop.keybindings", "custom-list")],
    child_schema: "org.cinnamon.desktop.keybindings.custom-keybinding",
    path_prefix: "/org/cinnamon/desktop/keybindings/custom-keybindings/",
    style: ListStyle::ShortNames,
};

const GNOME: Profile = Profile {
    desktop: "GNOME",
    owners: &[
        // GNOME 42+: the Shell owns the screenshot keys.
        ("org.gnome.shell.keybindings", "show-screenshot-ui"),
        ("org.gnome.shell.keybindings", "screenshot"),
        // Older GNOME: gnome-settings-daemon's media-keys owned them.
        ("org.gnome.settings-daemon.plugins.media-keys", "screenshot"),
        (
            "org.gnome.settings-daemon.plugins.media-keys",
            "area-screenshot",
        ),
    ],
    list_candidates: &[
        // Modern gnome-settings-daemon: the list is a key on media-keys.
        (
            "org.gnome.settings-daemon.plugins.media-keys",
            "custom-keybindings",
        ),
        // Older layout: a schema of its own.
        (
            "org.gnome.settings-daemon.plugins.media-keys.custom-keybindings",
            "custom-keybindings",
        ),
    ],
    child_schema: "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding",
    path_prefix: "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/",
    style: ListStyle::FullPaths,
};

/// Match `XDG_CURRENT_DESKTOP` (colon-separated, e.g. `X-Cinnamon`,
/// `ubuntu:GNOME`) to a supported profile. Cinnamon first — Mint sets
/// `X-Cinnamon`, which must not fall through to anything else.
fn detect_profile(xdg: &str) -> Option<&'static Profile> {
    for token in xdg.split(':') {
        let token = token.trim().to_ascii_lowercase();
        if token.contains("cinnamon") {
            return Some(&CINNAMON);
        }
        if token.contains("gnome") {
            return Some(&GNOME);
        }
    }
    None
}

fn profile_by_desktop(name: &str) -> Option<&'static Profile> {
    match name {
        "Cinnamon" => Some(&CINNAMON),
        "GNOME" => Some(&GNOME),
        _ => None,
    }
}

/// Cinnamon's `custom-list` change trick: `js/ui/keybindings.js` rebuilds on
/// `changed::custom-list`, and the settings UI toggles a `__dummy__` entry so
/// the signal fires even when the effective list is unchanged. Mimic it.
fn toggle_dummy(list: &mut Vec<String>) {
    if let Some(pos) = list.iter().position(|e| e == "__dummy__") {
        list.remove(pos);
    } else {
        list.push("__dummy__".to_string());
    }
}

/// The slot number of a list entry (`custom3` or `…/custom3/`), if any.
fn slot_number(entry: &str, style: ListStyle) -> Option<u32> {
    let name = match style {
        ListStyle::ShortNames => entry,
        ListStyle::FullPaths => entry.trim_end_matches('/').rsplit('/').next()?,
    };
    name.strip_prefix("custom")?.parse().ok()
}

/// First free `customN` slot, returned in the desktop's own list dialect.
fn first_free_slot(entries: &[String], profile: &Profile) -> String {
    let used: HashSet<u32> = entries
        .iter()
        .filter_map(|e| slot_number(e, profile.style))
        .collect();
    let mut n = 0u32;
    while used.contains(&n) {
        n += 1;
    }
    match profile.style {
        ListStyle::ShortNames => format!("custom{n}"),
        ListStyle::FullPaths => format!("{}custom{n}/", profile.path_prefix),
    }
}

/// Full dconf path of a list entry.
fn entry_path(entry: &str, profile: &Profile) -> String {
    match profile.style {
        ListStyle::ShortNames => format!("{}{entry}/", profile.path_prefix),
        ListStyle::FullPaths => entry.to_string(),
    }
}

/// Whether a custom keybinding is one of ours (name + command suffix). The
/// command check keeps a user-renamed entry recognisable; the name check keeps
/// us from touching another app's `--capture` shortcut.
fn is_ours(name: &str, command: &str) -> bool {
    name.starts_with("SnagCraft")
        && command.to_ascii_lowercase().contains("snagcraft")
        && (command.ends_with("--capture") || command.ends_with("--region"))
}

/* ------------------------------------------------------------------ runner */

/// Anything that can run `gsettings`-style commands. The real runner spawns
/// the binary; tests use a fake or a hermetic keyfile backend.
pub trait SettingsRunner {
    fn run(&self, args: &[String]) -> Result<String, String>;
}

/// The real `gsettings` binary. `extra_env` exists for hermetic tests
/// (`GSETTINGS_BACKEND=keyfile` + a scratch `XDG_CONFIG_HOME`).
pub struct Gsettings {
    pub extra_env: Vec<(String, String)>,
}

impl Gsettings {
    pub fn new() -> Self {
        Self {
            extra_env: Vec::new(),
        }
    }
}

impl Default for Gsettings {
    fn default() -> Self {
        Self::new()
    }
}

impl SettingsRunner for Gsettings {
    fn run(&self, args: &[String]) -> Result<String, String> {
        let mut cmd = std::process::Command::new("gsettings");
        cmd.args(args);
        for (key, value) in &self.extra_env {
            cmd.env(key, value);
        }
        let out = cmd
            .output()
            .map_err(|err| format!("could not run gsettings: {err}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
}

fn arg(values: &[&str]) -> Vec<String> {
    values.iter().map(|s| s.to_string()).collect()
}

fn key_exists(runner: &dyn SettingsRunner, schema: &str, key: &str) -> bool {
    runner.run(&arg(&["range", schema, key])).is_ok()
}

/// Read an `as` key; `Ok(None)` when the schema/key does not exist on this
/// desktop version (GNOME moved things around between releases).
fn read_list(
    runner: &dyn SettingsRunner,
    schema: &str,
    key: &str,
) -> Result<Option<Vec<String>>, String> {
    match runner.run(&arg(&["get", schema, key])) {
        Ok(raw) => Ok(Some(parse_list(&raw))),
        Err(err) if err.contains("No such") => Ok(None),
        Err(err) => Err(format!("reading {schema} {key}: {err}")),
    }
}

fn write_list(
    runner: &dyn SettingsRunner,
    schema: &str,
    key: &str,
    values: &[String],
) -> Result<(), String> {
    runner
        .run(&arg(&["set", schema, key, &format_list(values)]))
        .map(|_| ())
        .map_err(|err| format!("writing {schema} {key}: {err}"))
}

fn read_child_string(
    runner: &dyn SettingsRunner,
    schema: &str,
    path: &str,
    key: &str,
) -> Option<String> {
    runner
        .run(&arg(&["get", &format!("{schema}:{path}"), key]))
        .ok()
        .map(|raw| parse_string(&raw))
}

fn write_child_string(
    runner: &dyn SettingsRunner,
    schema: &str,
    path: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    runner
        .run(&arg(&[
            "set",
            &format!("{schema}:{path}"),
            key,
            &format_string(value),
        ]))
        .map(|_| ())
        .map_err(|err| format!("writing {schema}:{path} {key}: {err}"))
}

fn write_child_list(
    runner: &dyn SettingsRunner,
    schema: &str,
    path: &str,
    key: &str,
    values: &[String],
) -> Result<(), String> {
    runner
        .run(&arg(&[
            "set",
            &format!("{schema}:{path}"),
            key,
            &format_list(values),
        ]))
        .map(|_| ())
        .map_err(|err| format!("writing {schema}:{path} {key}: {err}"))
}

fn reset_child(runner: &dyn SettingsRunner, schema: &str, path: &str) -> Result<(), String> {
    runner
        .run(&arg(&["reset-recursively", &format!("{schema}:{path}")]))
        .map(|_| ())
        .map_err(|err| format!("resetting {schema}:{path}: {err}"))
}

/* ------------------------------------------------------------------ layout */

/// The schema locations that actually exist on this machine.
struct Layout {
    profile: &'static Profile,
    owners: Vec<(String, String)>,
    list_schema: String,
    list_key: String,
}

fn resolve_layout(
    runner: &dyn SettingsRunner,
    profile: &'static Profile,
) -> Result<Layout, String> {
    let owners: Vec<(String, String)> = profile
        .owners
        .iter()
        .filter(|(schema, key)| key_exists(runner, schema, key))
        .map(|(schema, key)| (schema.to_string(), key.to_string()))
        .collect();
    let (list_schema, list_key) = profile
        .list_candidates
        .iter()
        .find(|(schema, key)| key_exists(runner, schema, key))
        .map(|(schema, key)| (schema.to_string(), key.to_string()))
        .ok_or_else(|| {
            "no custom-keybinding settings found on this desktop (gsettings schemas missing)"
                .to_string()
        })?;
    Ok(Layout {
        profile,
        owners,
        list_schema,
        list_key,
    })
}

/* ------------------------------------------------------------------ status */

/// What the settings UI needs to render the default-tool card honestly.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DefaultToolStatus {
    /// False on unsupported desktops / non-Linux — the card stays hidden.
    pub supported: bool,
    /// "Cinnamon" / "GNOME" when supported.
    pub desktop: String,
    /// Our two shortcuts are live AND the built-in bindings are cleared.
    pub is_default: bool,
    /// A backup of the previous system bindings exists (restore is possible).
    pub can_restore: bool,
    /// The command a desktop shortcut will run (AppImage-aware).
    pub command: String,
    /// Honest reason when unsupported; empty otherwise.
    pub detail: String,
}

const UNSUPPORTED_DETAIL: &str = "Only Cinnamon (Linux Mint) and GNOME are supported so far. \
On other desktops, add a custom keyboard shortcut that runs `snagcraft --capture` \
(and `snagcraft --region` for a region).";

/// The executable a desktop shortcut should launch. `$APPIMAGE` is the real
/// file for AppImage runs (the process exe lives in a temporary FUSE mount);
/// installed .deb builds resolve to their /usr/bin path via current_exe.
fn launch_command() -> String {
    if let Ok(path) = std::env::var("APPIMAGE") {
        if !path.is_empty() {
            return path;
        }
    }
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "snagcraft".to_string())
}

/// Where the pre-change backup lives (per-user config, not the webview's
/// localStorage — it must survive a reinstall of the frontend).
fn backup_path() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| {
            let home = std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."));
            home.join(".config")
        });
    base.join("snagcraft").join("default-tool-backup.json")
}

fn read_backup(path: &Path) -> Option<Backup> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// One custom entry we found in the desktop's list.
struct EntryInfo {
    entry: String,
    name: String,
    command: String,
    binding: Vec<String>,
}

fn scan_entries(runner: &dyn SettingsRunner, layout: &Layout, list: &[String]) -> Vec<EntryInfo> {
    let mut out = Vec::new();
    for entry in list {
        if entry == "__dummy__" {
            continue;
        }
        let path = entry_path(entry, layout.profile);
        let Some(name) = read_child_string(runner, layout.profile.child_schema, &path, "name")
        else {
            continue;
        };
        let Some(command) =
            read_child_string(runner, layout.profile.child_schema, &path, "command")
        else {
            continue;
        };
        let binding = read_list(
            runner,
            &format!("{}:{path}", layout.profile.child_schema),
            "binding",
        )
        .ok()
        .flatten()
        .unwrap_or_default();
        out.push(EntryInfo {
            entry: entry.clone(),
            name,
            command,
            binding,
        });
    }
    out
}

fn compute_status(runner: &dyn SettingsRunner, xdg: &str, backup: &Path) -> DefaultToolStatus {
    let unsupported = |detail: &str| DefaultToolStatus {
        supported: false,
        detail: detail.to_string(),
        command: launch_command(),
        ..Default::default()
    };
    let Some(profile) = detect_profile(xdg) else {
        return unsupported(UNSUPPORTED_DETAIL);
    };
    if runner.run(&arg(&["--version"])).is_err() {
        return unsupported("gsettings is not available on this system.");
    }
    let layout = match resolve_layout(runner, profile) {
        Ok(layout) => layout,
        Err(err) => return unsupported(&err),
    };

    let list = read_list(runner, &layout.list_schema, &layout.list_key)
        .ok()
        .flatten()
        .unwrap_or_default();
    let entries = scan_entries(runner, &layout, &list);
    let has_full = entries.iter().any(|e| {
        is_ours(&e.name, &e.command)
            && e.command.ends_with("--capture")
            && e.binding.iter().any(|b| b == "Print")
    });
    let has_region = entries.iter().any(|e| {
        is_ours(&e.name, &e.command)
            && e.command.ends_with("--region")
            && e.binding.iter().any(|b| b == "<Shift>Print")
    });
    let owners_cleared = layout.owners.iter().all(|(schema, key)| {
        read_list(runner, schema, key)
            .ok()
            .flatten()
            .map(|values| !values.iter().any(|v| v == "Print" || v == "<Shift>Print"))
            .unwrap_or(true)
    });

    DefaultToolStatus {
        supported: true,
        desktop: profile.desktop.to_string(),
        is_default: has_full && has_region && owners_cleared,
        can_restore: read_backup(backup).is_some(),
        command: launch_command(),
        detail: String::new(),
    }
}

/* ------------------------------------------------------------------ backup */

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
struct OwnerBackup {
    schema: String,
    key: String,
    values: Vec<String>,
}

/// Everything needed to put the desktop back exactly as it was.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
struct Backup {
    desktop: String,
    owners: Vec<OwnerBackup>,
    list_schema: String,
    list_key: String,
    /// The list WITHOUT any SnagCraft entries (pristine pre-SnagCraft state).
    prev_list: Vec<String>,
    /// Entries we created or reused — reset on restore.
    created: Vec<String>,
}

/* ------------------------------------------------------------- apply/restore */

fn apply(
    runner: &dyn SettingsRunner,
    xdg: &str,
    backup: &Path,
    command: &str,
) -> Result<DefaultToolStatus, String> {
    let profile = detect_profile(xdg).ok_or_else(|| UNSUPPORTED_DETAIL.to_string())?;
    let layout = resolve_layout(runner, profile)?;

    let current_list =
        read_list(runner, &layout.list_schema, &layout.list_key)?.unwrap_or_default();
    let entries = scan_entries(runner, &layout, &current_list);
    let old_full = entries
        .iter()
        .find(|e| is_ours(&e.name, &e.command) && e.command.ends_with("--capture"));
    let old_region = entries
        .iter()
        .find(|e| is_ours(&e.name, &e.command) && e.command.ends_with("--region"));

    // Pristine list: no SnagCraft entries, no dummy marker.
    let prev_list: Vec<String> = current_list
        .iter()
        .filter(|e| {
            e.as_str() != "__dummy__"
                && !entries
                    .iter()
                    .any(|info| &info.entry == *e && is_ours(&info.name, &info.command))
        })
        .cloned()
        .collect();

    // Reuse our existing slots when present (idempotent re-apply), otherwise
    // allocate the first free customN the desktop itself would pick. Both
    // entries must end up in the list whether reused or freshly allocated.
    let mut new_list = prev_list.clone();
    let full_entry = match old_full {
        Some(info) => info.entry.clone(),
        None => first_free_slot(&new_list, profile),
    };
    if !new_list.contains(&full_entry) {
        new_list.push(full_entry.clone());
    }
    let region_entry = match old_region {
        Some(info) => info.entry.clone(),
        None => first_free_slot(&new_list, profile),
    };
    if !new_list.contains(&region_entry) {
        new_list.push(region_entry.clone());
    }

    let owners: Vec<OwnerBackup> = layout
        .owners
        .iter()
        .map(|(schema, key)| {
            let values = read_list(runner, schema, key)
                .ok()
                .flatten()
                .unwrap_or_default();
            OwnerBackup {
                schema: schema.clone(),
                key: key.clone(),
                values,
            }
        })
        .collect();

    // Backup FIRST — if any write below fails, restore still works. Never
    // overwrite an existing backup: a re-apply must preserve the PRISTINE
    // pre-SnagCraft state, not the already-cleared bindings of the first run.
    // Only the created-entry list grows (a slot the user removed in the
    // desktop UI may have been re-allocated under a new name).
    let data = match read_backup(backup) {
        Some(existing) => {
            let mut created = existing.created.clone();
            for entry in [&full_entry, &region_entry] {
                if !created.contains(entry) {
                    created.push(entry.clone());
                }
            }
            Backup {
                created,
                ..existing
            }
        }
        None => Backup {
            desktop: profile.desktop.to_string(),
            owners,
            list_schema: layout.list_schema.clone(),
            list_key: layout.list_key.clone(),
            prev_list,
            created: vec![full_entry.clone(), region_entry.clone()],
        },
    };
    if let Some(parent) = backup.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("could not create the backup folder: {err}"))?;
    }
    let json = serde_json::to_string_pretty(&data)
        .map_err(|err| format!("could not serialise the backup: {err}"))?;
    std::fs::write(backup, json).map_err(|err| format!("could not write the backup: {err}"))?;

    // Children before the list: the desktop must never see a half-filled entry.
    let quoted = shell_quote(command);
    let full_path = entry_path(&full_entry, profile);
    write_child_string(
        runner,
        profile.child_schema,
        &full_path,
        "name",
        "SnagCraft full screen",
    )?;
    write_child_string(
        runner,
        profile.child_schema,
        &full_path,
        "command",
        &format!("{quoted} --capture"),
    )?;
    write_child_list(
        runner,
        profile.child_schema,
        &full_path,
        "binding",
        &["Print".to_string()],
    )?;
    let region_path = entry_path(&region_entry, profile);
    write_child_string(
        runner,
        profile.child_schema,
        &region_path,
        "name",
        "SnagCraft region",
    )?;
    write_child_string(
        runner,
        profile.child_schema,
        &region_path,
        "command",
        &format!("{quoted} --region"),
    )?;
    write_child_list(
        runner,
        profile.child_schema,
        &region_path,
        "binding",
        &["<Shift>Print".to_string()],
    )?;

    if profile.style == ListStyle::ShortNames {
        toggle_dummy(&mut new_list);
    }
    write_list(runner, &layout.list_schema, &layout.list_key, &new_list)?;

    // Only now release the built-in bindings, so Print is never unowned.
    for (schema, key) in &layout.owners {
        write_list(runner, schema, key, &[])?;
    }

    Ok(compute_status(runner, xdg, backup))
}

fn restore(runner: &dyn SettingsRunner, backup: &Path) -> Result<DefaultToolStatus, String> {
    let data =
        read_backup(backup).ok_or_else(|| "no backup found — nothing to restore".to_string())?;
    let profile = profile_by_desktop(&data.desktop)
        .ok_or_else(|| format!("unknown desktop in backup: {}", data.desktop))?;

    for owner in &data.owners {
        write_list(runner, &owner.schema, &owner.key, &owner.values)?;
    }
    let mut list = data.prev_list.clone();
    if profile.style == ListStyle::ShortNames {
        toggle_dummy(&mut list);
    }
    write_list(runner, &data.list_schema, &data.list_key, &list)?;
    for entry in &data.created {
        let path = entry_path(entry, profile);
        reset_child(runner, profile.child_schema, &path)?;
    }
    // Best effort: a leftover file only means "restore" stays offered.
    let _ = std::fs::remove_file(backup);

    let xdg = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    Ok(compute_status(runner, &xdg, backup))
}

/* ---------------------------------------------------------------- commands */

/// What the settings card renders: support, live state, restore availability.
#[tauri::command]
pub fn default_tool_status() -> DefaultToolStatus {
    #[cfg(target_os = "linux")]
    {
        let xdg = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        compute_status(&Gsettings::new(), &xdg, &backup_path())
    }
    #[cfg(not(target_os = "linux"))]
    {
        DefaultToolStatus {
            supported: false,
            detail: "The default-screenshot-tool takeover is available on Linux only.".to_string(),
            ..Default::default()
        }
    }
}

/// Take over Print / Shift+Print (explicit user confirmation in the UI).
/// Backs up every previous value first; `restore_default_screenshot_tool`
/// puts them back.
#[tauri::command]
pub fn set_default_screenshot_tool() -> Result<DefaultToolStatus, String> {
    #[cfg(target_os = "linux")]
    {
        let xdg = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        apply(&Gsettings::new(), &xdg, &backup_path(), &launch_command())
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("The default-screenshot-tool takeover is available on Linux only.".to_string())
    }
}

/// Put the desktop's screenshot bindings back exactly as they were.
#[tauri::command]
pub fn restore_default_screenshot_tool() -> Result<DefaultToolStatus, String> {
    #[cfg(target_os = "linux")]
    {
        restore(&Gsettings::new(), &backup_path())
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("The default-screenshot-tool takeover is available on Linux only.".to_string())
    }
}

/* ------------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[test]
    fn parses_gvariant_lists() {
        assert_eq!(parse_list("@as []"), Vec::<String>::new());
        assert_eq!(parse_list("[]"), Vec::<String>::new());
        assert_eq!(parse_list("['Print']"), vec!["Print"]);
        assert_eq!(
            parse_list("['Print', '<Shift>Print']"),
            vec!["Print", "<Shift>Print"]
        );
        // A comma inside a quoted path must not split the item.
        assert_eq!(parse_list("['/a,b/c']"), vec!["/a,b/c"]);
        assert_eq!(parse_list("['it\\'s']"), vec!["it's"]);
        // Keyfile-backend quirk: relocatable arrays arrive as a quoted string.
        assert_eq!(parse_list("\"['Print']\""), vec!["Print"]);
        assert_eq!(parse_list("\"@as []\""), Vec::<String>::new());
    }

    #[test]
    fn list_format_round_trips() {
        for values in [
            vec![],
            vec!["Print".to_string()],
            vec!["Print".to_string(), "<Shift>Print".to_string()],
            vec!["/path with space/custom0/".to_string()],
            vec!["it's".to_string()],
        ] {
            assert_eq!(parse_list(&format_list(&values)), values);
        }
        assert_eq!(format_list(&[]), "@as []");
    }

    #[test]
    fn string_format_round_trips() {
        for value in [
            "",
            "snagcraft",
            "/usr/bin/snagcraft",
            "it's a 'test'",
            "back\\slash",
        ] {
            assert_eq!(parse_string(&format_string(value)), value);
        }
    }

    #[test]
    fn shell_quoting() {
        assert_eq!(shell_quote("/usr/bin/snagcraft"), "/usr/bin/snagcraft");
        assert_eq!(
            shell_quote("/home/u/My Apps/SnagCraft.AppImage"),
            "'/home/u/My Apps/SnagCraft.AppImage'"
        );
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn detects_desktops() {
        assert_eq!(
            detect_profile("X-Cinnamon").map(|p| p.desktop),
            Some("Cinnamon")
        );
        assert_eq!(
            detect_profile("ubuntu:GNOME").map(|p| p.desktop),
            Some("GNOME")
        );
        assert_eq!(
            detect_profile("GNOME-Classic:GNOME").map(|p| p.desktop),
            Some("GNOME")
        );
        assert_eq!(detect_profile("MATE").map(|p| p.desktop), None);
        assert_eq!(detect_profile("KDE").map(|p| p.desktop), None);
        assert_eq!(detect_profile("").map(|p| p.desktop), None);
    }

    #[test]
    fn allocates_first_free_slot() {
        let short = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(first_free_slot(&short(&[]), &CINNAMON), "custom0");
        assert_eq!(
            first_free_slot(&short(&["custom0", "__dummy__", "custom2"]), &CINNAMON),
            "custom1"
        );
        let full = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            first_free_slot(
                &full(&[
                    "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/"
                ]),
                &GNOME
            ),
            "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/"
        );
    }

    #[test]
    fn entry_paths_and_ownership() {
        assert_eq!(
            entry_path("custom3", &CINNAMON),
            "/org/cinnamon/desktop/keybindings/custom-keybindings/custom3/"
        );
        assert_eq!(entry_path("/x/custom3/", &GNOME), "/x/custom3/");
        assert!(is_ours(
            "SnagCraft full screen",
            "/usr/bin/snagcraft --capture"
        ));
        assert!(is_ours("SnagCraft region", "'/a b/snagcraft' --region"));
        assert!(!is_ours("My shortcut", "/usr/bin/snagcraft --capture"));
        assert!(!is_ours("SnagCraft", "/usr/bin/flameshot --capture"));
    }

    #[test]
    fn dummy_toggle() {
        let mut list = vec!["custom0".to_string()];
        toggle_dummy(&mut list);
        assert!(list.contains(&"__dummy__".to_string()));
        toggle_dummy(&mut list);
        assert!(!list.contains(&"__dummy__".to_string()));
    }

    /* A fake gsettings: enough of the real semantics (get/set/range/reset,
     * relocatable schemas, schema defaults) to drive apply/restore anywhere. */
    #[derive(Default)]
    struct FakeSettings {
        /// (schema[:path], key) → GVariant text.
        values: RefCell<HashMap<(String, String), String>>,
        installed: RefCell<Vec<String>>,
    }

    impl FakeSettings {
        fn install(&self, schema: &str) {
            self.installed.borrow_mut().push(schema.to_string());
        }
        fn set_raw(&self, target: &str, key: &str, raw: &str) {
            self.values
                .borrow_mut()
                .insert((target.to_string(), key.to_string()), raw.to_string());
        }
        fn get_raw(&self, target: &str, key: &str) -> Option<String> {
            self.values
                .borrow()
                .get(&(target.to_string(), key.to_string()))
                .cloned()
        }
        fn schema_of(target: &str) -> &str {
            target.split(':').next().unwrap_or(target)
        }
        fn is_installed(&self, schema: &str) -> bool {
            self.installed.borrow().iter().any(|s| s == schema)
        }
        fn cinnamon() -> Self {
            let fake = Self::default();
            fake.install("org.cinnamon.desktop.keybindings.media-keys");
            fake.install("org.cinnamon.desktop.keybindings");
            fake.install("org.cinnamon.desktop.keybindings.custom-keybinding");
            fake.set_raw(
                "org.cinnamon.desktop.keybindings.media-keys",
                "screenshot",
                "['Print']",
            );
            fake.set_raw(
                "org.cinnamon.desktop.keybindings.media-keys",
                "area-screenshot",
                "['<Shift>Print']",
            );
            fake.set_raw("org.cinnamon.desktop.keybindings", "custom-list", "@as []");
            fake
        }
        fn gnome() -> Self {
            let fake = Self::default();
            fake.install("org.gnome.shell.keybindings");
            fake.install("org.gnome.settings-daemon.plugins.media-keys");
            fake.install("org.gnome.settings-daemon.plugins.media-keys.custom-keybinding");
            fake.set_raw(
                "org.gnome.shell.keybindings",
                "show-screenshot-ui",
                "['Print']",
            );
            fake.set_raw(
                "org.gnome.shell.keybindings",
                "screenshot",
                "['<Shift>Print']",
            );
            fake.set_raw(
                "org.gnome.settings-daemon.plugins.media-keys",
                "custom-keybindings",
                "@as []",
            );
            fake
        }
    }

    impl SettingsRunner for FakeSettings {
        fn run(&self, args: &[String]) -> Result<String, String> {
            let verb = args.first().map(String::as_str).unwrap_or("");
            match verb {
                "--version" => Ok("2.80".to_string()),
                "range" => {
                    let schema = args.get(1).map(String::as_str).unwrap_or("");
                    let key = args.get(2).map(String::as_str).unwrap_or("");
                    if !self.is_installed(Self::schema_of(schema)) {
                        return Err(format!("No such schema \"{schema}\""));
                    }
                    // Relocatable child schemas accept any path; plain keys
                    // must have been seeded (that is how the fake models
                    // "this key exists on this desktop version").
                    if schema.contains(':') || self.get_raw(schema, key).is_some() {
                        Ok("type as".to_string())
                    } else {
                        Err(format!("No such key \"{key}\""))
                    }
                }
                "get" => {
                    let target = args.get(1).map(String::as_str).unwrap_or("");
                    let key = args.get(2).map(String::as_str).unwrap_or("");
                    if !self.is_installed(Self::schema_of(target)) {
                        return Err(format!("No such schema \"{target}\""));
                    }
                    match self.get_raw(target, key) {
                        Some(raw) => Ok(raw),
                        None if target.contains(':') => {
                            // Relocatable defaults.
                            Ok(if key == "binding" {
                                "@as []".into()
                            } else {
                                "''".into()
                            })
                        }
                        None => Err(format!("No such key \"{key}\"")),
                    }
                }
                "set" => {
                    let target = args.get(1).map(String::as_str).unwrap_or("");
                    let key = args.get(2).map(String::as_str).unwrap_or("");
                    let value = args.get(3).map(String::as_str).unwrap_or("");
                    if !self.is_installed(Self::schema_of(target)) {
                        return Err(format!("No such schema \"{target}\""));
                    }
                    self.set_raw(target, key, value);
                    Ok(String::new())
                }
                "reset-recursively" => {
                    let target = args.get(1).map(String::as_str).unwrap_or("");
                    self.values
                        .borrow_mut()
                        .retain(|(t, _), _| t.as_str() != target);
                    Ok(String::new())
                }
                other => Err(format!("fake gsettings: unsupported verb {other}")),
            }
        }
    }

    fn scratch_backup(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("snagcraft-default-tool-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("backup.json")
    }

    #[test]
    fn cinnamon_apply_takeover_and_restore() {
        let fake = FakeSettings::cinnamon();
        let backup = scratch_backup("cinnamon");
        let command = "/usr/bin/snagcraft";

        let status = apply(&fake, "X-Cinnamon", &backup, command).unwrap();
        assert!(status.supported);
        assert!(status.is_default);
        assert!(status.can_restore);

        // Built-in bindings cleared.
        assert_eq!(
            fake.get_raw("org.cinnamon.desktop.keybindings.media-keys", "screenshot")
                .unwrap(),
            "@as []"
        );
        assert_eq!(
            fake.get_raw(
                "org.cinnamon.desktop.keybindings.media-keys",
                "area-screenshot"
            )
            .unwrap(),
            "@as []"
        );
        // Two entries in the list (plus the dummy toggle), children filled.
        let list = parse_list(
            &fake
                .get_raw("org.cinnamon.desktop.keybindings", "custom-list")
                .unwrap(),
        );
        let real: Vec<&String> = list.iter().filter(|e| e.as_str() != "__dummy__").collect();
        assert_eq!(real.len(), 2);
        let full_path = entry_path(real[0], &CINNAMON);
        assert_eq!(
            fake.get_raw(
                &format!("org.cinnamon.desktop.keybindings.custom-keybinding:{full_path}"),
                "command"
            )
            .unwrap(),
            "'/usr/bin/snagcraft --capture'"
        );
        assert_eq!(
            fake.get_raw(
                &format!("org.cinnamon.desktop.keybindings.custom-keybinding:{full_path}"),
                "binding"
            )
            .unwrap(),
            "['Print']"
        );

        // Idempotent re-apply: still exactly two entries, no slot growth.
        let status = apply(&fake, "X-Cinnamon", &backup, command).unwrap();
        assert!(status.is_default);
        let list = parse_list(
            &fake
                .get_raw("org.cinnamon.desktop.keybindings", "custom-list")
                .unwrap(),
        );
        assert_eq!(list.iter().filter(|e| e.as_str() != "__dummy__").count(), 2);

        // Restore: pristine bindings, empty list, children reset, backup gone.
        let status = restore(&fake, &backup).unwrap();
        assert!(!status.is_default);
        assert!(!status.can_restore);
        assert_eq!(
            fake.get_raw("org.cinnamon.desktop.keybindings.media-keys", "screenshot")
                .unwrap(),
            "['Print']"
        );
        assert_eq!(
            fake.get_raw(
                "org.cinnamon.desktop.keybindings.media-keys",
                "area-screenshot"
            )
            .unwrap(),
            "['<Shift>Print']"
        );
        let list = parse_list(
            &fake
                .get_raw("org.cinnamon.desktop.keybindings", "custom-list")
                .unwrap(),
        );
        assert!(list.iter().all(|e| e == "__dummy__"));
        assert!(fake
            .get_raw(
                &format!("org.cinnamon.desktop.keybindings.custom-keybinding:{full_path}"),
                "command"
            )
            .is_none());
        assert!(!backup.exists());
        let _ = std::fs::remove_dir_all(backup.parent().unwrap());
    }

    #[test]
    fn gnome_apply_uses_shell_keys_and_full_paths() {
        let fake = FakeSettings::gnome();
        let backup = scratch_backup("gnome");
        let status = apply(&fake, "ubuntu:GNOME", &backup, "/usr/bin/snagcraft").unwrap();
        assert!(status.is_default);
        assert_eq!(
            fake.get_raw("org.gnome.shell.keybindings", "show-screenshot-ui")
                .unwrap(),
            "@as []"
        );
        assert_eq!(
            fake.get_raw("org.gnome.shell.keybindings", "screenshot")
                .unwrap(),
            "@as []"
        );
        let list = parse_list(
            &fake
                .get_raw(
                    "org.gnome.settings-daemon.plugins.media-keys",
                    "custom-keybindings",
                )
                .unwrap(),
        );
        assert_eq!(list.len(), 2);
        assert!(list[0].starts_with(
            "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom"
        ));
        assert!(list[0].ends_with('/'));
        assert!(!list.iter().any(|e| e == "__dummy__"));

        let status = restore(&fake, &backup).unwrap();
        assert!(!status.is_default);
        assert_eq!(
            fake.get_raw("org.gnome.shell.keybindings", "show-screenshot-ui")
                .unwrap(),
            "['Print']"
        );
        let _ = std::fs::remove_dir_all(backup.parent().unwrap());
    }

    #[test]
    fn preserves_unrelated_custom_shortcuts() {
        let fake = FakeSettings::cinnamon();
        // The user already has a custom0 shortcut of their own.
        fake.set_raw(
            "org.cinnamon.desktop.keybindings",
            "custom-list",
            "['custom0']",
        );
        let path = "/org/cinnamon/desktop/keybindings/custom-keybindings/custom0/";
        fake.set_raw(
            &format!("org.cinnamon.desktop.keybindings.custom-keybinding:{path}"),
            "name",
            "'My terminal'",
        );
        fake.set_raw(
            &format!("org.cinnamon.desktop.keybindings.custom-keybinding:{path}"),
            "command",
            "'gnome-terminal'",
        );
        let backup = scratch_backup("preserve");
        apply(&fake, "X-Cinnamon", &backup, "/usr/bin/snagcraft").unwrap();
        let list = parse_list(
            &fake
                .get_raw("org.cinnamon.desktop.keybindings", "custom-list")
                .unwrap(),
        );
        assert!(list.contains(&"custom0".to_string()));
        assert!(list.contains(&"custom1".to_string()));
        assert!(list.contains(&"custom2".to_string()));
        restore(&fake, &backup).unwrap();
        let list = parse_list(
            &fake
                .get_raw("org.cinnamon.desktop.keybindings", "custom-list")
                .unwrap(),
        );
        let real: Vec<&String> = list.iter().filter(|e| e.as_str() != "__dummy__").collect();
        assert_eq!(real, vec!["custom0"]);
        assert_eq!(
            fake.get_raw(
                &format!("org.cinnamon.desktop.keybindings.custom-keybinding:{path}"),
                "command"
            )
            .unwrap(),
            "'gnome-terminal'"
        );
        let _ = std::fs::remove_dir_all(backup.parent().unwrap());
    }

    #[test]
    fn unsupported_desktops_are_honest() {
        let fake = FakeSettings::cinnamon();
        let backup = scratch_backup("unsupported");
        let status = compute_status(&fake, "MATE", &backup);
        assert!(!status.supported);
        assert!(status.detail.contains("Cinnamon"));
        assert!(apply(&fake, "KDE", &backup, "snagcraft").is_err());
        assert!(restore(&fake, &backup).is_err());
        let _ = std::fs::remove_dir_all(backup.parent().unwrap());
    }

    #[test]
    fn status_reflects_manual_rebinding() {
        let fake = FakeSettings::cinnamon();
        let backup = scratch_backup("rebind");
        apply(&fake, "X-Cinnamon", &backup, "/usr/bin/snagcraft").unwrap();
        // The user (or another tool) re-grabs Print for the system tool.
        fake.set_raw(
            "org.cinnamon.desktop.keybindings.media-keys",
            "screenshot",
            "['Print']",
        );
        let status = compute_status(&fake, "X-Cinnamon", &backup);
        assert!(status.supported);
        assert!(!status.is_default);
        assert!(status.can_restore);
        let _ = std::fs::remove_dir_all(backup.parent().unwrap());
    }

    /* Real gsettings against a hermetic keyfile backend — only runs where the
     * GNOME schemas are installed (pn53). CI runners have no desktop schemas
     * and skip. Nothing touches the live dconf: GSETTINGS_BACKEND=keyfile +
     * a scratch XDG_CONFIG_HOME keep every write in a temp file. */
    #[test]
    fn real_gsettings_keyfile_round_trip() {
        let probe = Gsettings::new();
        if probe.run(&arg(&["--version"])).is_err() {
            return; // no gsettings binary
        }
        if probe
            .run(&arg(&[
                "range",
                "org.gnome.shell.keybindings",
                "show-screenshot-ui",
            ]))
            .is_err()
            || probe
                .run(&arg(&[
                    "range",
                    "org.gnome.settings-daemon.plugins.media-keys",
                    "custom-keybindings",
                ]))
                .is_err()
        {
            return; // GNOME schemas not installed here
        }
        let dir = std::env::temp_dir().join("snagcraft-default-tool-keyfile");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let runner = Gsettings {
            extra_env: vec![
                ("GSETTINGS_BACKEND".to_string(), "keyfile".to_string()),
                (
                    "XDG_CONFIG_HOME".to_string(),
                    dir.to_string_lossy().into_owned(),
                ),
            ],
        };
        let backup = dir.join("backup.json");
        let status = apply(&runner, "GNOME", &backup, "/usr/bin/snagcraft-keyfile-test").unwrap();
        assert!(
            status.supported,
            "keyfile backend should resolve the GNOME layout"
        );
        assert!(status.is_default);
        let cleared = runner
            .run(&arg(&[
                "get",
                "org.gnome.shell.keybindings",
                "show-screenshot-ui",
            ]))
            .unwrap();
        assert_eq!(parse_list(&cleared), Vec::<String>::new());
        let list_raw = runner
            .run(&arg(&[
                "get",
                "org.gnome.settings-daemon.plugins.media-keys",
                "custom-keybindings",
            ]))
            .unwrap();
        let list = parse_list(&list_raw);
        assert_eq!(list.len(), 2);
        let child = format!(
            "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:{}",
            list[0]
        );
        let command = runner.run(&arg(&["get", &child, "command"])).unwrap();
        assert_eq!(
            parse_string(&command),
            "/usr/bin/snagcraft-keyfile-test --capture"
        );

        let status = restore(&runner, &backup).unwrap();
        assert!(!status.is_default);
        let back = runner
            .run(&arg(&[
                "get",
                "org.gnome.shell.keybindings",
                "show-screenshot-ui",
            ]))
            .unwrap();
        assert_eq!(parse_list(&back), vec!["Print"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
