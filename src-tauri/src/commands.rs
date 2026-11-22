//! Tauri command surface — the locked contract with the frontend.
//!
//! | command              | args (camelCase)                     | returns                                  |
//! |----------------------|--------------------------------------|------------------------------------------|
//! | `capture_screenshot` | —                                    | `{ dataUrl, width, height }`             |
//! | `capture_window`     | —                                    | `{ dataUrl, width, height }`             |
//! | `capture_monitor`    | —                                    | `{ dataUrl, width, height }`             |
//! | `save_png`           | `dataUrl`, `suggestedName`           | saved path (`string`)                    |
//! | `copy_png`           | `dataUrl`                            | `void`                                   |
//! | `get_version`        | —                                    | crate version (`string`)                 |
//! | `set_fullscreen`     | `full`                               | `void`                                   |
//! | `default_save_dir`   | —                                    | `<pictures>/SnagCraft` (`string`)         |
//! | `pick_save_dir`      | —                                    | chosen folder (`string`)                 |
//! | `save_png_to_dir`    | `dataUrl`, `dir`, `filename`         | saved path (`string`)                    |
//! | `save_image_as`      | `dataUrl`, `suggestedName`, `format`, `quality` | saved path (`string`)         |
//!
//! `save_image` (PNG/JPEG/WebP + quality) lives in `export.rs`; the close-guard
//! commands (`force_close`, `set_dirty`, `is_dirty`, `set_minimize_to_tray`,
//! `get_minimize_to_tray`) live in `windows.rs`; the screen-recording commands
//! (`start_recording`, `stop_recording`, `is_recording`) live in `recording.rs`.
//!
//! `dataUrl` is always a full `data:image/png;base64,…` URL. Errors become
//! rejected promises carrying the message string.

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

/// What `capture_screenshot` hands the frontend (serialized camelCase).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

/// How long to let the compositor redraw after hiding our own window before
/// grabbing the screen. Short enough to feel instant, long enough that the
/// window (and its shadow/animation) is genuinely gone — otherwise repeated
/// captures would nest the app inside its own screenshot.
const HIDE_SETTLE_MS: u64 = 220;

/// Hide the app's own windows (main + floating widget) while a capture runs, so
/// neither ends up in the shot — and so the widget can't be the only SnagCraft
/// window left on screen (which made it look like it "popped up" during a window
/// pick). Returns whether the widget was visible so it can be restored after.
fn hide_app_windows(app: &tauri::AppHandle) -> bool {
    use tauri::Manager as _;
    let widget_visible = app
        .get_webview_window("widget")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    if widget_visible {
        if let Some(widget) = app.get_webview_window("widget") {
            let _ = widget.hide();
        }
    }
    widget_visible
}

/// Restore the windows hidden by [`hide_app_windows`], on every code path.
fn restore_app_windows(app: &tauri::AppHandle, widget_visible: bool) {
    use tauri::Manager as _;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    if widget_visible {
        if let Some(widget) = app.get_webview_window("widget") {
            let _ = widget.show();
        }
    }
}

#[tauri::command]
pub async fn capture_screenshot(app: tauri::AppHandle) -> Result<CaptureResult, String> {
    let widget_visible = hide_app_windows(&app);
    tokio::time::sleep(std::time::Duration::from_millis(HIDE_SETTLE_MS)).await;

    // Capture first, restore second, return last: the restore must happen on
    // both the success and the error path, so no window can be left hidden
    // behind a failed screenshot.
    let captured = crate::capture::capture_full().await;

    restore_app_windows(&app, widget_visible);

    let (data_url, width, height) = captured.map_err(|e| e.to_string())?;
    Ok(CaptureResult {
        data_url,
        width,
        height,
    })
}

/// Grab one user-picked window as a PNG data URL (Wave 10).
///
/// Same hide/settle/restore dance as [`capture_screenshot`]: our own window must
/// not appear in the shot — and for a window capture it would otherwise be the
/// most recent entry in the picker's window list. The OS picker then lists every
/// open window and the user chooses one.
#[tauri::command]
pub async fn capture_window(app: tauri::AppHandle) -> Result<CaptureResult, String> {
    grabbing(app, crate::capture::capture_window).await
}

/// Grab one user-picked monitor as a PNG data URL (Wave 10).
///
/// The picker lists every connected output, so multi-monitor setups choose the
/// display here rather than being stuck with the primary one.
#[tauri::command]
pub async fn capture_monitor(app: tauri::AppHandle) -> Result<CaptureResult, String> {
    grabbing(app, crate::capture::capture_monitor).await
}

/// Enumerate connected displays for the in-app screen chooser (issue #1).
///
/// Linux returns an empty list — there the desktop portal owns the picking.
#[tauri::command]
pub async fn list_monitors() -> Result<Vec<crate::capture::MonitorInfo>, String> {
    crate::capture::list_monitors()
        .await
        .map_err(|e| e.to_string())
}

/// Grab one monitor by its `list_monitors` index (Windows/macOS, issue #1).
///
/// Same hide/settle/restore dance as every other still grab.
#[tauri::command]
pub async fn capture_monitor_index(
    app: tauri::AppHandle,
    index: usize,
) -> Result<CaptureResult, String> {
    grabbing(app, move || crate::capture::capture_monitor_index(index)).await
}

/// List capturable windows for the in-app window chooser.
///
/// Linux returns an empty list — there the ScreenCast portal owns the picking.
#[tauri::command]
pub async fn list_windows() -> Result<Vec<crate::capture::WindowInfo>, String> {
    crate::capture::list_windows()
        .await
        .map_err(|e| e.to_string())
}

/// Grab one window by its `list_windows` id (Windows/macOS).
#[tauri::command]
pub async fn capture_window_id(app: tauri::AppHandle, id: u32) -> Result<CaptureResult, String> {
    grabbing(app, move || crate::capture::capture_window_id(id)).await
}

/// Hide the main window, run `grab`, restore the window, then map the result.
///
/// Restore happens before the error is returned, so a failed or cancelled grab
/// can never leave the app hidden.
async fn grabbing<F, Fut>(app: tauri::AppHandle, grab: F) -> Result<CaptureResult, String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<(String, u32, u32)>>,
{
    let widget_visible = hide_app_windows(&app);
    tokio::time::sleep(std::time::Duration::from_millis(HIDE_SETTLE_MS)).await;

    let captured = grab().await;

    restore_app_windows(&app, widget_visible);

    let (data_url, width, height) = captured.map_err(|e| e.to_string())?;
    Ok(CaptureResult {
        data_url,
        width,
        height,
    })
}

/// Ask the user where to save, then write the PNG there and return the path.
///
/// `blocking_save_file` is safe here: async commands run off the Tauri main
/// thread, and the plugin hops to the main thread for the native dialog itself.
#[tauri::command]
pub async fn save_png(
    app: tauri::AppHandle,
    data_url: String,
    suggested_name: String,
) -> Result<String, String> {
    let png = crate::capture::decode_png_data_url(&data_url).map_err(|e| e.to_string())?;
    // Validate before showing a dialog so a corrupt payload never produces an
    // empty file the user thinks they saved.
    image::load_from_memory(&png).map_err(|e| format!("invalid PNG payload: {e}"))?;

    let file_name = if suggested_name.trim().is_empty() {
        "snagcraft.png".to_string()
    } else {
        suggested_name
    };

    let chosen = app
        .dialog()
        .file()
        .add_filter("PNG image", &["png"])
        .set_file_name(&file_name)
        .blocking_save_file()
        .ok_or_else(|| "save cancelled".to_string())?;

    let path = chosen
        .into_path()
        .map_err(|e| format!("unsupported save location: {e}"))?;

    std::fs::write(&path, &png).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Save As: encode as the requested format, then write it wherever the user
/// points the native save dialog.
///
/// The payload is validated and encoded *before* the dialog opens, so a bad
/// format or corrupt PNG fails without making the user dismiss a dialog first,
/// and a cancelled dialog costs no encoding work. `blocking_save_file` is safe
/// here for the same reason as [`save_png`]: async commands run off the Tauri
/// main thread and the plugin hops back for the native dialog itself.
#[tauri::command]
pub async fn save_image_as(
    app: tauri::AppHandle,
    data_url: String,
    suggested_name: String,
    format: String,
    quality: u8,
) -> Result<String, String> {
    let encoded = crate::export::encode_data_url(&data_url, &format, quality)?;

    // The dialog's suggested name must not smuggle a path or a foreign
    // extension in; `safe_filename` reduces it to a bare name that agrees with
    // the encoded bytes. Either way the chosen path is re-checked below.
    let suggested = if suggested_name.trim().is_empty() {
        format!("snagcraft.{}", encoded.format.extension())
    } else {
        crate::export::safe_filename(&suggested_name, encoded.format)
    };

    let chosen = app
        .dialog()
        .file()
        .add_filter(encoded.format.label(), encoded.format.extensions())
        .set_file_name(&suggested)
        .blocking_save_file()
        .ok_or_else(|| "save cancelled".to_string())?;

    let path = chosen
        .into_path()
        .map_err(|e| format!("unsupported save location: {e}"))?;
    // The user may have typed (or the OS appended) something else; the bytes
    // decide the real format, so the path follows them.
    let path = crate::export::ensure_extension(&path, encoded.format);

    std::fs::write(&path, &encoded.bytes)
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// The folder a screenshot lands in when the user picks "default save location":
/// `<Pictures>/SnagCraft`. Purely a suggestion — nothing is created here, because
/// `save_png_to_dir` does the `create_dir_all` once a save actually happens.
#[tauri::command]
pub fn default_save_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager as _;

    let resolver = app.path();
    let pictures = resolver
        .picture_dir()
        .or_else(|_| resolver.home_dir().map(|home| home.join("Pictures")))
        .map_err(|e| format!("cannot resolve a pictures directory: {e}"))?;

    let dir = pictures.join("SnagCraft");
    // The app was renamed from Capicorn: adopt the old capture folder once so the
    // user's screenshots don't look lost. Same parent, so the rename is atomic.
    let legacy = pictures.join("Capicorn");
    if !dir.exists() && legacy.is_dir() {
        let _ = std::fs::rename(&legacy, &dir);
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Ask the user for a folder (no file selection) and hand the path back.
#[tauri::command]
pub async fn pick_save_dir(app: tauri::AppHandle) -> Result<String, String> {
    let chosen = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .ok_or_else(|| "cancelled".to_string())?;

    let path = chosen
        .into_path()
        .map_err(|e| format!("unsupported folder selection: {e}"))?;

    Ok(path.to_string_lossy().into_owned())
}

/// Write a screenshot into `dir` under `filename`, creating `dir` if needed.
///
/// Thin PNG-only wrapper over `export::write_export`: same decode/validate,
/// filename sanitising and `create_dir_all`, with the extension forced to
/// `.png`. The PNG bytes are written verbatim (no re-encode).
#[tauri::command]
pub async fn save_png_to_dir(
    data_url: String,
    dir: String,
    filename: String,
) -> Result<String, String> {
    crate::export::write_export(&data_url, &dir, &filename, "png", 100)
}

/// Read an image file from disk as a PNG data URL (File → Open).
///
/// Everything is normalised to PNG so the editor sees exactly the format a
/// capture produces — a JPEG or WebP on disk still arrives as one shape, and the
/// annotation pipeline never has to special-case a MIME type.
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<String, String> {
    let path = std::path::PathBuf::from(path.trim());
    let bytes = std::fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|e| format!("{} is not an image SnagCraft can read: {e}", path.display()))?;
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("cannot encode the image: {e}"))?;
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(format!("{}{}", crate::capture::PNG_DATA_URL_PREFIX, b64))
}

#[tauri::command]
pub async fn copy_png(data_url: String) -> Result<(), String> {
    crate::clipboard::copy_png_data_url(&data_url).map_err(|e| e.to_string())
}

/// One file in the save folder, shaped for the Recent strip.
#[derive(serde::Serialize)]
pub struct FolderMedia {
    /// Absolute path — what the frontend hands back to open it.
    pub path: String,
    /// File name shown in the tooltip.
    pub name: String,
    /// `"image"` or `"video"`.
    pub kind: String,
    /// Modification time, ms since the epoch (sort key for the strip).
    pub modified: u64,
    /// Small PNG data URL, or empty when no thumbnail could be built.
    pub thumb: String,
}

/// Image extensions the strip can show, and the ones it treats as video.
const MEDIA_IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "avif", "tif", "tiff"];
const MEDIA_VIDEO_EXTS: &[&str] = &["mp4", "webm", "mov", "mkv", "gif"];
/// Newest first, capped so a huge folder can't stall the strip.
const MEDIA_LIMIT: usize = 60;
/// Video thumbnails shell out to ffmpeg; only the newest few get one.
const MEDIA_VIDEO_THUMBS: usize = 8;

/// Small PNG data URL for an image file (240 px box, aspect kept).
fn image_thumb(path: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let image = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let thumb = image.thumbnail(240, 240);
    let mut png = Vec::new();
    thumb
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    use base64::Engine as _;
    Ok(format!(
        "{}{}",
        crate::capture::PNG_DATA_URL_PREFIX,
        base64::engine::general_purpose::STANDARD.encode(&png)
    ))
}

/// Every image/recording file directly inside `dir`, with its mtime.
///
/// Pure and synchronous so the filtering rules are unit-testable without a
/// Tauri handle (the command wrapping it is async only for the picker's sake).
fn scan_media(
    dir: &std::path::Path,
) -> Result<Vec<(std::path::PathBuf, bool, std::time::SystemTime)>, String> {
    let mut files: Vec<(std::path::PathBuf, bool, std::time::SystemTime)> = Vec::new();
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
        else {
            continue;
        };
        let is_video = if MEDIA_VIDEO_EXTS.contains(&ext.as_str()) {
            true
        } else if MEDIA_IMAGE_EXTS.contains(&ext.as_str()) {
            false
        } else {
            continue;
        };
        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        files.push((path, is_video, modified));
    }
    Ok(files)
}

/// List the images and recordings in `dir`, newest first, for the Recent strip.
///
/// The folder is the source of truth after a save: a capture made in a previous
/// session still shows up here, which is the point of a history.
#[tauri::command]
pub async fn list_folder_media(dir: String) -> Result<Vec<FolderMedia>, String> {
    let dir = std::path::PathBuf::from(dir.trim());
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files = scan_media(&dir)?;
    files.sort_by_key(|(_, _, modified)| std::cmp::Reverse(*modified));
    files.truncate(MEDIA_LIMIT);

    let mut out = Vec::with_capacity(files.len());
    let mut video_thumbs = 0;
    for (path, is_video, modified) in files {
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        let modified = modified
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0);
        let thumb = if is_video {
            if video_thumbs < MEDIA_VIDEO_THUMBS {
                video_thumbs += 1;
                recording_thumb(path.to_string_lossy().into_owned()).unwrap_or_default()
            } else {
                String::new()
            }
        } else {
            image_thumb(&path).unwrap_or_default()
        };
        out.push(FolderMedia {
            path: path.to_string_lossy().into_owned(),
            name,
            kind: if is_video { "video" } else { "image" }.to_string(),
            modified,
            thumb,
        });
    }
    Ok(out)
}

/// Copy plain text (an upload link) to the clipboard.
#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Toggle true fullscreen on the main window.
///
/// The frontend uses this so a whole-screen region capture isn't competing with
/// the window's own chrome. A missing window (already closing) is not an error:
/// there is simply nothing left to resize.
#[tauri::command]
pub fn set_fullscreen(app: tauri::AppHandle, full: bool) -> Result<(), String> {
    use tauri::Manager as _;

    if let Some(win) = app.get_webview_window("main") {
        win.set_fullscreen(full).map_err(|e| e.to_string())?;
    }
    Ok(())
}
/// Collect recording diagnostics — the portal log and the most recent per-take
/// `.rec.log` — into one string the user can paste into a bug report.
#[tauri::command]
pub fn recording_diagnostics(app: tauri::AppHandle) -> String {
    use tauri::Manager as _;

    let mut out = String::from("=== SnagCraft recording diagnostics ===\n");

    let home = app.path().home_dir().ok().unwrap_or_default();
    let portal = home.join(".cache").join("snagcraft-portal.log");
    out.push_str(&format!("\n--- portal log ({}) ---\n", portal.display()));
    match std::fs::read_to_string(&portal) {
        Ok(s) => out.push_str(s.trim_end()),
        Err(e) => out.push_str(&format!("(could not read: {e})")),
    }
    out.push('\n');

    let dir = default_save_dir(app.clone())
        .ok()
        .map(std::path::PathBuf::from);
    let newest = dir.as_ref().and_then(|dir| {
        std::fs::read_dir(dir).ok().and_then(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().ends_with(".rec.log"))
                .filter_map(|e| {
                    let m = e.metadata().ok()?.modified().ok()?;
                    Some((m, e.path()))
                })
                .max_by_key(|(m, _)| *m)
                .map(|(_, p)| p)
        })
    });
    match newest {
        Some(p) => {
            out.push_str(&format!("\n--- latest take log ({}) ---\n", p.display()));
            match std::fs::read_to_string(&p) {
                Ok(s) => out.push_str(s.trim_end()),
                Err(e) => out.push_str(&format!("(could not read: {e})")),
            }
        }
        None => out.push_str("\n(no per-take .rec.log found yet)"),
    }
    out
}

/// Open a file (or folder) with the OS default handler — used by the recent
/// filmstrip's video entries.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("{} does not exist", p.display()));
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("could not open {}: {e}", p.display()))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("could not open {}: {e}", p.display()))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("could not open {}: {e}", p.display()))?;
    }
    Ok(())
}

/// One frame from a recording as a PNG data URL, for the recent filmstrip.
#[tauri::command]
pub fn recording_thumb(path: String) -> Result<String, String> {
    use std::process::{Command, Stdio};

    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("{} does not exist", p.display()));
    }
    let out = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&p)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=320:-2",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg failed: {e}"))?;
    if !out.status.success() || out.stdout.is_empty() {
        return Err(format!(
            "ffmpeg could not read {}: {}",
            p.display(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&out.stdout);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_result_serializes_camel_case() {
        let value = serde_json::to_value(CaptureResult {
            data_url: "data:image/png;base64,AA".into(),
            width: 1,
            height: 2,
        })
        .expect("serialize CaptureResult");

        assert_eq!(value["dataUrl"], "data:image/png;base64,AA");
        assert_eq!(value["width"], 1);
        assert_eq!(value["height"], 2);
        assert!(value.get("data_url").is_none(), "frontend expects dataUrl");
    }

    #[test]
    fn version_is_reported() {
        assert!(!get_version().is_empty());
    }
}

#[cfg(test)]
mod folder_media_tests {
    use super::*;

    /// A 2×2 PNG on disk, so `image_thumb` has something real to decode.
    fn write_png(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
        let png = image::RgbaImage::from_pixel(2, 2, image::Rgba([200, 40, 40, 255]));
        let path = dir.join(name);
        png.save(&path).expect("write png");
        path
    }

    #[test]
    fn scan_media_keeps_images_and_videos_and_drops_the_rest() {
        let dir = std::env::temp_dir().join(format!("snagcraft-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");

        write_png(&dir, "a.png");
        std::fs::write(dir.join("b.mp4"), b"not really a video").expect("write mp4");
        std::fs::write(dir.join("notes.txt"), b"ignore me").expect("write txt");
        std::fs::create_dir_all(dir.join("nested")).expect("nested dir");

        let files = scan_media(&dir).expect("scan");
        let names: Vec<String> = files
            .iter()
            .map(|(path, _, _)| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();

        assert!(
            names.contains(&"a.png".to_string()),
            "image kept: {names:?}"
        );
        assert!(
            names.contains(&"b.mp4".to_string()),
            "video kept: {names:?}"
        );
        assert!(
            !names.contains(&"notes.txt".to_string()),
            "txt dropped: {names:?}"
        );
        assert_eq!(names.len(), 2, "nested dirs are not walked: {names:?}");
        assert!(
            files
                .iter()
                .any(|(path, is_video, _)| path.ends_with("b.mp4") && *is_video),
            "mp4 classified as video"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn image_thumb_is_a_png_data_url() {
        let dir = std::env::temp_dir().join(format!("snagcraft-thumb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = write_png(&dir, "thumb.png");

        let url = image_thumb(&path).expect("thumb");
        assert!(
            url.starts_with(crate::capture::PNG_DATA_URL_PREFIX),
            "prefix"
        );
        let png = crate::capture::decode_png_data_url(&url).expect("decodes");
        assert!(!png.is_empty(), "payload present");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_folder_is_not_an_error() {
        // The command returns an empty list for a folder that isn't there yet.
        assert!(scan_media(std::path::Path::new("/nonexistent/snagcraft/nope")).is_err());
    }
}
