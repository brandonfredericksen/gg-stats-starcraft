//! Saves a picture of the map being played, for the minimap on the game's stats page.
//!
//! It's made from the terrain the game has loaded: each tile's megatile, the megatile's 16
//! minitiles, and the palette. Each minitile becomes one pixel, the average of its colors, so a
//! 128 by 128 map makes a 512 by 512 picture. Mineral fields and geysers are drawn over it as
//! they stand when the game starts. Each map is saved once, as `minimaps/<id>.png`, named
//! for a hash of the picture, so two versions of a map with the same name don't share one.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::fs;
use std::path::PathBuf;

use bw_dat::unit;
use image::{ImageFormat, Rgb, RgbImage};
use ring::digest;

use crate::bw::{self, Bw, get_bw};

/// Bumped when the pictures change, so a map's picture is made again.
const MINIMAP_VERSION: &[u8] = b"1";
/// Minitiles across, and down, each megatile.
const MINITILES_PER_TILE: usize = 4;
/// The high bit of a tile's megatile is a flag of the game's own.
const MEGATILE_MASK: u16 = 0x7fff;
/// Pixels of the map to each pixel of the picture.
const PIXELS_PER_POINT: i32 = 32 / MINITILES_PER_TILE as i32;
/// The colors mineral fields and geysers are drawn in, close to the game's own minimap.
const MINERALS_COLOR: Rgb<u8> = Rgb([92, 164, 252]);
const GEYSER_COLOR: Rgb<u8> = Rgb([64, 196, 112]);
/// The largest map, in tiles.
const MAX_MAP_SIZE: usize = 256;

/// Where the loaded map's terrain is kept in the game's memory.
pub struct Terrain {
    /// The megatile of each of the map's tiles, the map's width to a row.
    pub megatiles: *mut u16,
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
    let mut picture = unsafe { draw(&terrain, width, height) };
    unsafe { draw_resources(&mut picture) };

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
    let megatiles = unsafe { std::slice::from_raw_parts(terrain.megatiles, width * height) };
    // Most maps use a few thousand of the tileset's minitiles over and over.
    let mut colors: HashMap<u32, [u8; 3]> = HashMap::new();
    let mut picture = RgbImage::new(
        (width * MINITILES_PER_TILE) as u32,
        (height * MINITILES_PER_TILE) as u32,
    );
    for (i, &tile) in megatiles.iter().enumerate() {
        let megatile = tile & MEGATILE_MASK;
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

/// Draws each mineral field and geyser over the map, as a block the size of the ground it covers.
unsafe fn draw_resources(picture: &mut RgbImage) {
    for unit in unsafe { get_bw().active_units() } {
        let color = match unit.id() {
            unit::MINERAL_FIELD_1 | unit::MINERAL_FIELD_2 | unit::MINERAL_FIELD_3 => MINERALS_COLOR,
            unit::VESPENE_GEYSER => GEYSER_COLOR,
            _ => continue,
        };
        let position = unit.position();
        let placement = unit.id().placement();
        let (half_width, half_height) = (
            i32::from(placement.width) / 2,
            i32::from(placement.height) / 2,
        );
        let to_picture = |pixels: i32| (pixels / PIXELS_PER_POINT).max(0) as u32;
        let (left, right) = (
            to_picture(i32::from(position.x) - half_width),
            to_picture(i32::from(position.x) + half_width),
        );
        let (top, bottom) = (
            to_picture(i32::from(position.y) - half_height),
            to_picture(i32::from(position.y) + half_height),
        );
        for y in top..bottom.min(picture.height()) {
            for x in left..right.min(picture.width()) {
                picture.put_pixel(x, y, color);
            }
        }
    }
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
