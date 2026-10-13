//! Saves a picture of the map being played, for the minimap on the game's stats page.
//!
//! It's made from the terrain the game has loaded: each tile as the map made it, before any creep
//! covered it, the tile's megatile, the megatile's 16 minitiles, and the palette. Each minitile
//! becomes one pixel, the average of its colors, so a 128 by 128 map makes a 512 by 512 picture.
//! It's only the terrain: the stats page draws mineral fields and geysers over it where it wants
//! them, and shows it bare behind a map's name elsewhere. Each map is saved once, as
//! `minimaps/<id>.png`, named for a hash of the picture.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::fs;
use std::path::PathBuf;

use image::{ImageFormat, Rgb, RgbImage};
use ring::digest;

use crate::bw::{self, get_bw};

/// Bumped when the pictures change, so a map's picture is made again.
const MINIMAP_VERSION: &[u8] = b"2";
/// Minitiles across, and down, each megatile.
const MINITILES_PER_TILE: usize = 4;
/// The size of each of the tileset's tile groups, and where in one the megatiles of its 16 tiles
/// are, a u16 each.
const CV5_GROUP_SIZE: usize = 52;
const CV5_MEGATILES_OFFSET: usize = 20;
/// The largest map, in tiles.
const MAX_MAP_SIZE: usize = 256;

/// Where the loaded map's terrain is kept in the game's memory.
pub struct Terrain {
    /// See `scr_analysis::Analysis::tileset_indexed_map_tiles`.
    pub tiles: *mut u16,
    /// See `scr_analysis::Analysis::creep_original_tiles`.
    pub original_tiles: *mut u16,
    /// See `scr_analysis::Analysis::tileset_cv5`.
    pub cv5: *mut u8,
    /// The tileset's megatiles, see `scr_analysis::Analysis::tileset_vx4ex`.
    pub vx4ex: *mut u32,
    /// The tileset's minitiles, 8x8 palette indexes each.
    pub minitiles: *mut u8,
    /// The palette, 4 bytes to a color, red first.
    pub palette: *mut u8,
}

fn minimaps_dir() -> PathBuf {
    crate::parse_args().user_data_path.join("minimaps")
}

/// Saves a picture of the map being played, unless one was saved before, and returns its id.
/// `None` if the terrain couldn't be read.
///
/// # Safety
///
/// Must run on the game thread once the game has started.
pub unsafe fn save(game: *mut bw::Game) -> Option<String> {
    let terrain = get_bw().terrain()?;
    let (width, height) = unsafe {
        (
            usize::from((*game).map_width_tiles),
            usize::from((*game).map_height_tiles),
        )
    };
    if width == 0 || height == 0 || width > MAX_MAP_SIZE || height > MAX_MAP_SIZE {
        warn!("Can't make a minimap of a {width}x{height} map");
        return None;
    }
    let picture = unsafe { draw(&terrain, width, height) };

    let mut hash = digest::Context::new(&digest::SHA256);
    hash.update(MINIMAP_VERSION);
    hash.update(&(width as u32).to_le_bytes());
    hash.update(&(height as u32).to_le_bytes());
    hash.update(picture.as_raw());
    let id: String = hash.finish().as_ref()[..12]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();

    let dir = minimaps_dir();
    let path = dir.join(format!("{id}.png"));
    if !path.exists() {
        let temp = dir.join(format!("{id}.png.tmp"));
        std::thread::spawn(move || {
            let result = fs::create_dir_all(&dir)
                .and_then(|()| {
                    picture
                        .save_with_format(&temp, ImageFormat::Png)
                        .map_err(std::io::Error::other)
                })
                .and_then(|()| fs::rename(&temp, &path));
            match result {
                Ok(()) => info!("Saved the minimap {}", path.display()),
                Err(e) => warn!("Couldn't save the minimap {}: {e}", path.display()),
            }
        });
    }
    Some(id)
}

/// Draws the map, one pixel per minitile.
unsafe fn draw(terrain: &Terrain, width: usize, height: usize) -> RgbImage {
    let palette = unsafe { std::slice::from_raw_parts(terrain.palette, 256 * 4) };
    let tiles = unsafe { std::slice::from_raw_parts(terrain.tiles, width * height) };
    // Creep that's on the map when it starts depends on where Zerg players started, so it's left
    // off, and every game on a map gets the same picture.
    let original_tiles =
        unsafe { std::slice::from_raw_parts(terrain.original_tiles, width * height) };
    // Most maps use a few thousand of the tileset's minitiles over and over.
    let mut colors: HashMap<u32, [u8; 3]> = HashMap::new();
    let mut picture = RgbImage::new(
        (width * MINITILES_PER_TILE) as u32,
        (height * MINITILES_PER_TILE) as u32,
    );
    for (i, (&tile, &original)) in tiles.iter().zip(original_tiles).enumerate() {
        let tile = if original != 0 { original } else { tile };
        let (group, index) = (usize::from(tile >> 4), usize::from(tile & 0xf));
        let megatile = unsafe {
            *(terrain
                .cv5
                .add(group * CV5_GROUP_SIZE + CV5_MEGATILES_OFFSET + index * 2)
                as *const u16)
        };
        let (tile_x, tile_y) = (i % width, i / width);
        for m in 0..MINITILES_PER_TILE * MINITILES_PER_TILE {
            let reference = unsafe {
                *terrain
                    .vx4ex
                    .add(usize::from(megatile) * MINITILES_PER_TILE * MINITILES_PER_TILE + m)
            };
            // The low bit only says whether it's flipped, which doesn't change its average.
            let minitile = reference >> 1;
            let color = match colors.entry(minitile) {
                Entry::Occupied(e) => *e.get(),
                Entry::Vacant(e) => {
                    let pixels = unsafe {
                        std::slice::from_raw_parts(
                            terrain.minitiles.add(minitile as usize * 64),
                            64,
                        )
                    };
                    *e.insert(average(pixels, palette))
                }
            };
            let x = tile_x * MINITILES_PER_TILE + m % MINITILES_PER_TILE;
            let y = tile_y * MINITILES_PER_TILE + m / MINITILES_PER_TILE;
            picture.put_pixel(x as u32, y as u32, Rgb(color));
        }
    }
    picture
}

/// The average color of a minitile's pixels.
fn average(pixels: &[u8], palette: &[u8]) -> [u8; 3] {
    let mut sum = [0u32; 3];
    for &index in pixels {
        let color = &palette[usize::from(index) * 4..][..3];
        for (total, &channel) in sum.iter_mut().zip(color) {
            *total += u32::from(channel);
        }
    }
    sum.map(|total| (total / pixels.len() as u32) as u8)
}
