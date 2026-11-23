//! "Check for updates": ask GitHub for the newest published release and compare
//! it with the running build.
//!
//! Nothing is downloaded, installed or teleported behind the user's back — the
//! answer is a small struct the UI turns into a quiet notice plus a link to the
//! release page. That keeps the check honest for every bundle we ship (full
//! AppImage, thin AppImage, .deb, NSIS/MSI) without signing keys or a second
//! release channel to maintain.
//!
//! Transport is `curl`, for the same reason as `upload.rs`: it is present on
//! every Linux desktop and ships with Windows 10+, so the app keeps bundling no
//! TLS stack of its own.

use serde::{Deserialize, Serialize};

/// The project whose releases count as "newer".
const RELEASES_URL: &str =
    "https://api.github.com/repos/rostaddotcc/snagcraft/releases?per_page=20";
/// Where the dialog sends the user when they want the new build.
const RELEASE_PAGE: &str = "https://github.com/rostaddotcc/snagcraft/releases";

/// Longest release-note preview the dialog is given.
const NOTES_PREVIEW_CHARS: usize = 320;

/// What `check_for_update` hands the frontend (serialized camelCase).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// Version of the running build, e.g. `1.5.5`.
    pub current: String,
    /// Newest published version, e.g. `1.6.0`. Equals `current` when up to date.
    pub latest: String,
    /// True only when `latest` is strictly newer than `current`.
    pub newer: bool,
    /// Release title (falls back to the tag when a release has no title).
    pub title: String,
    /// Release page to open in the browser.
    pub url: String,
    /// Short preview of the release notes; empty when the release has none.
    pub notes: String,
}

/// One entry of the GitHub releases API, narrowed to what the check needs.
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// A comparable version: `(major, minor, patch)`.
type Version = (u64, u64, u64);

/// Parse `1.5.5`, `v1.5.5`, `1.5` or `1` into a comparable triple.
///
/// Build metadata (`+abc`) is ignored and a pre-release suffix (`-rc1`) is
/// rejected: a release candidate is never offered as an update over a real
/// release. Anything else that is not a plain dotted number is `None` — an odd
/// tag can then never win the comparison by accident.
fn parse_version(raw: &str) -> Option<Version> {
    let text = raw.trim().trim_start_matches(['v', 'V']);
    if text.is_empty() || text.contains('-') {
        return None;
    }
    let core = text.split('+').next().unwrap_or(text);
    let mut parts = core.split('.');
    let mut numbers = [0u64; 3];
    let mut seen = 0;
    for slot in numbers.iter_mut() {
        match parts.next() {
            Some(part) => {
                if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                *slot = part.parse().ok()?;
                seen += 1;
            }
            None => break,
        }
    }
    // A fourth component (`1.2.3.4`) is not a version we ever publish.
    if parts.next().is_some() || seen == 0 {
        return None;
    }
    Some((numbers[0], numbers[1], numbers[2]))
}

/// Version text without a leading `v`, for display.
fn display_version(raw: &str) -> String {
    raw.trim().trim_start_matches(['v', 'V']).to_string()
}

/// One line of release notes with the markdown bullets/heading marks removed.
fn plain_line(line: &str) -> &str {
    let text = line.trim();
    for marker in ["- ", "* ", "+ ", "> "] {
        if let Some(rest) = text.strip_prefix(marker) {
            return rest.trim();
        }
    }
    text.trim_start_matches('#').trim()
}

/// First paragraph of the release notes, trimmed to the preview cap.
fn notes_preview(body: &str) -> String {
    let first = body
        .split("\n\n")
        .map(str::trim)
        .find(|chunk| !chunk.is_empty())
        .unwrap_or("");
    // Markdown headings/bullets read badly inline; keep the words.
    let plain = first.lines().map(plain_line).collect::<Vec<_>>().join(" ");
    let trimmed = plain.trim();
    if trimmed.chars().count() <= NOTES_PREVIEW_CHARS {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(NOTES_PREVIEW_CHARS).collect();
    format!("{}…", cut.trim_end())
}

/// Pick the newest published release out of a raw GitHub `releases` payload and
/// compare it with `current`.
///
/// Drafts, pre-releases and tags that are not plain versions are skipped, so a
/// stray tag on an old branch can never be mistaken for an update. A repo with
/// no usable release compares as up to date.
fn newest(json: &str, current: &str) -> Result<UpdateInfo, String> {
    let releases: Vec<Release> = serde_json::from_str(json)
        .map_err(|e| format!("GitHub returned something unexpected: {e}"))?;

    let mut best: Option<(Version, Release)> = None;
    for release in releases {
        if release.draft || release.prerelease {
            continue;
        }
        let Some(version) = parse_version(&release.tag_name) else {
            continue;
        };
        let wins = best
            .as_ref()
            .map(|(best_version, _)| version > *best_version)
            .unwrap_or(true);
        if wins {
            best = Some((version, release));
        }
    }

    let Some((version, release)) = best else {
        return Ok(UpdateInfo {
            current: display_version(current),
            latest: display_version(current),
            newer: false,
            title: String::new(),
            url: RELEASE_PAGE.to_string(),
            notes: String::new(),
        });
    };

    let current_version = parse_version(current);
    let newer = current_version.map(|c| version > c).unwrap_or(false);
    let tag = display_version(&release.tag_name);
    let title = release
        .name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("v{tag}"));
    Ok(UpdateInfo {
        current: display_version(current),
        latest: tag,
        newer,
        title,
        url: release
            .html_url
            .filter(|url| url.starts_with("https://"))
            .unwrap_or_else(|| RELEASE_PAGE.to_string()),
        notes: release
            .body
            .map(|body| notes_preview(&body))
            .unwrap_or_default(),
    })
}

/// Turn a failed `curl` run into one line a user can act on.
fn curl_failure(code: Option<i32>, stderr: &str) -> String {
    match code {
        // 6 = name lookup failed, 7 = could not connect, 28 = timed out.
        Some(6) | Some(7) | Some(28) => "no connection to GitHub — check your network".to_string(),
        _ => {
            let message = stderr.trim();
            if message.is_empty() {
                "the update server could not be reached".to_string()
            } else {
                format!("the update server could not be reached: {message}")
            }
        }
    }
}

/// GET the release list with `curl`; returns the body of a 200 response.
fn fetch_releases() -> Result<String, String> {
    use std::process::{Command, Stdio};

    let agent = format!("SnagCraft/{}", env!("CARGO_PKG_VERSION"));
    let output = Command::new("curl")
        .args([
            "-sS",
            // A hung network must never outlive the user's patience.
            "--max-time",
            "12",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            &format!("User-Agent: {agent}"),
            // So a 4xx (rate limit, outage) is reported instead of parsed.
            "-w",
            "\n%{http_code}",
            RELEASES_URL,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("could not run curl (is it installed?): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(curl_failure(output.status.code(), &stderr));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let (body, code) = text
        .rsplit_once('\n')
        .map(|(body, code)| (body, code.trim()))
        .unwrap_or((text.as_ref(), "200"));
    if code != "200" {
        return Err(match code {
            "403" | "429" => {
                "GitHub is rate-limiting the update check — try again later".to_string()
            }
            other => format!("GitHub answered {other} to the update check"),
        });
    }
    Ok(body.to_string())
}

/// Ask GitHub whether a newer SnagCraft has been published.
///
/// Runs on a worker thread: `curl` blocks for up to 12 s and the UI thread must
/// keep painting. Failures are ordinary `Err` strings the shell shows only for a
/// check the user asked for.
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let json = fetch_releases()?;
        newest(&json, env!("CARGO_PKG_VERSION"))
    })
    .await
    .map_err(|e| format!("the update check did not finish: {e}"))?
}

// ---------------------------------------------------------------- installing
//
// The step above only *reports* a new release. This half installs it: Tauri's
// updater downloads the artifact published in `latest.json`, verifies its
// minisign signature against the pubkey baked into `tauri.conf.json`, and
// writes it over the running AppImage. Nothing is installed unsigned.

use tauri::Emitter as _;
use tauri_plugin_updater::UpdaterExt;

/// Event carrying download progress to the frontend.
pub const UPDATE_PROGRESS_EVENT: &str = "snagcraft-update-progress";

/// How far an in-place update has got.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// Can this build replace itself in place?
///
/// An AppImage can — the updater writes the new file over `$APPIMAGE`. A .deb
/// (or .rpm) install cannot: those files belong to the package manager, so the
/// UI keeps offering the release page instead of a button that would fail.
pub fn install_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some_and(|path| !path.is_empty())
    }
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(target_os = "macos")]
    {
        false
    }
}

/// Whether the dialog may offer "Update now" for this install.
#[tauri::command]
pub fn update_can_install() -> bool {
    install_supported()
}

/// Download, verify and install the newest release.
///
/// Returns the installed version; the app keeps running on the old build until
/// the user restarts (there may be unsaved annotations in the editor).
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<String, String> {
    if !install_supported() {
        return Err("this build cannot update itself — use the release page".to_string());
    }
    let updater = app
        .updater()
        .map_err(|e| format!("the updater is not ready: {e}"))?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|e| format!("could not reach the update server: {e}"))?
    else {
        return Err("SnagCraft is already up to date".to_string());
    };
    let version = update.version.clone();
    // NOTE: we deliberately keep the `Update` returned by `check()` instead of
    // round-tripping it through `restore_update()`. Restoring turns on
    // `require_signed_version` (a downgrade guard that wants `version:` in the
    // signature's trusted comment); the release bundler writes that comment,
    // but `tauri signer sign` does not, so enabling it here would need a custom
    // signing step. This is the same path Tauri's own JS `download` command
    // takes.
    let handle = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = handle.emit(UPDATE_PROGRESS_EVENT, UpdateProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("the update could not be installed: {e}"))?;
    Ok(version)
}

/// Restart into the installed build (Tauri re-execs `$APPIMAGE` when there is
/// one, so the FUSE mount of the old file is never reused).
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_prefixed_versions() {
        assert_eq!(parse_version("1.5.5"), Some((1, 5, 5)));
        assert_eq!(parse_version("v1.5.5"), Some((1, 5, 5)));
        assert_eq!(parse_version(" V2.0.1 "), Some((2, 0, 1)));
        assert_eq!(parse_version("1.5"), Some((1, 5, 0)));
        assert_eq!(parse_version("1"), Some((1, 0, 0)));
        // Build metadata is harmless, pre-releases and junk are not versions.
        assert_eq!(parse_version("1.5.5+build7"), Some((1, 5, 5)));
        assert_eq!(parse_version("1.5.5-rc1"), None);
        assert_eq!(parse_version("rust-v0.1.0"), None);
        assert_eq!(parse_version("nightly"), None);
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("1.2.3.4"), None);
    }

    #[test]
    fn notes_preview_keeps_the_first_paragraph() {
        assert_eq!(
            notes_preview("Hello **world**.\n\n- more"),
            "Hello **world**."
        );
        assert_eq!(
            notes_preview("\n\n  # Title  \n- item\n\nrest"),
            "Title item"
        );
        assert!(notes_preview(&"x".repeat(500)).chars().count() <= NOTES_PREVIEW_CHARS + 1);
    }

    /// A trimmed copy of a real API response: newest first, one draft and one
    /// pre-release that must not win, plus an unparsable old tag.
    const FIXTURE: &str = r#"[
      {"tag_name":"v9.9.9","name":"draft","body":"nope","html_url":"https://github.com/rostaddotcc/snagcraft/releases/tag/v9.9.9","draft":true,"prerelease":false},
      {"tag_name":"v9.9.8","name":"beta","body":"nope","html_url":"https://github.com/rostaddotcc/snagcraft/releases/tag/v9.9.8","draft":false,"prerelease":true},
      {"tag_name":"nightly","name":"junk","body":"","html_url":"https://example.invalid/junk","draft":false,"prerelease":false},
      {"tag_name":"v1.5.4","name":"v1.5.4 — multi-monitor capture (issue #1), window chooser, native hotkeys","body":"**Multi-monitor capture.** Grab every screen at once.\n\nSecondary paragraph.","html_url":"https://github.com/rostaddotcc/snagcraft/releases/tag/v1.5.4","draft":false,"prerelease":false},
      {"tag_name":"v1.5.3","name":"v1.5.3 — distinct tool icons","body":"","html_url":"https://github.com/rostaddotcc/snagcraft/releases/tag/v1.5.3","draft":false,"prerelease":false}
    ]"#;

    #[test]
    fn newest_ignores_drafts_prereleases_and_junk_tags() {
        let info = newest(FIXTURE, "1.5.3").expect("fixture parses");
        assert_eq!(info.latest, "1.5.4");
        assert_eq!(info.current, "1.5.3");
        assert!(info.newer);
        assert_eq!(
            info.url,
            "https://github.com/rostaddotcc/snagcraft/releases/tag/v1.5.4"
        );
        assert_eq!(
            info.notes,
            "**Multi-monitor capture.** Grab every screen at once."
        );
        assert!(info.title.starts_with("v1.5.4"));
    }

    #[test]
    fn same_version_is_not_newer() {
        let info = newest(FIXTURE, "v1.5.4").expect("fixture parses");
        assert_eq!(info.latest, "1.5.4");
        assert!(!info.newer);
    }

    #[test]
    fn a_newer_local_build_is_not_offered_an_older_release() {
        let info = newest(FIXTURE, "1.5.5").expect("fixture parses");
        assert_eq!(info.latest, "1.5.4");
        assert!(!info.newer);
    }

    #[test]
    fn empty_or_broken_payloads_fail_honestly() {
        let info = newest("[]", "1.5.5").expect("empty list is fine");
        assert_eq!(info.latest, "1.5.5");
        assert!(!info.newer);
        assert!(newest("{\"message\":\"API rate limit exceeded\"}", "1.5.5").is_err());
        assert!(newest("not json", "1.5.5").is_err());
    }

    #[test]
    fn curl_failures_read_like_a_sentence() {
        assert_eq!(
            curl_failure(Some(7), "curl: (7) Failed to connect"),
            "no connection to GitHub — check your network"
        );
        assert_eq!(
            curl_failure(Some(6), "curl: (6) Could not resolve host"),
            "no connection to GitHub — check your network"
        );
        assert_eq!(
            curl_failure(Some(28), "curl: (28) Operation timed out"),
            "no connection to GitHub — check your network"
        );
        assert_eq!(
            curl_failure(Some(2), ""),
            "the update server could not be reached"
        );
        assert_eq!(
            curl_failure(Some(1), "curl: (1) bad option"),
            "the update server could not be reached: curl: (1) bad option"
        );
    }

    /// Real network round-trip. Run with
    /// `cargo test --lib -- --ignored live_release_lookup`.
    #[test]
    #[ignore = "hits the GitHub API"]
    fn live_release_lookup() {
        let json = fetch_releases().expect("the releases API answers");
        let info = newest(&json, env!("CARGO_PKG_VERSION")).expect("the payload parses");
        assert!(parse_version(&info.latest).is_some(), "latest: {info:?}");
        assert!(info.url.starts_with("https://github.com/rostaddotcc/"));
        println!(
            "live check: current={} latest={} newer={}",
            info.current, info.latest, info.newer
        );
    }
}
