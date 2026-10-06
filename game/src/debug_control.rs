//! Debug/verification control surface for the game DLL.
//!
//! This entire module — and its dispatch arms in `app_socket` / `game_state` — is compiled out of
//! release DLLs via `#[cfg(debug_assertions)]`. Anything that lets the app (or, transitively, any
//! external tooling talking to the app) query or drive a running game session MUST live here and
//! nowhere else: keeping the whole risky surface in one module makes it trivially auditable, and
//! more importantly means a release build simply does not contain the code. A runtime `if
//! cfg!(debug_assertions)` guard would NOT be sufficient — the code would still ship in the
//! release binary and remain a viable patch target for anyone willing to flip the check in-memory.

use std::mem;
use std::ptr::null_mut;
use std::slice;

use base64::prelude::{BASE64_STANDARD, Engine as _};
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use winapi::shared::windef::{HGDIOBJ, RECT};
use winapi::um::wingdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleDC, CreateDIBSection,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GdiFlush, RGBQUAD, SRCCOPY, SelectObject,
};
use winapi::um::winuser::{GetDC, GetWindowRect, PW_RENDERFULLCONTENT, PrintWindow, ReleaseDC};

/// Commands the app can send down the `debugControl` websocket command (debug builds only).
#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DebugControlCommand {
    /// Capture this client's own game window via GDI/PrintWindow and reply on
    /// `/game/debug/screenshot` with a base64-encoded PNG.
    Screenshot,
    /// Deliberately crash THIS client's game process on the async thread with the given fault, to
    /// exercise the crash handler end to end. No reply, the process dies: verify via the
    /// `[CRASH]` lines in the game log, a fresh non-empty `latest_crash.dmp`, and the crash exit
    /// code the app records.
    Crash { kind: DebugCrashKind },
}

/// The fault [`DebugControlCommand::Crash`] raises.
#[derive(Debug, Deserialize, Clone, Copy, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DebugCrashKind {
    /// Write through an invalid pointer: the ordinary crash the handler has always been able to
    /// dump.
    AccessViolation,
    /// Recurse until the thread's stack is exhausted: the crash whose dump has to be written from
    /// another thread, since the faulting one has no stack left to write it with.
    StackOverflow,
}

/// Raises the requested fault on the calling thread. Never returns normally.
pub fn crash(kind: DebugCrashKind) {
    warn!("debugControl: crashing with {kind:?}");
    match kind {
        DebugCrashKind::AccessViolation => unsafe {
            let target = std::hint::black_box(0x10usize) as *mut u32;
            std::ptr::write_volatile(target, 0xdead_beef);
        },
        DebugCrashKind::StackOverflow => {
            let depth = exhaust_stack(0);
            warn!("debugControl: stack overflow recursion returned at depth {depth}");
        }
    }
}

fn exhaust_stack(depth: usize) -> usize {
    // A page-sized frame the optimizer can't drop, and a recursion it can't prove unconditional.
    let mut frame = [0u8; 4096];
    frame[depth % frame.len()] = depth as u8;
    std::hint::black_box(&frame);
    if std::hint::black_box(true) {
        1 + exhaust_stack(depth + 1)
    } else {
        depth
    }
}

/// Reply payload for [`DebugControlCommand::Screenshot`], sent on `/game/debug/screenshot`.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScreenshotResponse {
    /// `None` when capture failed; `error` then says why.
    pub screenshot: Option<DebugScreenshot>,
    pub error: Option<String>,
}

/// A single captured frame of the game window.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScreenshot {
    pub width: u32,
    pub height: u32,
    /// The captured frame, encoded as a base64 PNG.
    pub png_base64: String,
}

/// Captures this client's own game window and returns it as a PNG, or an error message
/// describing why the capture failed.
///
/// This is a blocking call meant to run on a worker thread (`tokio::task::spawn_blocking`), never
/// on the game thread: it only reads pixels back from the window through GDI/DWM and never
/// touches BW memory.
pub fn capture_screenshot() -> DebugScreenshotResponse {
    match try_capture_screenshot() {
        Ok(screenshot) => DebugScreenshotResponse {
            screenshot: Some(screenshot),
            error: None,
        },
        Err(message) => DebugScreenshotResponse {
            screenshot: None,
            error: Some(message),
        },
    }
}

fn try_capture_screenshot() -> Result<DebugScreenshot, String> {
    let hwnd = crate::forge::debug_window_handle()
        .ok_or_else(|| "game window not created yet".to_string())?;

    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err(format!("GetWindowRect failed: {}", last_error()));
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return Err(format!(
            "game window has no visible area ({width}x{height})"
        ));
    }

    let bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            // Negative height requests a top-down DIB, so the pixel rows we read back are
            // already in top-to-bottom order.
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD {
            rgbBlue: 0,
            rgbGreen: 0,
            rgbRed: 0,
            rgbReserved: 0,
        }],
    };

    let mem_dc = unsafe { CreateCompatibleDC(null_mut()) };
    if mem_dc.is_null() {
        return Err(format!("CreateCompatibleDC failed: {}", last_error()));
    }
    scopeguard::defer! {
        unsafe { DeleteDC(mem_dc); }
    }

    let mut bits: *mut winapi::ctypes::c_void = null_mut();
    let bitmap = unsafe {
        CreateDIBSection(
            mem_dc,
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            null_mut(),
            0,
        )
    };
    if bitmap.is_null() || bits.is_null() {
        return Err(format!("CreateDIBSection failed: {}", last_error()));
    }
    scopeguard::defer! {
        unsafe { DeleteObject(bitmap as HGDIOBJ); }
    }

    let previous_object = unsafe { SelectObject(mem_dc, bitmap as HGDIOBJ) };
    scopeguard::defer! {
        unsafe { SelectObject(mem_dc, previous_object); }
    }

    let printed = unsafe { PrintWindow(hwnd, mem_dc, PW_RENDERFULLCONTENT) };
    if printed == 0 {
        // Fall back to a plain BitBlt from the window's own DC. This won't capture
        // DWM-composited content correctly on all configurations, but it's better than nothing
        // if PrintWindow's newer flag isn't supported.
        let window_dc = unsafe { GetDC(hwnd) };
        if window_dc.is_null() {
            return Err("PrintWindow failed and GetDC fallback returned null".to_string());
        }
        scopeguard::defer! {
            unsafe { ReleaseDC(hwnd, window_dc); }
        }

        let blitted = unsafe { BitBlt(mem_dc, 0, 0, width, height, window_dc, 0, 0, SRCCOPY) };
        if blitted == 0 {
            return Err(format!(
                "PrintWindow and BitBlt fallback both failed: {}",
                last_error()
            ));
        }
    }

    unsafe { GdiFlush() };

    let width = width as u32;
    let height = height as u32;
    let pixel_count = (width as usize) * (height as usize);
    // Safety: `bits` was populated by `CreateDIBSection` for a top-down 32bpp DIB of exactly
    // `width * height` pixels, and `GdiFlush` above ensures the GDI writes into it are visible to
    // this thread before we read it back.
    let bgra = unsafe { slice::from_raw_parts(bits as *const u8, pixel_count * 4) };

    let mut rgba = Vec::with_capacity(bgra.len());
    for pixel in bgra.as_chunks::<4>().0 {
        // 32bpp BI_RGB stores each pixel as B, G, R, then a fourth byte GDI leaves undefined, so
        // reorder to RGB and force full opacity rather than trusting that byte as alpha.
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 0xFF]);
    }

    let mut png_bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png_bytes)
        .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("PNG encode failed: {e}"))?;

    Ok(DebugScreenshot {
        width,
        height,
        png_base64: BASE64_STANDARD.encode(&png_bytes),
    })
}

fn last_error() -> std::io::Error {
    std::io::Error::last_os_error()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_command_parses_camel_case() {
        let cmd: DebugControlCommand = serde_json::from_str(r#"{"type":"screenshot"}"#).unwrap();
        assert_eq!(cmd, DebugControlCommand::Screenshot);
    }

    #[test]
    fn screenshot_response_serializes_camel_case_on_success() {
        let response = DebugScreenshotResponse {
            screenshot: Some(DebugScreenshot {
                width: 1280,
                height: 720,
                png_base64: "abc123".to_string(),
            }),
            error: None,
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "screenshot": {
                    "width": 1280,
                    "height": 720,
                    "pngBase64": "abc123",
                },
                "error": null,
            })
        );
    }

    #[test]
    fn screenshot_response_serializes_camel_case_on_failure() {
        let response = DebugScreenshotResponse {
            screenshot: None,
            error: Some("game window not created yet".to_string()),
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "screenshot": null,
                "error": "game window not created yet",
            })
        );
    }
}
