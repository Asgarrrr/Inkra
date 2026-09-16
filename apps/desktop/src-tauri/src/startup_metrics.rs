//! Startup timing for the native side of a launch.
//!
//! The frontend's `startup-metrics.ts` can only see from `performance.timeOrigin`
//! onwards — that is, from the moment the WebView navigates. Everything before
//! it (process spawn, plugin registration, window creation) is invisible there,
//! and measurement showed the remaining startup cost is in exactly that region:
//! the first asynchronous boundary in the WebView's life takes ~75 ms whether it
//! is a `MessageChannel` message or a Tauri IPC call.
//!
//! [`init`] records the zero point, [`mark`] records named offsets from it, and
//! [`snapshot`] hands both to the frontend so the two timelines can be laid over
//! each other — `process_start_epoch_ms` is directly comparable with
//! `performance.timeOrigin`.

use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Marks are a handful per launch, recorded once. The capacity avoids the
/// couple of reallocations that would otherwise land inside the very window
/// being measured.
const EXPECTED_MARKS: usize = 16;

struct Origin {
    instant: Instant,
    epoch_ms: f64,
}

static ORIGIN: OnceLock<Origin> = OnceLock::new();
static MARKS: Mutex<Vec<Mark>> = Mutex::new(Vec::new());

/// A named point in the launch, offset from process start.
#[derive(Debug, Clone, Serialize)]
pub struct Mark {
    pub name: &'static str,
    pub at_ms: f64,
}

/// The native launch timeline.
#[derive(Debug, Clone, Serialize)]
pub struct StartupTimings {
    /// Unix epoch milliseconds, the same clock and unit as
    /// `performance.timeOrigin`. Subtracting the two gives the cost of getting
    /// from process spawn to the WebView's navigation.
    pub process_start_epoch_ms: f64,
    /// Milliseconds from process start to now, so a caller can tell how much of
    /// the launch had already elapsed when it asked.
    pub elapsed_ms: f64,
    pub marks: Vec<Mark>,
}

/// Records the zero point. Call this as the first statement of `main`; later
/// calls are ignored, so the earliest one wins.
pub fn init() {
    ORIGIN.get_or_init(|| {
        if let Ok(mut marks) = MARKS.lock() {
            marks.reserve(EXPECTED_MARKS);
        }
        Origin {
            instant: Instant::now(),
            epoch_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs_f64() * 1000.0)
                .unwrap_or(f64::NAN),
        }
    });
}

/// Records `name` at the current offset from process start. A no-op if [`init`]
/// was never called, so an unusual entry point cannot produce marks measured
/// against a zero point that does not exist.
pub fn mark(name: &'static str) {
    let Some(origin) = ORIGIN.get() else { return };
    let at_ms = origin.instant.elapsed().as_secs_f64() * 1000.0;
    if let Ok(mut marks) = MARKS.lock() {
        marks.push(Mark { name, at_ms });
    }
}

/// The timeline so far. Returns `None` before [`init`] has run.
pub fn snapshot() -> Option<StartupTimings> {
    let origin = ORIGIN.get()?;
    let marks = MARKS.lock().ok().map(|m| m.clone()).unwrap_or_default();
    Some(StartupTimings {
        process_start_epoch_ms: origin.epoch_ms,
        elapsed_ms: origin.instant.elapsed().as_secs_f64() * 1000.0,
        marks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_is_none_until_init_runs() {
        // Runs in the same process as the other tests, and `init` is idempotent,
        // so only assert the shape that holds either way.
        if ORIGIN.get().is_none() {
            assert!(snapshot().is_none());
        }
    }

    #[test]
    fn marks_are_recorded_in_order_after_init() {
        init();
        mark("test-first");
        mark("test-second");

        let timings = snapshot().expect("init ran, so a snapshot exists");
        let names: Vec<_> = timings.marks.iter().map(|m| m.name).collect();
        let first = names.iter().position(|n| *n == "test-first");
        let second = names.iter().position(|n| *n == "test-second");

        assert!(first.is_some() && second.is_some(), "both marks recorded");
        assert!(first < second, "marks keep insertion order");
        assert!(
            timings.process_start_epoch_ms > 0.0,
            "epoch origin is a real timestamp"
        );
    }

    #[test]
    fn marks_are_monotonic_and_within_the_elapsed_window() {
        init();
        mark("test-monotonic");

        let timings = snapshot().expect("init ran, so a snapshot exists");
        let mut previous = 0.0_f64;
        for m in &timings.marks {
            assert!(m.at_ms >= previous, "{} went backwards", m.name);
            previous = m.at_ms;
        }
        assert!(
            previous <= timings.elapsed_ms,
            "no mark is later than the snapshot itself"
        );
    }
}
