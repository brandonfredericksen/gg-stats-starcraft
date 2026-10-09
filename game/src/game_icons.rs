//! Saves StarCraft's command card icons, the pictures of every unit, building, tech and upgrade,
//! to the app's data folder, so the app can show them the way the game draws them.
//!
//! The icons come from the player's own install. A game analyzing a replay in the background
//! never draws the command card, so it never loads them: once the game has opened an image of
//! its own, the icons are opened the same way and a copy is kept. Once the game's data is loaded,
//! the icons are decoded into one sheet (`cmdicons.png`), with a list of which icon is which
//! (`cmdicons.json`). That's done once, and again only to replace the small SD icons with HD
//! ones.

use std::fs;
use std::io::Cursor;
use std::mem::MaybeUninit;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use image::codecs::dds::DdsDecoder;
use image::imageops::{self, FilterType};
use image::{DynamicImage, ImageFormat, RgbaImage};
use libc::c_void;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::bw_scr::scr;

/// The file the game keeps its command card icons in, spelled the way the game asks for its
/// images: the classic `.grp` name, with the `.dds.grp` extension in the open params.
const CMDICONS_PATH: &[u8] = b"unit\\cmdicons\\cmdicons.grp\0";
/// The file types the game opens its SD and HD images as.
const SD_FILE_TYPE: u32 = 1;
const HD_FILE_TYPE: u32 = 4;

/// Bumped when the sheet or its list changes, so an older one is made again.
const ICONS_VERSION: u32 = 3;
/// Each icon's square in the sheet, in pixels. HD icons are scaled down to it.
const CELL_SIZE: u32 = 64;
/// Icons in each row of the sheet.
const COLUMNS: u32 = 16;
/// Entries in the game's units, upgrades and tech data.
const UNIT_COUNT: u16 = 228;
const UPGRADE_COUNT: u16 = 61;
const TECH_COUNT: u16 = 44;
/// The largest file kept, well past the real one, so a broken read can't take much memory.
const MAX_FILE_SIZE: u32 = 64 * 1024 * 1024;

/// The list saved next to the sheet: where each icon is, and which icon each thing uses.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IconsManifest {
    version: u32,
    hd: bool,
    cell_size: u32,
    columns: u32,
    count: u32,
    /// The icon of each unit and building, by unit id.
    units: Vec<u32>,
    /// The icon of each upgrade, by upgrade id.
    upgrades: Vec<u32>,
    /// The icon of each tech, by tech id.
    techs: Vec<u32>,
}

/// The icons file as the game read it, and whether it's the HD one.
struct Captured {
    hd: bool,
    bytes: Vec<u8>,
}

static CAPTURED: Mutex<Option<Captured>> = Mutex::new(None);
/// Whether the SD and the HD icons have been tried, so each is opened at most once.
static TRIED: Mutex<[bool; 2]> = Mutex::new([false, false]);

fn icons_dir() -> PathBuf {
    crate::parse_args().user_data_path.join("game-icons")
}

/// Whether icons are already saved, and if so whether they're HD: `None` if there are none, or
/// they're from an older version.
fn saved_hd() -> Option<bool> {
    static SAVED: OnceLock<Option<bool>> = OnceLock::new();
    *SAVED.get_or_init(|| {
        let text = fs::read(icons_dir().join("cmdicons.json")).ok()?;
        let manifest: IconsManifest = serde_json::from_slice(&text).ok()?;
        (manifest.version == ICONS_VERSION).then_some(manifest.hd)
    })
}

/// Whether icons of this kind would be better than the ones saved or captured so far.
fn wants(hd: bool) -> bool {
    let best = CAPTURED.lock().as_ref().map(|c| c.hd).or(saved_hd());
    match best {
        None => true,
        Some(have_hd) => hd && !have_hd,
    }
}

/// Once the game has opened an image of its own, opens the icons the same way, SD or HD, and
/// keeps a copy of them.
///
/// # Safety
/// `params` must be what the game opened that image with, and `open` the game's own file opener.
pub unsafe fn on_dds_grp_opened(
    params: *const scr::OpenParams,
    open: unsafe extern "C" fn(
        *mut scr::FileHandle,
        *const u8,
        *const scr::OpenParams,
    ) -> *mut scr::FileHandle,
) {
    unsafe {
        let hd = match (*params).file_type {
            SD_FILE_TYPE => false,
            HD_FILE_TYPE => true,
            _ => return,
        };
        if std::mem::replace(&mut TRIED.lock()[hd as usize], true) || !wants(hd) {
            return;
        }
        let mut storage = MaybeUninit::<scr::FileHandle>::zeroed();
        let handle = open(storage.as_mut_ptr(), CMDICONS_PATH.as_ptr(), params);
        if handle.is_null() || (*handle).vtable.is_null() || (*handle).file_ok == 0 {
            warn!("Couldn't open the command card icons (HD: {hd})");
            return;
        }
        capture(handle, hd);
        let vtable = (*handle).vtable;
        (*vtable).destroy.call2(handle, 0);
    }
}

/// Keeps a copy of an opened icons file.
///
/// # Safety
/// `handle` must be a file handle the game's own file opener returned.
unsafe fn capture(handle: *mut scr::FileHandle, hd: bool) {
    if handle.is_null() || !wants(hd) {
        return;
    }
    let bytes = unsafe {
        if (*handle).file_ok == 0 {
            return;
        }
        // The position functions take the handle's third vtable field as their `this`.
        let position_this = &raw mut (*handle).vtable3 as *mut c_void;
        let vtable3 = (*handle).vtable3;
        let start = (*vtable3).tell.call1(position_this);
        let size = (*vtable3).file_size.call1(position_this);
        if size == 0 || size > MAX_FILE_SIZE {
            warn!("Command card icons are {size} bytes, not keeping them");
            return;
        }
        let mut bytes = vec![0u8; size as usize];
        let mut read = 0;
        let vtable = (*handle).vtable;
        while read < bytes.len() {
            let out = bytes.as_mut_ptr().add(read);
            let count = (*vtable)
                .read
                .call3(handle, out, (bytes.len() - read) as u32);
            if count == 0 {
                break;
            }
            read += count as usize;
        }
        (*vtable3).seek.call2(position_this, start);
        bytes.truncate(read);
        bytes
    };
    debug!(
        "Kept the command card icons ({} bytes, HD: {hd})",
        bytes.len()
    );
    *CAPTURED.lock() = Some(Captured { hd, bytes });
}

/// Saves the icons kept while the game started, if they're better than any saved before. Reads
/// which icon each thing uses from the game's data, so it must run once that's loaded, on the
/// game thread; the decoding and writing happen on a thread of their own.
pub fn save_captured() {
    let Some(captured) = CAPTURED.lock().take() else {
        return;
    };
    let mut units: Vec<u32> = (0..UNIT_COUNT).map(u32::from).collect();
    // The SD icons have the Lair's and the Hive's the other way around.
    if !captured.hd {
        units.swap(bw_dat::unit::LAIR.0 as usize, bw_dat::unit::HIVE.0 as usize);
    }
    let upgrades = (0..UPGRADE_COUNT)
        .map(|id| bw_dat::UpgradeId(id).icon())
        .collect();
    let techs = (0..TECH_COUNT)
        .map(|id| bw_dat::TechId(id).icon())
        .collect();
    let dir = icons_dir();
    std::thread::spawn(move || {
        let result = write_icons(&dir, &captured, units, upgrades, techs);
        match result {
            Ok(count) => info!("Saved {count} command card icons (HD: {})", captured.hd),
            Err(e) => warn!("Couldn't save the command card icons: {e}"),
        }
    });
}

fn write_icons(
    dir: &Path,
    captured: &Captured,
    units: Vec<u32>,
    upgrades: Vec<u32>,
    techs: Vec<u32>,
) -> Result<u32, String> {
    let frames = read_frames(&captured.bytes)?;
    let count = frames.len() as u32;
    let rows = count.div_ceil(COLUMNS);
    let mut sheet = RgbaImage::new(COLUMNS * CELL_SIZE, rows * CELL_SIZE);
    for (i, frame) in frames.iter().enumerate() {
        let Some(frame) = frame else {
            continue;
        };
        let scale = CELL_SIZE as f32 / frame.width().max(frame.height()) as f32;
        let fitted = if scale < 1.0 {
            let width = ((frame.width() as f32 * scale).round() as u32).max(1);
            let height = ((frame.height() as f32 * scale).round() as u32).max(1);
            imageops::resize(frame, width, height, FilterType::Lanczos3)
        } else {
            frame.clone()
        };
        let x = (i as u32 % COLUMNS) * CELL_SIZE + (CELL_SIZE - fitted.width()) / 2;
        let y = (i as u32 / COLUMNS) * CELL_SIZE + (CELL_SIZE - fitted.height()) / 2;
        imageops::replace(&mut sheet, &fitted, x as i64, y as i64);
    }

    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let sheet_temp = dir.join("cmdicons.png.tmp");
    sheet
        .save_with_format(&sheet_temp, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    fs::rename(&sheet_temp, dir.join("cmdicons.png")).map_err(|e| e.to_string())?;
    // The list goes last, so a sheet is only used once it's all there.
    let manifest = IconsManifest {
        version: ICONS_VERSION,
        hd: captured.hd,
        cell_size: CELL_SIZE,
        columns: COLUMNS,
        count,
        units,
        upgrades,
        techs,
    };
    let json = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    fs::write(dir.join("cmdicons.json"), json).map_err(|e| e.to_string())?;
    Ok(count)
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// Each frame of a `.dds.grp`: a header with the frame count, then each frame's size and its DDS
/// image. A frame that can't be decoded is `None`, so the others keep their places.
fn read_frames(bytes: &[u8]) -> Result<Vec<Option<RgbaImage>>, String> {
    let frame_count = u16_at(bytes, 4).ok_or("the icons file is too short")?;
    let mut at = 8;
    let mut frames = Vec::with_capacity(frame_count as usize);
    for i in 0..frame_count {
        let size = u32_at(bytes, at + 8).ok_or(format!("frame {i} has no header"))? as usize;
        let data = bytes
            .get(at + 12..at + 12 + size)
            .ok_or(format!("frame {i} runs past the end"))?;
        let frame = decode_dds(data);
        if let Err(e) = &frame {
            warn!("Command card icon {i} couldn't be decoded: {e}");
        }
        frames.push(frame.ok().map(to_shape));
        at += 12 + size;
    }
    Ok(frames)
}

/// An icon as white, as opaque as it's bright. The game draws its icons gray on black and tints
/// them as it draws them, so this keeps only their shape, for the app to tint the same way. Each
/// icon's brightest part is made fully opaque, and its midtones lifted, so it reads when small.
fn to_shape(mut image: RgbaImage) -> RgbaImage {
    const MIDTONE_LIFT: f32 = 0.7;
    let bright = |pixel: &image::Rgba<u8>| {
        let [r, g, b, a] = pixel.0;
        r.max(g).max(b) as f32 * a as f32 / 255.0
    };
    let brightest = image.pixels().map(bright).fold(0.0f32, f32::max);
    if brightest <= 0.0 {
        return image;
    }
    for pixel in image.pixels_mut() {
        let alpha = (bright(pixel) / brightest).powf(MIDTONE_LIFT) * 255.0;
        pixel.0 = [255, 255, 255, alpha.round() as u8];
    }
    image
}

/// A DDS image's pixels: block compressed ones by the `image` crate, plain 32 bit ones by hand.
fn decode_dds(data: &[u8]) -> Result<RgbaImage, String> {
    if data.get(..4) != Some(b"DDS ") {
        return Err("not a DDS image".into());
    }
    if let Ok(decoder) = DdsDecoder::new(Cursor::new(data)) {
        return DynamicImage::from_decoder(decoder)
            .map(|image| image.to_rgba8())
            .map_err(|e| e.to_string());
    }
    const PIXELS_HAVE_RGB: u32 = 0x40;
    let height = u32_at(data, 12).ok_or("no height")?;
    let width = u32_at(data, 16).ok_or("no width")?;
    let flags = u32_at(data, 80).ok_or("no pixel format")?;
    let bits = u32_at(data, 88).ok_or("no pixel format")?;
    if flags & PIXELS_HAVE_RGB == 0 || bits != 32 {
        let four_cc = data.get(84..88).unwrap_or_default();
        return Err(format!(
            "unsupported pixel format {:?}, {bits} bits",
            String::from_utf8_lossy(four_cc)
        ));
    }
    let masks = [92, 96, 100, 104].map(|at| u32_at(data, at).unwrap_or(0));
    let pixels = data
        .get(128..128 + (width * height * 4) as usize)
        .ok_or("the pixels run past the end")?;
    let channel = |pixel: u32, mask: u32| {
        if mask == 0 {
            255
        } else {
            ((pixel & mask) >> mask.trailing_zeros()) as u8
        }
    };
    let mut image = RgbaImage::new(width, height);
    let (chunks, _) = pixels.as_chunks::<4>();
    for (i, chunk) in chunks.iter().enumerate() {
        let pixel = u32::from_le_bytes(*chunk);
        let rgba = masks.map(|mask| channel(pixel, mask));
        image.put_pixel(i as u32 % width, i as u32 / width, image::Rgba(rgba));
    }
    Ok(image)
}
