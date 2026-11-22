//! Screen capture backends.
//! Linux: xdg-desktop-portal Screenshot via ashpd (Wayland-native, works on
//! GNOME/KDE Wayland without XWayland portal shims).
//! macOS/Windows: xcap.
//!
//! `capture_full` returns a PNG data URL plus the image dimensions; the same
//! data-URL helpers are reused by `clipboard` and `commands` so the whole
//! pipeline speaks exactly one format.

/// Prefix of every data URL this app produces/consumes.
pub const PNG_DATA_URL_PREFIX: &str = "data:image/png;base64,";

/// Capture the full primary screen. Returns (png_data_url, width, height).
#[cfg(target_os = "linux")]
pub async fn capture_full() -> anyhow::Result<(String, u32, u32)> {
    use ashpd::desktop::screenshot::Screenshot;

    let resp = Screenshot::request().interactive(false).send().await?;
    let shot = resp.response()?;
    // ashpd 0.14 exposes the portal's reply as a string-backed `Uri` (no
    // `to_file_path`), so the conversion lives here.
    let path = file_uri_to_path(shot.uri().as_str())?;
    let bytes = std::fs::read(&path)?;
    png_bytes_to_data_url(&bytes)
}

/// Capture the full virtual screen on macOS/Windows through xcap: every
/// connected monitor is grabbed and composited at its virtual-desktop position,
/// so multi-monitor setups get one image spanning all screens (issue #1).
#[cfg(not(target_os = "linux"))]
pub async fn capture_full() -> anyhow::Result<(String, u32, u32)> {
    let monitors = xcap::Monitor::all()?;
    if monitors.is_empty() {
        anyhow::bail!("no monitors reported by the display server");
    }
    let mut shots = Vec::with_capacity(monitors.len());
    for monitor in &monitors {
        shots.push(MonitorShot {
            x: monitor.x()?,
            y: monitor.y()?,
            img: monitor.capture_image()?,
        });
    }
    let composed = compose_shots(&shots);
    let mut png = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png);
    image::DynamicImage::ImageRgba8(composed)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| anyhow::anyhow!("failed to encode screenshot as PNG: {e}"))?;
    png_bytes_to_data_url(&png)
}

/// One grabbed monitor at its virtual-desktop position (physical pixels).
///
/// Only Windows/macOS `capture_full` constructs this; it stays cross-platform
/// (with the lint silenced) so the compose tests run on Linux CI too.
#[allow(dead_code)]
pub struct MonitorShot {
    pub x: i32,
    pub y: i32,
    pub img: image::RgbaImage,
}

/// Composite monitor grabs into one image spanning the virtual desktop.
///
/// Coordinates are normalised so the top-left of the bounding box becomes
/// (0, 0); gaps between non-adjacent monitors stay opaque black. Pure and
/// platform-independent so it is unit-testable everywhere.
#[allow(dead_code)]
pub fn compose_shots(shots: &[MonitorShot]) -> image::RgbaImage {
    let Some(first) = shots.first() else {
        return image::RgbaImage::new(1, 1);
    };
    let min_x = shots.iter().map(|s| s.x).min().unwrap_or(first.x);
    let min_y = shots.iter().map(|s| s.y).min().unwrap_or(first.y);
    let max_x = shots
        .iter()
        .map(|s| s.x.saturating_add(s.img.width() as i32))
        .max()
        .unwrap_or(min_x + 1);
    let max_y = shots
        .iter()
        .map(|s| s.y.saturating_add(s.img.height() as i32))
        .max()
        .unwrap_or(min_y + 1);
    let width = (max_x - min_x).max(1) as u32;
    let height = (max_y - min_y).max(1) as u32;

    let mut canvas = image::RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 255]));
    for shot in shots {
        let dx = (shot.x - min_x).max(0) as u32;
        let dy = (shot.y - min_y).max(0) as u32;
        for (sx, sy, px) in shot.img.enumerate_pixels() {
            let (tx, ty) = (dx.saturating_add(sx), dy.saturating_add(sy));
            if tx < width && ty < height {
                canvas.put_pixel(tx, ty, *px);
            }
        }
    }
    canvas
}

/// Metadata for one connected display, in virtual-desktop coordinates
/// (physical pixels). Frontend monitor pickers render from this.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub is_primary: bool,
}

/// Enumerate connected displays.
///
/// Linux returns an EMPTY list by design: there the desktop portal owns screen
/// selection (its picker shows the real outputs), so an in-app list would be a
/// second, worse picker. Windows/macOS return every xcap-reported monitor.
#[cfg(target_os = "linux")]
pub async fn list_monitors() -> anyhow::Result<Vec<MonitorInfo>> {
    Ok(Vec::new())
}

/// Windows/macOS monitor enumeration through xcap (issue #1).
#[cfg(not(target_os = "linux"))]
pub async fn list_monitors() -> anyhow::Result<Vec<MonitorInfo>> {
    let mut out = Vec::new();
    for monitor in xcap::Monitor::all()? {
        let name = monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .unwrap_or_else(|_| "Display".to_string());
        out.push(MonitorInfo {
            name,
            x: monitor.x()?,
            y: monitor.y()?,
            width: monitor.width()?,
            height: monitor.height()?,
            scale_factor: monitor.scale_factor()?,
            is_primary: monitor.is_primary()?,
        });
    }
    Ok(out)
}

/// Capture one monitor by its [`list_monitors`] index (Windows/macOS).
#[cfg(not(target_os = "linux"))]
pub async fn capture_monitor_index(index: usize) -> anyhow::Result<(String, u32, u32)> {
    let monitors = xcap::Monitor::all()?;
    let Some(monitor) = monitors.get(index) else {
        anyhow::bail!(
            "monitor {index} is no longer connected ({} present)",
            monitors.len()
        );
    };
    let rgba = monitor.capture_image()?;
    let mut png = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png);
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| anyhow::anyhow!("failed to encode screenshot as PNG: {e}"))?;
    png_bytes_to_data_url(&png)
}

/// Linux picks monitors in the portal dialog, never by index.
#[cfg(target_os = "linux")]
pub async fn capture_monitor_index(_index: usize) -> anyhow::Result<(String, u32, u32)> {
    anyhow::bail!(
        "monitor capture by index is not used on Linux — the portal picker selects the screen"
    )
}

/// Metadata for one capturable window (Windows/macOS window chooser).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
}

/// List capturable windows.
///
/// Linux returns an EMPTY list by design — the ScreenCast portal owns window
/// picking there. Windows/macOS get every visible window except our own.
#[cfg(target_os = "linux")]
pub async fn list_windows() -> anyhow::Result<Vec<WindowInfo>> {
    Ok(Vec::new())
}

/// Windows/macOS window enumeration through xcap.
///
/// Filtered: our own process (the picker would list the app itself), minimised
/// windows (stale or failed grabs), and zero-sized/untitled ghost entries the
/// OS keeps for shells and tooling.
#[cfg(not(target_os = "linux"))]
pub async fn list_windows() -> anyhow::Result<Vec<WindowInfo>> {
    let mut out = Vec::new();
    let own_pid = std::process::id();
    for window in xcap::Window::all()? {
        if window.pid().unwrap_or(0) == own_pid {
            continue;
        }
        if window.is_minimized().unwrap_or(false) {
            continue;
        }
        let (width, height) = (window.width().unwrap_or(0), window.height().unwrap_or(0));
        if width == 0 || height == 0 {
            continue;
        }
        let title = window.title().unwrap_or_default();
        let app_name = window.app_name().unwrap_or_default();
        if title.trim().is_empty() && app_name.trim().is_empty() {
            continue;
        }
        out.push(WindowInfo {
            id: window.id()?,
            app_name,
            title,
            width,
            height,
        });
    }
    Ok(out)
}

/// Capture one window by its [`list_windows`] id (Windows/macOS).
#[cfg(not(target_os = "linux"))]
pub async fn capture_window_id(id: u32) -> anyhow::Result<(String, u32, u32)> {
    // No await inside this fn: the non-Send xcap Window list must not live
    // across a suspension point (same trap as capture_monitor).
    let Some(window) = xcap::Window::all()?
        .into_iter()
        .find(|w| w.id().is_ok_and(|wid| wid == id))
    else {
        anyhow::bail!("window {id} is gone — it may have been closed");
    };
    let rgba = window.capture_image()?;
    let mut png = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png);
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| anyhow::anyhow!("failed to encode screenshot as PNG: {e}"))?;
    png_bytes_to_data_url(&png)
}

/// Linux picks windows in the portal dialog, never by id.
#[cfg(target_os = "linux")]
pub async fn capture_window_id(_id: u32) -> anyhow::Result<(String, u32, u32)> {
    anyhow::bail!(
        "window capture by id is not used on Linux — the portal picker selects the window"
    )
}

/// One user-picked window, grabbed as a single frame (Wave 10).
///
/// The *Screenshot* portal can only grab whole screens, so this goes through the
/// *ScreenCast* portal with `SourceType::WINDOW`: the OS picker lists the open
/// windows and the user chooses one. Returns (png_data_url, width, height).
#[cfg(target_os = "linux")]
pub async fn capture_window() -> anyhow::Result<(String, u32, u32)> {
    grab_one(crate::portal_capture::SourceKind::Window).await
}

/// One user-picked monitor (same portal path as [`capture_window`], with
/// `SourceType::MONITOR`) — multi-monitor setups pick the output in the OS
/// dialog.
#[cfg(target_os = "linux")]
pub async fn capture_monitor() -> anyhow::Result<(String, u32, u32)> {
    grab_one(crate::portal_capture::SourceKind::Monitor).await
}

/// Grab one frame through the ScreenCast portal and encode it as a PNG data URL.
#[cfg(target_os = "linux")]
async fn grab_one(kind: crate::portal_capture::SourceKind) -> anyhow::Result<(String, u32, u32)> {
    let frame = crate::portal_capture::grab(kind)
        .await
        .map_err(anyhow::Error::msg)?;
    rgb24_to_data_url(&frame.rgb, frame.width, frame.height)
}

/// Encode a tightly-packed `rgb24` buffer as a PNG data URL.
///
/// Validates the buffer length first: `RgbImage::from_raw` returns `None` on a
/// short buffer, and handing that to the encoder would be a silent blank image.
pub fn rgb24_to_data_url(
    rgb: &[u8],
    width: u32,
    height: u32,
) -> anyhow::Result<(String, u32, u32)> {
    let expected = width as usize * height as usize * 3;
    if width == 0 || height == 0 || rgb.len() < expected {
        anyhow::bail!(
            "captured frame is {} bytes, expected {expected} for {width}x{height}",
            rgb.len()
        );
    }

    let image = image::RgbImage::from_raw(width, height, rgb[..expected].to_vec())
        .ok_or_else(|| anyhow::anyhow!("cannot build a {width}x{height} RGB image"))?;

    let mut png = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png);
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| anyhow::anyhow!("failed to encode the captured frame as PNG: {e}"))?;

    png_bytes_to_data_url(&png)
}

/// Window capture on Windows/macOS goes through the in-app chooser: the
/// frontend lists [`list_windows`] and calls [`capture_window_id`]. This
/// fallback stays honest if it is reached anyway.
#[cfg(not(target_os = "linux"))]
pub async fn capture_window() -> anyhow::Result<(String, u32, u32)> {
    anyhow::bail!("pick a window in the window chooser")
}

/// One monitor on Windows/macOS: a lone display is grabbed directly; with
/// several, the frontend shows its own picker (fed by [`list_monitors`]) and
/// calls [`capture_monitor_index`] — this fallback stays honest if it is
/// reached anyway.
#[cfg(not(target_os = "linux"))]
pub async fn capture_monitor() -> anyhow::Result<(String, u32, u32)> {
    // Count and DROP the monitor list before any await: xcap's Windows Monitor
    // holds a raw HMONITOR (`*mut c_void`), so keeping it across an await makes
    // the whole Tauri command future non-Send.
    let count = xcap::Monitor::all()?.len();
    match count {
        0 => anyhow::bail!("no monitors reported by the display server"),
        1 => capture_monitor_index(0).await,
        n => anyhow::bail!("{n} monitors connected — pick one in the screen chooser"),
    }
}

/// Convert the portal's `file://` URI into a local path.
///
/// ashpd 0.14 models URIs as an opaque string, so decoding happens here:
/// scheme, optional `localhost` authority, query/fragment, then percent-escapes
/// into raw OS bytes (paths may legitimately be non-UTF-8).
pub fn file_uri_to_path(uri: &str) -> anyhow::Result<std::path::PathBuf> {
    let rest = uri
        .strip_prefix("file://")
        .ok_or_else(|| anyhow::anyhow!("screenshot portal returned a non-file uri: {uri}"))?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    if !rest.starts_with('/') {
        anyhow::bail!("file uri without an absolute path: {uri}");
    }

    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt as _;
        Ok(std::path::PathBuf::from(std::ffi::OsString::from_vec(
            percent_decode(rest),
        )))
    }
    #[cfg(not(unix))]
    {
        Ok(std::path::PathBuf::from(rest.to_string()))
    }
}

#[cfg(unix)]
fn percent_decode(input: &str) -> Vec<u8> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

/// Wrap raw PNG bytes into `data:image/png;base64,…`, validating the image so
/// callers always get real dimensions.
pub fn png_bytes_to_data_url(bytes: &[u8]) -> anyhow::Result<(String, u32, u32)> {
    use base64::Engine as _;

    let img = image::load_from_memory(bytes)
        .map_err(|e| anyhow::anyhow!("captured data is not a decodable image: {e}"))?;
    let (width, height) = (img.width(), img.height());
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok((format!("{PNG_DATA_URL_PREFIX}{b64}"), width, height))
}

/// Strip the PNG data-URL prefix and base64-decode the payload.
///
/// Accepts the canonical prefix case-insensitively enough for our own output;
/// anything without the prefix is rejected so a stray http/file URL never gets
/// silently written to disk.
pub fn decode_png_data_url(data_url: &str) -> anyhow::Result<Vec<u8>> {
    use base64::Engine as _;

    let payload = data_url
        .strip_prefix(PNG_DATA_URL_PREFIX)
        .or_else(|| {
            // Tolerate an uppercase variant and the ";charset" form some
            // canvases emit.
            if data_url.len() >= PNG_DATA_URL_PREFIX.len()
                && data_url[..PNG_DATA_URL_PREFIX.len()].eq_ignore_ascii_case(PNG_DATA_URL_PREFIX)
            {
                Some(&data_url[PNG_DATA_URL_PREFIX.len()..])
            } else {
                None
            }
        })
        .ok_or_else(|| anyhow::anyhow!("expected a data:image/png;base64, URL"))?;

    let payload = payload.trim();
    let payload = payload
        .split_once(';')
        .map(|(head, _)| head)
        .unwrap_or(payload);

    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| anyhow::anyhow!("invalid base64 in PNG data URL: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_png() -> Vec<u8> {
        // 3x2 opaque gradient, encoded through the same `image` crate the
        // production path uses.
        let mut buf = image::RgbaImage::new(3, 2);
        for (x, y, px) in buf.enumerate_pixels_mut() {
            *px = image::Rgba([(x * 80) as u8, (y * 120) as u8, 200, 255]);
        }
        let mut out = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut out);
        image::DynamicImage::ImageRgba8(buf)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .expect("encode test png");
        out
    }

    #[test]
    fn data_url_round_trip_preserves_bytes_and_dimensions() {
        let png = tiny_png();

        let (data_url, width, height) = png_bytes_to_data_url(&png).expect("encode data url");
        assert!(data_url.starts_with(PNG_DATA_URL_PREFIX));
        assert_eq!((width, height), (3, 2));

        let decoded = decode_png_data_url(&data_url).expect("decode data url");
        assert_eq!(decoded, png, "base64 round trip must be byte-exact");

        let img = image::load_from_memory(&decoded).expect("decode png");
        assert_eq!((img.width(), img.height()), (3, 2));
    }

    #[test]
    fn decode_rejects_non_png_data_url() {
        assert!(decode_png_data_url("data:image/jpeg;base64,AAAA").is_err());
        assert!(decode_png_data_url("https://example.com/a.png").is_err());
        assert!(decode_png_data_url("not a url").is_err());
    }

    #[test]
    fn file_uri_becomes_a_path() {
        assert_eq!(
            file_uri_to_path("file:///tmp/Screenshot%20from%202026.png").unwrap(),
            std::path::PathBuf::from("/tmp/Screenshot from 2026.png")
        );
        assert_eq!(
            file_uri_to_path("file://localhost/tmp/a.png").unwrap(),
            std::path::PathBuf::from("/tmp/a.png")
        );
        assert!(file_uri_to_path("https://example.com/a.png").is_err());
        assert!(file_uri_to_path("file://relative.png").is_err());
    }

    #[test]
    fn encode_rejects_garbage() {
        assert!(png_bytes_to_data_url(b"definitely not a png").is_err());
    }

    #[test]
    fn rgb24_frames_encode_to_a_png_data_url() {
        // 2x1 rgb24: one red pixel, one blue pixel.
        let rgb = [255u8, 0, 0, 0, 0, 255];
        let (data_url, width, height) = rgb24_to_data_url(&rgb, 2, 1).expect("encode rgb24");
        assert_eq!((width, height), (2, 1));

        let png = decode_png_data_url(&data_url).expect("decode back");
        let img = image::load_from_memory(&png).expect("decode png");
        assert_eq!((img.width(), img.height()), (2, 1));
        let rgba = img.to_rgba8();
        assert_eq!(rgba.get_pixel(0, 0).0, [255, 0, 0, 255], "red stays red");
        assert_eq!(rgba.get_pixel(1, 0).0, [0, 0, 255, 255], "blue stays blue");
    }

    #[test]
    fn rgb24_short_buffers_are_rejected() {
        // 4x4 rgb24 needs 48 bytes; 47 must not become a blank image.
        assert!(rgb24_to_data_url(&[0u8; 47], 4, 4).is_err());
        assert!(rgb24_to_data_url(&[], 0, 0).is_err());
    }

    fn solid(w: u32, h: u32, rgba: [u8; 4]) -> image::RgbaImage {
        image::RgbaImage::from_pixel(w, h, image::Rgba(rgba))
    }

    #[test]
    fn compose_places_monitors_by_virtual_desktop_position() {
        // Two 2x2 "monitors" side by side: red at the origin, blue at x=2.
        let shots = [
            MonitorShot {
                x: 0,
                y: 0,
                img: solid(2, 2, [255, 0, 0, 255]),
            },
            MonitorShot {
                x: 2,
                y: 0,
                img: solid(2, 2, [0, 0, 255, 255]),
            },
        ];
        let canvas = compose_shots(&shots);
        assert_eq!((canvas.width(), canvas.height()), (4, 2));
        assert_eq!(canvas.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(canvas.get_pixel(3, 1).0, [0, 0, 255, 255]);
    }

    #[test]
    fn compose_normalises_negative_coordinates() {
        // A monitor to the LEFT of the primary (negative x) must land at 0
        // after normalisation, the primary shifted right — nothing is clipped.
        let shots = [
            MonitorShot {
                x: 0,
                y: 0,
                img: solid(2, 2, [255, 0, 0, 255]),
            },
            MonitorShot {
                x: -3,
                y: -1,
                img: solid(3, 3, [0, 255, 0, 255]),
            },
        ];
        let canvas = compose_shots(&shots);
        assert_eq!((canvas.width(), canvas.height()), (5, 3));
        assert_eq!(canvas.get_pixel(0, 0).0, [0, 255, 0, 255], "green top-left");
        assert_eq!(canvas.get_pixel(3, 1).0, [255, 0, 0, 255], "red shifted");
    }

    #[test]
    fn compose_fills_gaps_black_and_survives_edge_cases() {
        // Non-adjacent monitors leave a gap between them.
        let shots = [
            MonitorShot {
                x: 0,
                y: 0,
                img: solid(1, 1, [255, 255, 255, 255]),
            },
            MonitorShot {
                x: 4,
                y: 0,
                img: solid(1, 1, [255, 255, 255, 255]),
            },
        ];
        let canvas = compose_shots(&shots);
        assert_eq!(canvas.width(), 5);
        assert_eq!(
            canvas.get_pixel(2, 0).0,
            [0, 0, 0, 255],
            "gap is opaque black"
        );

        // No shots at all must not panic (1x1 placeholder).
        let empty = compose_shots(&[]);
        assert_eq!((empty.width(), empty.height()), (1, 1));
    }
}
