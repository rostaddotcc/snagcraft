//! End-to-end proof of the in-place updater.
//!
//! A tiny HTTP server publishes a `latest.json` and an artifact; Tauri's updater
//! has to (1) see the newer version, (2) verify the minisign signature against
//! the configured pubkey and (3) write the artifact over the "installed"
//! AppImage — or refuse and leave the old file untouched.
//!
//! The fixtures in `tests/fixtures/updater/` are a throwaway key + payload; the
//! release key never enters the repo. The signed bytes are a 64-byte ELF header,
//! which is all the plugin's AppImage check looks at.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::Duration;

use tauri_plugin_updater::UpdaterExt;

const TEST_PUBKEY: &str = include_str!("fixtures/updater/test.key.pub");
const PAYLOAD: &[u8] = include_bytes!("fixtures/updater/app.AppImage");
const SIGNATURE: &str = include_str!("fixtures/updater/app.AppImage.sig");
/// The version the fake server announces (anything above the crate version).
const REMOTE_VERSION: &str = "9.9.9";

/// A `latest.json` (Tauri's static-JSON format) pointing at `base`.
fn manifest(base: &str, signature: &str) -> String {
    serde_json::json!({
        "version": REMOTE_VERSION,
        "notes": "test release",
        "pub_date": "2026-11-23T00:00:00Z",
        "platforms": {
            "linux-x86_64": {
                "signature": signature.trim(),
                "url": format!("{base}/app.AppImage"),
            }
        }
    })
    .to_string()
}

/// Serve the manifest on any path and `artifact` on `/app.AppImage`, twice.
fn serve(
    signature: &'static str,
    artifact: &'static [u8],
) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the mock update server");
    let base = format!(
        "http://{}",
        listener.local_addr().expect("dev server address")
    );
    let manifest = manifest(&base, signature);
    let handle = std::thread::spawn(move || {
        for _ in 0..2 {
            let Ok((mut socket, _)) = listener.accept() else {
                return;
            };
            let Ok(cloned) = socket.try_clone() else {
                return;
            };
            let mut reader = BufReader::new(cloned);
            let mut request_line = String::new();
            let _ = reader.read_line(&mut request_line);
            let path = request_line
                .split_whitespace()
                .nth(1)
                .unwrap_or("/")
                .to_string();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
            }
            let (ctype, body) = if path.starts_with("/app") {
                ("application/octet-stream", artifact.to_vec())
            } else {
                ("application/json", manifest.clone().into_bytes())
            };
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(head.as_bytes());
            let _ = socket.write_all(&body);
            let _ = socket.flush();
        }
    });
    (base, handle)
}

/// A temp dir holding an "installed" AppImage to be replaced.
fn installed_appimage() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("SnagCraft.AppImage");
    std::fs::write(&path, b"\x7fELF old build").expect("seed the installed file");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    (dir, path)
}

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    // The mock context ships `plugins.updater = null`, which the plugin's config
    // parser rejects; give it a minimal valid config (the builder below still
    // overrides endpoint and key per test).
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".to_string(),
        serde_json::json!({ "pubkey": TEST_PUBKEY.trim(), "endpoints": Vec::<String>::new() }),
    );
    tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .expect("mock app")
}

/// Check → restore → download → verify → install, against the mock server.
fn run_update(
    installed: &PathBuf,
    signature: &'static str,
    artifact: &'static [u8],
) -> Result<String, String> {
    let app = mock_app();
    let (endpoint, server) = serve(signature, artifact);

    let updater = app
        .updater_builder()
        .pubkey(TEST_PUBKEY.trim().to_string())
        .endpoints(vec![endpoint.parse().expect("endpoint url")])
        .expect("http endpoints are allowed in debug builds")
        .executable_path(installed)
        .target("linux-x86_64")
        .timeout(Duration::from_secs(10))
        .build()
        .expect("updater");

    let found = tauri::async_runtime::block_on(updater.check())
        .map_err(|e| format!("check failed: {e}"))?
        .ok_or_else(|| "no update announced".to_string())?;
    if found.version != REMOTE_VERSION {
        return Err(format!("unexpected version {}", found.version));
    }
    // Same object the plugin's own JS `check` hands to `download`: it carries
    // the announced signature, which is what `download` verifies.
    let outcome = tauri::async_runtime::block_on(found.download_and_install(|_, _| {}, || {}))
        .map_err(|e| format!("install failed: {e}"));
    server.join().ok();
    outcome.map(|()| REMOTE_VERSION.to_string())
}

/// The whole flow: check, download, verify, install, keep 0755 perms.
#[test]
fn a_signed_update_replaces_the_installed_appimage() {
    let (_dir, installed) = installed_appimage();
    let version = run_update(&installed, SIGNATURE, PAYLOAD).expect("the signed update installs");
    assert_eq!(version, REMOTE_VERSION);
    assert_eq!(
        std::fs::read(&installed).expect("read the replaced file"),
        PAYLOAD,
        "the installed file must be the downloaded artifact"
    );
    assert_eq!(
        std::fs::metadata(&installed)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777,
        0o755,
        "the replaced AppImage stays executable"
    );
}

/// Bytes the signature does not cover must never reach the disk.
#[test]
fn a_tampered_artifact_is_refused_and_the_appimage_is_untouched() {
    let (_dir, installed) = installed_appimage();
    let before = std::fs::read(&installed).expect("seed bytes");

    let mut tampered = PAYLOAD.to_vec();
    // Flip one byte of the ELF header: still a valid "AppImage", different bytes.
    tampered[4] = 0x7f;
    let tampered: &'static [u8] = Box::leak(tampered.into_boxed_slice());

    let outcome = run_update(&installed, SIGNATURE, tampered);
    assert!(
        outcome.is_err(),
        "a tampered artifact must not install: {outcome:?}"
    );
    assert_eq!(
        std::fs::read(&installed).expect("read"),
        before,
        "the running build must be left exactly as it was"
    );
}

/// The real thing: the published manifest, the published artifact and the
/// release key from `tauri.conf.json`, downloaded from GitHub.
///
/// Ignored by default (it pulls ~85 MB from the network). Run it after a tag:
///
/// ```text
/// cargo test --test updater_install -- --ignored --nocapture live_update
/// ```
///
/// The version comparator is forced to "always take the remote release" because
/// this test usually runs from the same version it would download; whether a
/// release counts as newer is covered by the unit tests in `src/update.rs`.
#[test]
#[ignore = "downloads the published release from GitHub"]
fn live_update_installs_the_published_release() {
    let raw = std::fs::read_to_string("tauri.conf.json").expect("tauri.conf.json");
    let config: serde_json::Value = serde_json::from_str(&raw).expect("valid config");
    let updater = &config["plugins"]["updater"];
    let pubkey = updater["pubkey"]
        .as_str()
        .expect("plugins.updater.pubkey")
        .to_string();
    let endpoint = updater["endpoints"][0]
        .as_str()
        .expect("plugins.updater.endpoints[0]")
        .to_string();
    println!("endpoint: {endpoint}");

    let (_dir, installed) = installed_appimage();
    let app = mock_app();
    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint.parse().expect("endpoint url")])
        .expect("https endpoint")
        .executable_path(&installed)
        .target("linux-x86_64")
        .timeout(Duration::from_secs(300))
        .version_comparator(|_current, _remote| true)
        .build()
        .expect("updater");

    let found = tauri::async_runtime::block_on(updater.check())
        .expect("check against GitHub")
        .expect("a release is published");
    println!(
        "announced {} (this build is {})",
        found.version, found.current_version
    );

    // `on_chunk(chunk_len, content_length)`: the first argument is the size of
    // the chunk just received, not a running total — the same contract
    // `update.rs` accumulates against before emitting progress.
    let mut downloaded: u64 = 0;
    let mut total: Option<u64> = None;
    tauri::async_runtime::block_on(found.download_and_install(
        |chunk, len| {
            downloaded += chunk as u64;
            total = len;
        },
        || {},
    ))
    .expect("download, verify and install the published release");

    let meta = std::fs::metadata(&installed).expect("metadata");
    println!(
        "installed {} bytes ({} announced), mode {:o}",
        meta.len(),
        total.map(|t| t.to_string()).unwrap_or_else(|| "?".into()),
        meta.permissions().mode() & 0o777
    );
    assert!(
        meta.len() > 60_000_000,
        "expected the real AppImage, got {} bytes",
        meta.len()
    );
    assert!(
        downloaded > 60_000_000,
        "progress reported {downloaded} bytes"
    );
    assert_eq!(Some(meta.len()), total, "every announced byte must arrive");
    assert_eq!(meta.permissions().mode() & 0o777, 0o755);
}
