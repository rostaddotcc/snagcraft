//! Scrolling capture (Wave 9, track R) — manual-scroll stitching.
//!
//! The user selects a region once, SnagCraft casts that monitor through the
//! ScreenCast portal, and while the user scrolls the app grabs the newest frame,
//! aligns it against the last accepted one and appends only the rows that are
//! new. One tall PNG comes out. No synthetic input, no new permission
//! (`tmp/research/scrolling.md` §5).
//!
//! | command                | args (camelCase)                                | returns                                  |
//! |------------------------|-------------------------------------------------|------------------------------------------|
//! | `scrolling_start`      | `region: {left,top,width,height}`               | `void` — resolves once frames flow        |
//! | `scrolling_done`       | —                                               | `{ dataUrl, width, height }`              |
//! | `scrolling_cancel`     | —                                               | `void`                                    |
//! | `set_click_through`    | `ignore`                                        | `void`                                    |
//!
//! `scrolling-status` events: `{ frames, height, confidence, warning, finished }`.
//! `frames` counts accepted frames, `height` is the stitched height in px,
//! `confidence` is the last match's MAD (0 = perfect), `warning` carries the
//! user-facing "you're scrolling too fast" text, and `finished` is `true` exactly
//! once, when the capture stopped on its own (idle time-out, two no-change frames,
//! or the height cap) so the overlay can call `scrolling_done` itself.
//!
//! Wiring: `region` is in **stream (physical) pixels**, not CSS px — the portal
//! reports monitor size and fractional scaling makes the two differ.
//!
//! Stop rules (§5.2): 2.5 s with no new content after scrolling started, two
//! consecutive identical frames, the 40 000 px cap, or an explicit Done.
//! Teardown order matters: stop the stitcher thread, then the PipeWire thread,
//! then drop the portal `Session` — dropping the session first ends the cast
//! under the capture thread's feet.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

mod align;
mod cap;
#[cfg(target_os = "linux")]
mod source;
mod stitcher;

#[allow(unused_imports)]
pub use align::{find_offset, Bands};
pub use stitcher::{ScrollingStitcher, Status};

/// How often the stitcher looks at the newest frame (~14 fps). The portal runs at
/// monitor rate, so this is a cheap poll, not a capture rate.
const POLL_INTERVAL: Duration = Duration::from_millis(70);

/// Shottr's heuristic: after this long with no new content, the capture is done.
const IDLE_STOP: Duration = Duration::from_millis(2_500);

/// How long `scrolling_done` waits for the stitcher thread to publish its result.
const DONE_WAIT: Duration = Duration::from_secs(10);

/// Smallest sensible region: below this neither the aligner nor the user wins.
const MIN_REGION_PX: u32 = 32;

/// The selected region, in stream pixels.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

impl Region {
    fn is_usable(&self) -> bool {
        self.width >= MIN_REGION_PX && self.height >= MIN_REGION_PX
    }

    /// Clip to the stream: the overlay can be dragged to the very edge, and one
    /// stray pixel outside the monitor would make `crop_imm` produce nothing.
    fn clamp_to(&self, stream_w: u32, stream_h: u32) -> Option<Region> {
        if stream_w == 0 || stream_h == 0 {
            return None;
        }
        let left = self.left.min(stream_w.saturating_sub(1));
        let top = self.top.min(stream_h.saturating_sub(1));
        let width = self.width.min(stream_w - left);
        let height = self.height.min(stream_h - top);
        let clipped = Region {
            left,
            top,
            width,
            height,
        };
        clipped.is_usable().then_some(clipped)
    }
}

/// What `scrolling_done` hands back (serialized camelCase).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

/// Payload of the `scrolling-status` event.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStatus {
    pub frames: u64,
    pub height: u32,
    pub confidence: f32,
    pub warning: Option<String>,
    /// `true` on the single final event of an auto-stopped capture.
    pub finished: bool,
}

/// Result published by the stitcher thread.
struct Outcome {
    pixels: Vec<u8>,
    width: u32,
    height: u32,
}

/// One capture in flight.
struct Active {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    /// Signalled by the stitcher thread once it has published its [`Outcome`].
    done: mpsc::Receiver<()>,
    out: Arc<Mutex<Option<Outcome>>>,
    #[allow(dead_code)] // kept for the status readout
    width: u32,
    #[cfg(target_os = "linux")]
    source: Option<source::Source>,
}

impl Active {
    /// Stop, wait for the frame source to go quiet, and take the pixels.
    ///
    /// Runs on a blocking thread: joining two threads and dropping the portal
    /// session are all things the async runtime must not do inline.
    fn finish(mut self) -> Result<Outcome, String> {
        self.stop.store(true, Ordering::Relaxed);

        let stopped = self.done.recv_timeout(DONE_WAIT).is_ok();
        if let Some(handle) = self.join.take() {
            let _ = handle.join();
        }

        // The capture thread has stopped touching PipeWire, so the session can end.
        #[cfg(target_os = "linux")]
        if let Some(mut source) = self.source.take() {
            source.shutdown();
            // Dropped here, on a blocking thread of the async runtime: ashpd's
            // `Close` round-trip needs a runtime context.
            drop(source.take_session());
        }

        let outcome = self.out.lock().ok().and_then(|mut slot| slot.take());
        match (stopped, outcome) {
            (_, Some(outcome)) if !outcome.pixels.is_empty() => Ok(outcome),
            (false, _) => Err("the scrolling capture did not finish in time".to_string()),
            _ => Err("the scrolling capture ended without any content".to_string()),
        }
    }
}

/// Managed scrolling state (`.manage(ScrollingState::new())` in `lib.rs`).
pub struct ScrollingState {
    inner: Mutex<Option<Active>>,
}

impl Default for ScrollingState {
    fn default() -> Self {
        Self::new()
    }
}

impl ScrollingState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn is_active(&self) -> bool {
        self.inner
            .lock()
            .map(|slot| slot.is_some())
            .unwrap_or(false)
    }

    /// Claim the slot; on collision the caller gets its `Active` back so it can
    /// tear down the capture it just started.
    #[allow(clippy::result_large_err)]
    fn begin(&self, active: Active) -> Result<(), Active> {
        match self.inner.lock() {
            Ok(mut slot) if slot.is_none() => {
                *slot = Some(active);
                Ok(())
            }
            _ => Err(active),
        }
    }

    fn take(&self) -> Option<Active> {
        self.inner.lock().ok().and_then(|mut slot| slot.take())
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Start a scrolling capture of `region`.
///
/// Resolves once the portal cast is live and the anchor frame has been stored, so
/// a refused share dialog rejects the promise instead of leaving the overlay
/// waiting for frames that never come.
#[tauri::command]
pub async fn scrolling_start(
    app: tauri::AppHandle,
    state: State<'_, ScrollingState>,
    recording: State<'_, crate::recording::RecordingState>,
    region: Region,
) -> Result<(), String> {
    if !region.is_usable() {
        return Err(format!(
            "the selected region is too small (at least {MIN_REGION_PX}x{MIN_REGION_PX} needed)"
        ));
    }
    if state.is_active() {
        return Err("a scrolling capture is already in progress".to_string());
    }
    // One ScreenCast session at a time: two casts of the same monitor would fight
    // over the same PipeWire node and the recording would drop frames.
    if recording.is_active() {
        return Err(
            "a screen recording is running — stop it before taking a scrolling capture".to_string(),
        );
    }

    // Both platform implementations (`imp`) share this contract: the promise
    // resolves only once frames can actually flow.
    imp::start(app, state, region).await
}

/// Finish the capture: stop everything and return the stitched image.
#[tauri::command]
pub async fn scrolling_done(
    app: tauri::AppHandle,
    state: State<'_, ScrollingState>,
) -> Result<ScrollResult, String> {
    let Some(active) = state.take() else {
        return Err("no scrolling capture in progress".to_string());
    };

    let outcome = tauri::async_runtime::spawn_blocking(move || active.finish())
        .await
        .map_err(|e| format!("stopping the scrolling capture failed: {e}"))??;

    let encoded = tauri::async_runtime::spawn_blocking(move || encode_png(outcome))
        .await
        .map_err(|e| format!("encoding the scrolling capture failed: {e}"))??;

    let _ = app.emit(
        "scrolling-status",
        ScrollStatus {
            frames: 0,
            height: encoded.2,
            confidence: 0.0,
            warning: None,
            finished: true,
        },
    );

    Ok(ScrollResult {
        data_url: encoded.0,
        width: encoded.1,
        height: encoded.2,
    })
}

/// Abandon the capture and tear everything down.
#[tauri::command]
pub async fn scrolling_cancel(state: State<'_, ScrollingState>) -> Result<(), String> {
    let Some(active) = state.take() else {
        return Ok(());
    };
    tauri::async_runtime::spawn_blocking(move || {
        // The pixels are thrown away; only the teardown matters.
        let _ = active.finish();
    })
    .await
    .map_err(|e| format!("cancelling the scrolling capture failed: {e}"))?;
    Ok(())
}

/// Make the window ignore the cursor, so wheel events reach the app underneath
/// while the user scrolls.
///
/// On Wayland the overlay cannot receive wheel events meant for the app below it,
/// so during a capture it is transparent to input and the overlay chrome is drawn
/// from status events only.
#[tauri::command]
pub fn set_click_through(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Encode the accumulated pixels as one PNG data URL, validating the result the
/// same way `capture.rs` does.
fn encode_png(outcome: Outcome) -> Result<(String, u32, u32), String> {
    let expected = outcome.width as usize * outcome.height as usize * 3;
    if outcome.pixels.len() < expected || expected == 0 {
        return Err("the stitched image is empty".to_string());
    }

    let buffer = image::RgbImage::from_raw(outcome.width, outcome.height, outcome.pixels)
        .ok_or_else(|| "the stitched image has an inconsistent size".to_string())?;

    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(buffer)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("cannot encode the scrolling capture: {e}"))?;

    crate::capture::png_bytes_to_data_url(&png)
        .map_err(|e| format!("cannot encode the scrolling capture: {e}"))
}

/// Convert an RGBA grab to tightly packed RGB24 — the stitcher's pixel format.
///
/// Only the non-Linux source needs it (the portal frames arrive as RGB24
/// already); kept cross-platform so the unit test runs everywhere.
#[allow(dead_code)]
fn rgba_to_rgb24(img: &image::RgbaImage) -> Vec<u8> {
    let mut out = Vec::with_capacity(img.width() as usize * img.height() as usize * 3);
    for px in img.pixels() {
        out.extend_from_slice(&px.0[..3]);
    }
    out
}

/// Publish one `scrolling-status` event — shared by both platform loops.
fn emit_status(
    app: &tauri::AppHandle,
    stitcher: &ScrollingStitcher,
    warning: Option<String>,
    finished: bool,
) {
    let _ = app.emit(
        "scrolling-status",
        ScrollStatus {
            frames: stitcher.frames(),
            height: stitcher.rows(),
            confidence: stitcher.confidence(),
            warning,
            finished,
        },
    );
}

// ---------------------------------------------------------------------------
// Linux implementation: frame source + stitcher thread
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
mod imp {
    use super::{
        cap, emit_status, imp_crop::crop, Active, Outcome, Region, ScrollingState,
        ScrollingStitcher, Status, IDLE_STOP, POLL_INTERVAL,
    };
    use std::sync::atomic::Ordering;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Instant;

    use tauri::State;

    /// Linux `scrolling_start`: open the portal cast, then hand the newest-frame
    /// slot to a stitcher thread.
    pub(super) async fn start(
        app: tauri::AppHandle,
        state: State<'_, ScrollingState>,
        region: Region,
    ) -> Result<(), String> {
        let source = super::source::open().await?;

        let (stream_w, stream_h) = source.size();
        let region = region
            .clamp_to(stream_w.max(0) as u32, stream_h.max(0) as u32)
            .ok_or_else(|| {
                format!("the selected region does not fit inside the {stream_w}x{stream_h} stream")
            })?;

        let latest = source.latest();
        let stop = source.stop_flag();
        let out = Arc::new(Mutex::new(None));
        let (done_tx, done_rx) = mpsc::channel();

        let thread = {
            let out = out.clone();
            let stop = stop.clone();
            std::thread::Builder::new()
                .name("snagcraft-scrolling-stitch".to_string())
                .spawn(move || {
                    let outcome = run(app, latest, stop, region, out.clone());
                    if let Ok(mut slot) = out.lock() {
                        *slot = Some(outcome);
                    }
                    let _ = done_tx.send(());
                })
                .map_err(|e| format!("cannot start the stitcher thread: {e}"))?
        };

        let active = Active {
            stop,
            join: Some(thread),
            done: done_rx,
            out,
            width: region.width,
            source: Some(source),
        };

        if let Err(rejected) = state.begin(active) {
            // Lost a race with another start: tear down what we just opened.
            let _ = tauri::async_runtime::spawn_blocking(move || rejected.finish()).await;
            return Err("a scrolling capture is already in progress".to_string());
        }

        Ok(())
    }

    /// The capture loop. Polls the newest frame, crops the region, offers it to the
    /// stitcher and emits status until one of the stop rules fires.
    fn run(
        app: tauri::AppHandle,
        latest: super::source::Latest,
        stop: Arc<std::sync::atomic::AtomicBool>,
        region: Region,
        _out: Arc<Mutex<Option<Outcome>>>,
    ) -> Outcome {
        let mut stitcher = ScrollingStitcher::new(region.width, region.height);
        let mut last_seen: Option<*const super::source::Frame> = None;
        let mut last_progress = Instant::now();
        let mut armed = false;
        let mut stalled = 0u32;
        let mut warning: Option<String> = None;
        let mut finished = false;

        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(POLL_INTERVAL);

            let frame = match latest.lock() {
                Ok(slot) => slot.clone(),
                Err(poisoned) => poisoned.into_inner().clone(),
            };
            let Some(frame) = frame else { continue };
            let ptr = Arc::as_ptr(&frame);
            if last_seen == Some(ptr) {
                // Same buffer as last poll: the screen did not change.
                if armed && last_progress.elapsed() >= IDLE_STOP {
                    finished = true;
                    break;
                }
                continue;
            }
            last_seen = Some(ptr);

            let Some((_, _, bytes)) = crop(&frame, region) else {
                continue;
            };

            match stitcher.push(&bytes) {
                Status::Accepted { new_rows } => {
                    if new_rows > 0 && stitcher.rows() > region.height {
                        // The first scroll frames the auto-stop rules from here.
                        armed = true;
                        last_progress = Instant::now();
                        stalled = 0;
                    }
                    warning = None;
                    emit_status(&app, &stitcher, warning.clone(), false);
                }
                Status::NoChange => {
                    if armed {
                        stalled += 1;
                        if stalled >= 2 {
                            finished = true;
                            break;
                        }
                        if last_progress.elapsed() >= IDLE_STOP {
                            finished = true;
                            break;
                        }
                    }
                    emit_status(&app, &stitcher, warning.clone(), false);
                }
                Status::LowConfidence => {
                    stalled = 0;
                    warning = Some(
                        "you're scrolling too fast — the last step couldn't be matched".to_string(),
                    );
                    emit_status(&app, &stitcher, warning.clone(), false);
                }
                Status::Capped => {
                    warning = Some(format!(
                        "capture stopped at the {} px height limit",
                        cap::MAX_HEIGHT
                    ));
                    finished = true;
                    emit_status(&app, &stitcher, warning.clone(), true);
                    break;
                }
            }
        }

        // Also covers a Done/cancel-driven stop, which is not "finished" for the UI.
        emit_status(&app, &stitcher, warning, finished);

        let (pixels, width, height) = stitcher.into_image();
        Outcome {
            pixels,
            width,
            height,
        }
    }
}

/// Cropping helper, kept separate so it is testable without a portal.
#[cfg(target_os = "linux")]
mod imp_crop {
    use super::Region;

    /// Crop `region` out of a full-monitor frame.
    ///
    /// Returns `(width, height, rgb24)`. `crop_imm` is used rather than index
    /// arithmetic so edge cases (a region reaching the last pixel) are the image
    /// crate's problem, not ours.
    pub(super) fn crop(
        frame: &super::source::Frame,
        region: Region,
    ) -> Option<(u32, u32, Vec<u8>)> {
        let (fw, fh) = (frame.width as u32, frame.height as u32);
        if fw == 0 || fh == 0 {
            return None;
        }

        let source = image::RgbImage::from_raw(fw, fh, frame.bytes.clone())?;
        let width = region.width.min(fw.saturating_sub(region.left));
        let height = region.height.min(fh.saturating_sub(region.top));
        if width == 0 || height == 0 {
            return None;
        }

        let cropped =
            image::imageops::crop_imm(&source, region.left, region.top, width, height).to_image();
        let (w, h) = cropped.dimensions();
        Some((w, h, cropped.into_raw()))
    }
}

// ---------------------------------------------------------------------------
// Windows/macOS implementation: xcap region polling + stitcher thread
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "linux"))]
mod imp {
    use super::{
        cap, emit_status, rgba_to_rgb24, Active, Outcome, Region, ScrollingState,
        ScrollingStitcher, Status, IDLE_STOP, MIN_REGION_PX, POLL_INTERVAL,
    };
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Instant;

    use tauri::State;

    /// The monitor overlapping `region` the most, plus the region clamped to
    /// that monitor and translated into monitor-relative physical pixels
    /// (what xcap's `capture_region` expects). A region spanning two monitors
    /// is honestly clamped to the dominant one — stitching needs a single
    /// consistent source.
    fn pick_monitor(region: &Region) -> Result<(u32, Region), String> {
        let mut best: Option<(i64, u32, Region)> = None;
        for monitor in
            xcap::Monitor::all().map_err(|e| format!("cannot enumerate monitors: {e}"))?
        {
            let (Ok(mx), Ok(my), Ok(mw), Ok(mh), Ok(id)) = (
                monitor.x(),
                monitor.y(),
                monitor.width(),
                monitor.height(),
                monitor.id(),
            ) else {
                continue;
            };
            let left = (region.left as i64).max(mx as i64);
            let top = (region.top as i64).max(my as i64);
            let right = ((region.left + region.width) as i64).min(mx as i64 + mw as i64);
            let bottom = ((region.top + region.height) as i64).min(my as i64 + mh as i64);
            let (w, h) = (right - left, bottom - top);
            if w <= 0 || h <= 0 {
                continue;
            }
            let clipped = Region {
                left: (left - mx as i64) as u32,
                top: (top - my as i64) as u32,
                width: w as u32,
                height: h as u32,
            };
            if best.as_ref().map_or(true, |(area, _, _)| w * h > *area) {
                best = Some((w * h, id, clipped));
            }
        }
        let (_, id, clipped) =
            best.ok_or_else(|| "the selected region does not lie on any monitor".to_string())?;
        if !clipped.is_usable() {
            return Err(format!(
                "the region clipped to one monitor is too small (at least {MIN_REGION_PX}x{MIN_REGION_PX} needed)"
            ));
        }
        Ok((id, clipped))
    }

    fn find_monitor(id: u32) -> Result<xcap::Monitor, String> {
        xcap::Monitor::all()
            .map_err(|e| format!("cannot enumerate monitors: {e}"))?
            .into_iter()
            .find(|m| m.id().is_ok_and(|mid| mid == id))
            .ok_or_else(|| format!("monitor {id} is no longer connected"))
    }

    /// Windows/macOS `scrolling_start`: probe one region grab (fail fast and
    /// honestly), then hand a capture+stitch thread the same contract the
    /// Linux portal source has.
    pub(super) async fn start(
        app: tauri::AppHandle,
        state: State<'_, ScrollingState>,
        region: Region,
    ) -> Result<(), String> {
        let (monitor_id, region) = pick_monitor(&region)?;

        // Probe BEFORE claiming the slot — and in its own scope: xcap's Monitor
        // is not Send and must not live across an await (the race path below).
        {
            let monitor = find_monitor(monitor_id)?;
            monitor
                .capture_region(region.left, region.top, region.width, region.height)
                .map_err(|e| format!("cannot capture the selected region: {e}"))?;
        }

        let stop = Arc::new(AtomicBool::new(false));
        let out = Arc::new(Mutex::new(None));
        let (done_tx, done_rx) = mpsc::channel();

        let thread = {
            let out = out.clone();
            std::thread::Builder::new()
                .name("snagcraft-scrolling-stitch".to_string())
                .spawn(move || {
                    let outcome = run(app, monitor_id, region, stop.clone());
                    if let Ok(mut slot) = out.lock() {
                        *slot = Some(outcome);
                    }
                    let _ = done_tx.send(());
                })
                .map_err(|e| format!("cannot start the stitcher thread: {e}"))?
        };

        let active = Active {
            stop,
            join: Some(thread),
            done: done_rx,
            out,
            width: region.width,
        };

        if let Err(rejected) = state.begin(active) {
            // Lost a race with another start: tear down what we just started.
            let _ = tauri::async_runtime::spawn_blocking(move || rejected.finish()).await;
            return Err("a scrolling capture is already in progress".to_string());
        }

        Ok(())
    }

    /// The capture loop — a deliberate MIRROR of the Linux `imp::run` stop
    /// rules (keep the two in sync when editing either): unchanged screen →
    /// IDLE_STOP timer; changed but no new rows twice in a row → done; low
    /// confidence → warn; stitcher cap → done. The "screen unchanged" test is
    /// byte-equality against the previous grab (Linux uses buffer identity on
    /// the portal's newest-frame slot — same semantics).
    fn run(
        app: tauri::AppHandle,
        monitor_id: u32,
        region: Region,
        stop: Arc<AtomicBool>,
    ) -> Outcome {
        let mut stitcher = ScrollingStitcher::new(region.width, region.height);
        let mut last: Option<Vec<u8>> = None;
        let mut last_progress = Instant::now();
        let mut armed = false;
        let mut stalled = 0u32;
        let mut warning: Option<String> = None;
        let mut finished = false;

        let monitor = match find_monitor(monitor_id) {
            Ok(monitor) => monitor,
            Err(_) => return into_outcome(stitcher),
        };

        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(POLL_INTERVAL);

            let Ok(img) =
                monitor.capture_region(region.left, region.top, region.width, region.height)
            else {
                // Display went away mid-capture — keep what we stitched so far.
                break;
            };
            let bytes = rgba_to_rgb24(&img);
            if last.as_deref() == Some(bytes.as_slice()) {
                // Same pixels as the previous poll: the screen did not change.
                if armed && last_progress.elapsed() >= IDLE_STOP {
                    finished = true;
                    break;
                }
                continue;
            }
            last = Some(bytes.clone());

            match stitcher.push(&bytes) {
                Status::Accepted { new_rows } => {
                    if new_rows > 0 && stitcher.rows() > region.height {
                        // The first scroll frames the auto-stop rules from here.
                        armed = true;
                        last_progress = Instant::now();
                        stalled = 0;
                    }
                    warning = None;
                    emit_status(&app, &stitcher, warning.clone(), false);
                }
                Status::NoChange => {
                    if armed {
                        stalled += 1;
                        if stalled >= 2 {
                            finished = true;
                            break;
                        }
                        if last_progress.elapsed() >= IDLE_STOP {
                            finished = true;
                            break;
                        }
                    }
                    emit_status(&app, &stitcher, warning.clone(), false);
                }
                Status::LowConfidence => {
                    stalled = 0;
                    warning = Some(
                        "you're scrolling too fast — the last step couldn't be matched".to_string(),
                    );
                    emit_status(&app, &stitcher, warning.clone(), false);
                }
                Status::Capped => {
                    warning = Some(format!(
                        "capture stopped at the {} px height limit",
                        cap::MAX_HEIGHT
                    ));
                    finished = true;
                    emit_status(&app, &stitcher, warning.clone(), true);
                    break;
                }
            }
        }

        // Also covers a Done/cancel-driven stop, which is not "finished" for the UI.
        emit_status(&app, &stitcher, warning, finished);
        into_outcome(stitcher)
    }

    fn into_outcome(stitcher: ScrollingStitcher) -> Outcome {
        let (pixels, width, height) = stitcher.into_image();
        Outcome {
            pixels,
            width,
            height,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_deserializes_from_the_overlay_payload() {
        let region: Region =
            serde_json::from_str(r#"{"left":10,"top":20,"width":300,"height":400}"#)
                .expect("camelCase region");
        assert_eq!(
            region,
            Region {
                left: 10,
                top: 20,
                width: 300,
                height: 400
            }
        );
    }

    #[test]
    fn tiny_regions_are_refused() {
        assert!(!Region {
            left: 0,
            top: 0,
            width: 8,
            height: 400
        }
        .is_usable());
        assert!(Region {
            left: 0,
            top: 0,
            width: 300,
            height: 400
        }
        .is_usable());
    }

    #[test]
    fn a_region_is_clipped_to_the_stream() {
        let region = Region {
            left: 100,
            top: 100,
            width: 500,
            height: 500,
        };
        let clipped = region.clamp_to(400, 300).expect("clipped but usable");
        assert_eq!(
            clipped,
            Region {
                left: 100,
                top: 100,
                width: 300,
                height: 200
            }
        );
        // Entirely outside the stream: no usable region.
        assert!(Region {
            left: 900,
            top: 900,
            width: 200,
            height: 200
        }
        .clamp_to(400, 300)
        .is_none());
    }

    #[test]
    fn status_serializes_camel_case_for_the_overlay() {
        let value = serde_json::to_value(ScrollStatus {
            frames: 6,
            height: 1_840,
            confidence: 0.4,
            warning: Some("slow down".into()),
            finished: false,
        })
        .expect("serialize status");
        assert_eq!(value["frames"], 6);
        assert_eq!(value["height"], 1_840);
        assert_eq!(value["warning"], "slow down");
        assert_eq!(value["finished"], false);
    }

    #[test]
    fn state_starts_idle() {
        let state = ScrollingState::new();
        assert!(!state.is_active());
        assert!(state.take().is_none());
    }

    #[test]
    fn png_encoding_rejects_a_short_buffer() {
        let outcome = Outcome {
            pixels: vec![0u8; 10],
            width: 100,
            height: 100,
        };
        assert!(encode_png(outcome).is_err());
    }

    #[test]
    fn rgba_frames_convert_to_tightly_packed_rgb24() {
        // 2x1: one red pixel, one green pixel — alpha is dropped, nothing padded.
        let mut img = image::RgbaImage::new(2, 1);
        img.put_pixel(0, 0, image::Rgba([255, 0, 0, 128]));
        img.put_pixel(1, 0, image::Rgba([0, 255, 0, 255]));
        assert_eq!(
            rgba_to_rgb24(&img),
            vec![255, 0, 0, 0, 255, 0],
            "exactly width*height*3 bytes, row-major"
        );
    }
}
