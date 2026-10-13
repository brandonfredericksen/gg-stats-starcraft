//! Where each player's units were over the game, for the minimap on the game's stats page: a
//! position for each unit every scan, where each building stood, where each unit died, and where
//! the mineral fields and geysers were when it started.
//!
//! Everything is packed into a small binary format (see [`UnitPositions::encode`]), since a long
//! team game has hundreds of thousands of positions.

use bw_dat::{UnitId, unit};
use hashbrown::HashMap;

use super::{NOT_PRODUCED, PLAYER_COUNT, SeenUnit, UNIT_TYPE_COUNT};
use crate::bw;

/// Bumped when the encoding changes.
const ENCODING_VERSION: u8 = 1;
/// Positions are kept to 8 pixels, a quarter of a tile, which is finer than a minimap shows.
const POSITION_SHIFT: u8 = 3;

/// What a unit is to the minimap, which decides how it's drawn and whether it adds to the heat
/// of an army's presence.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum MapKind {
    Army = 0,
    Worker = 1,
    /// Overlords and Observers, which go places without fighting.
    Support = 2,
    Building = 3,
}

/// What the minimap needs to know about each unit type.
pub struct MapUnits {
    /// `None` for units left off the minimap: larvae, eggs and cocoons, parts of other units,
    /// ammunition and spell effects.
    pub kind: [Option<MapKind>; UNIT_TYPE_COUNT],
    /// In halves, since Zerglings and Scourge take half a supply each.
    pub supply: [u8; UNIT_TYPE_COUNT],
    /// The ground a building covers, in tiles.
    pub footprint: [(u8, u8); UNIT_TYPE_COUNT],
}

impl MapUnits {
    /// Reads the unit types from the game's unit data, which is loaded by the time a game starts.
    pub fn from_game_data() -> MapUnits {
        let kind = std::array::from_fn(|i| {
            let id = UnitId(i as u16);
            if id.is_building() {
                Some(MapKind::Building)
            } else if id == unit::OVERLORD || id == unit::OBSERVER {
                Some(MapKind::Support)
            } else if id.is_worker() {
                Some(MapKind::Worker)
            } else if id == unit::BROODLING {
                // Spawned rather than produced, but they fight like any other unit.
                Some(MapKind::Army)
            } else if NOT_PRODUCED[i] || id == unit::NUCLEAR_MISSILE {
                None
            } else {
                Some(MapKind::Army)
            }
        });
        MapUnits {
            kind,
            supply: std::array::from_fn(|i| {
                UnitId(i as u16).supply_cost().min(u32::from(u8::MAX)) as u8
            }),
            footprint: std::array::from_fn(|i| {
                let placement = UnitId(i as u16).placement();
                let tiles = |pixels: u16| pixels.div_ceil(32).min(u16::from(u8::MAX)) as u8;
                (tiles(placement.width), tiles(placement.height))
            }),
        }
    }
}

/// Marines, SCVs and Command Centers.
#[cfg(test)]
pub fn test_units() -> MapUnits {
    let mut kind = [None; UNIT_TYPE_COUNT];
    let mut supply = [0; UNIT_TYPE_COUNT];
    let mut footprint = [(0, 0); UNIT_TYPE_COUNT];
    kind[unit::MARINE.0 as usize] = Some(MapKind::Army);
    supply[unit::MARINE.0 as usize] = 2;
    kind[unit::SCV.0 as usize] = Some(MapKind::Worker);
    supply[unit::SCV.0 as usize] = 2;
    kind[unit::COMMAND_CENTER.0 as usize] = Some(MapKind::Building);
    footprint[unit::COMMAND_CENTER.0 as usize] = (4, 3);
    MapUnits {
        kind,
        supply,
        footprint,
    }
}

/// One unit's positions, from the scan it was first seen in. A unit stays the same track while
/// it's inside a transport or bunker, and is missing from the scans until it comes out.
struct Track {
    slot: u8,
    id: UnitId,
    first_sample: u32,
    /// Positions by scan since `first_sample`, `None` for scans the unit wasn't in.
    positions: Vec<Option<(u16, u16)>>,
}

struct Building {
    slot: u8,
    id: UnitId,
    position: (u16, u16),
    start_frame: u32,
    end_frame: Option<u32>,
}

/// A mineral field or geyser, as the game started.
struct Resource {
    geyser: bool,
    id: UnitId,
    position: (u16, u16),
}

struct Death {
    frame: u32,
    slot: u8,
    id: UnitId,
    position: (u16, u16),
}

/// Where a unit or building being followed is recorded.
#[derive(Copy, Clone)]
enum Followed {
    Track(usize),
    Building(usize),
}

pub struct UnitPositions {
    units: MapUnits,
    sample_frames: Vec<u32>,
    tracks: Vec<Track>,
    buildings: Vec<Building>,
    deaths: Vec<Death>,
    resources: Vec<Resource>,
    /// The units and buildings seen in the last scan, by the game's unit they are.
    followed: HashMap<usize, Followed>,
}

fn quantize(point: &bw::Point) -> (u16, u16) {
    let at = |v: i16| (v.max(0) as u16) >> POSITION_SHIFT;
    (at(point.x), at(point.y))
}

impl UnitPositions {
    pub fn new(units: MapUnits) -> UnitPositions {
        UnitPositions {
            units,
            sample_frames: Vec::new(),
            tracks: Vec::new(),
            buildings: Vec::new(),
            deaths: Vec::new(),
            resources: Vec::new(),
            followed: HashMap::new(),
        }
    }

    fn kind(&self, id: UnitId) -> Option<MapKind> {
        self.units.kind.get(id.0 as usize).copied().flatten()
    }

    /// Records where every unit on the minimap is at `frame`.
    pub fn record_sample(&mut self, units: &[SeenUnit], frame: u32) {
        let sample = self.sample_frames.len() as u32;
        self.sample_frames.push(frame);
        let mut seen = HashMap::with_capacity(self.followed.len());
        for unit in units {
            let Some(kind) = self.kind(unit.id) else {
                continue;
            };
            let position = quantize(&unit.position);
            let slot = unit.slot as u8;
            let followed = match self.followed.get(&unit.key).copied() {
                // A unit that morphed, was taken over, landed or lifted off is followed anew.
                Some(Followed::Track(i))
                    if !unit.landed
                        && self.tracks[i].id == unit.id
                        && self.tracks[i].slot == slot =>
                {
                    let track = &mut self.tracks[i];
                    let at = (sample - track.first_sample) as usize;
                    track.positions.resize(at, None);
                    track.positions.push(Some(position));
                    Followed::Track(i)
                }
                // A building morphing into another, like a Lair, is the same building.
                Some(Followed::Building(i))
                    if unit.landed
                        && self.buildings[i].slot == slot
                        && self.buildings[i].position == position =>
                {
                    self.buildings[i].id = unit.id;
                    Followed::Building(i)
                }
                previous => {
                    if let Some(previous) = previous {
                        self.stop_following(previous, frame);
                    }
                    if unit.landed && kind == MapKind::Building {
                        self.buildings.push(Building {
                            slot,
                            id: unit.id,
                            position,
                            start_frame: frame,
                            end_frame: None,
                        });
                        Followed::Building(self.buildings.len() - 1)
                    } else {
                        self.tracks.push(Track {
                            slot,
                            id: unit.id,
                            first_sample: sample,
                            positions: vec![Some(position)],
                        });
                        Followed::Track(self.tracks.len() - 1)
                    }
                }
            };
            seen.insert(unit.key, followed);
        }
        // Units missing from this scan are hidden inside something, so their track goes on, but a
        // building that's gone was destroyed or canceled.
        for (key, followed) in self.followed.drain() {
            match followed {
                Followed::Building(i) if !seen.contains_key(&key) => {
                    self.buildings[i].end_frame.get_or_insert(frame);
                }
                Followed::Track(_) if !seen.contains_key(&key) => {
                    seen.insert(key, followed);
                }
                _ => (),
            }
        }
        self.followed = seen;
    }

    fn stop_following(&mut self, followed: Followed, frame: u32) {
        if let Followed::Building(i) = followed {
            self.buildings[i].end_frame.get_or_insert(frame);
        }
    }

    /// Stops following a unit the game took away, since it reuses the unit for the next one
    /// made, and records it dying if it `died` rather than being used up some other way.
    pub fn record_death(
        &mut self,
        key: usize,
        slot: usize,
        id: UnitId,
        position: &bw::Point,
        frame: u32,
        died: bool,
    ) {
        if let Some(followed) = self.followed.remove(&key) {
            self.stop_following(followed, frame);
        }
        if !died || slot >= PLAYER_COUNT || self.kind(id).is_none() {
            return;
        }
        self.deaths.push(Death {
            frame,
            slot: slot as u8,
            id,
            position: quantize(position),
        });
    }

    /// Records a mineral field or geyser as the game starts. Anything else is left out.
    pub fn record_resource(&mut self, id: UnitId, position: &bw::Point) {
        let geyser = match id {
            unit::MINERAL_FIELD_1 | unit::MINERAL_FIELD_2 | unit::MINERAL_FIELD_3 => false,
            unit::VESPENE_GEYSER => true,
            _ => return,
        };
        self.resources.push(Resource {
            geyser,
            id,
            position: quantize(position),
        });
    }

    /// How many units of each type each slot was seen losing, to check against the game's own
    /// counts.
    pub fn deaths_by_type(&self) -> Box<[[u32; PLAYER_COUNT]; UNIT_TYPE_COUNT]> {
        let mut counts = Box::new([[0; PLAYER_COUNT]; UNIT_TYPE_COUNT]);
        for death in &self.deaths {
            counts[death.id.0 as usize][usize::from(death.slot)] += 1;
        }
        counts
    }

    pub fn is_on_map(&self, id: UnitId) -> bool {
        self.kind(id).is_some()
    }

    /// Packs everything recorded, all numbers as LEB128 varints unless said otherwise:
    ///
    /// - version (byte), position shift (byte): positions are in pixels shifted right by it
    /// - the map's width and height in tiles
    /// - scan count, then each scan's frame as the difference from the one before
    /// - track count, then for each: slot (byte), unit type, kind (byte), supply in halves (byte),
    ///   first scan, and its runs of scans it was seen in, as a count of runs and for each the
    ///   scans skipped since the last run, the run's length, and its positions as zigzag
    ///   differences from the position before (starting from 0, 0)
    /// - building count, then for each: slot (byte), unit type, x, y, width and height in tiles
    ///   (bytes), the frame it was started on, and the frame it was destroyed on plus 1, or 0 if it
    ///   never was
    /// - death count, then for each: the frame as the difference from the death before, slot
    ///   (byte), unit type, kind (byte), x, y
    /// - mineral field and geyser count, then for each: 1 for a geyser or 0 (byte), x, y, width and
    ///   height in tiles (bytes)
    pub fn encode(&self, map_width: u16, map_height: u16) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.tracks.len() * 64);
        out.push(ENCODING_VERSION);
        out.push(POSITION_SHIFT);
        write_varint(&mut out, u32::from(map_width));
        write_varint(&mut out, u32::from(map_height));

        write_varint(&mut out, self.sample_frames.len() as u32);
        let mut last = 0;
        for &frame in &self.sample_frames {
            write_varint(&mut out, frame - last);
            last = frame;
        }

        write_varint(&mut out, self.tracks.len() as u32);
        for track in &self.tracks {
            out.push(track.slot);
            write_varint(&mut out, u32::from(track.id.0));
            out.push(self.kind(track.id).map_or(0, |kind| kind as u8));
            out.push(self.units.supply[track.id.0 as usize]);
            write_varint(&mut out, track.first_sample);
            let runs = runs(&track.positions);
            write_varint(&mut out, runs.len() as u32);
            let mut end = 0;
            let mut previous = (0, 0);
            for (start, len) in runs {
                write_varint(&mut out, (start - end) as u32);
                write_varint(&mut out, len as u32);
                for &(x, y) in track.positions[start..start + len].iter().flatten() {
                    write_varint(&mut out, zigzag(i32::from(x) - i32::from(previous.0)));
                    write_varint(&mut out, zigzag(i32::from(y) - i32::from(previous.1)));
                    previous = (x, y);
                }
                end = start + len;
            }
        }

        write_varint(&mut out, self.buildings.len() as u32);
        for building in &self.buildings {
            let (width, height) = self.units.footprint[building.id.0 as usize];
            out.push(building.slot);
            write_varint(&mut out, u32::from(building.id.0));
            write_varint(&mut out, u32::from(building.position.0));
            write_varint(&mut out, u32::from(building.position.1));
            out.extend([width, height]);
            write_varint(&mut out, building.start_frame);
            write_varint(&mut out, building.end_frame.map_or(0, |frame| frame + 1));
        }

        write_varint(&mut out, self.deaths.len() as u32);
        let mut last = 0;
        for death in &self.deaths {
            write_varint(&mut out, death.frame.saturating_sub(last));
            last = death.frame.max(last);
            out.push(death.slot);
            write_varint(&mut out, u32::from(death.id.0));
            out.push(self.kind(death.id).map_or(0, |kind| kind as u8));
            write_varint(&mut out, u32::from(death.position.0));
            write_varint(&mut out, u32::from(death.position.1));
        }

        write_varint(&mut out, self.resources.len() as u32);
        for resource in &self.resources {
            let (width, height) = self.units.footprint[resource.id.0 as usize];
            out.push(u8::from(resource.geyser));
            write_varint(&mut out, u32::from(resource.position.0));
            write_varint(&mut out, u32::from(resource.position.1));
            out.extend([width, height]);
        }
        out
    }
}

/// The runs of scans a track was seen in, as their start and length.
fn runs(positions: &[Option<(u16, u16)>]) -> Vec<(usize, usize)> {
    let mut runs = Vec::new();
    let mut start = None;
    for (i, position) in positions.iter().enumerate() {
        match (position, start) {
            (Some(_), None) => start = Some(i),
            (None, Some(s)) => {
                runs.push((s, i - s));
                start = None;
            }
            _ => (),
        }
    }
    if let Some(s) = start {
        runs.push((s, positions.len() - s));
    }
    runs
}

fn zigzag(value: i32) -> u32 {
    ((value << 1) ^ (value >> 31)) as u32
}

fn write_varint(out: &mut Vec<u8>, mut value: u32) {
    while value >= 0x80 {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

#[cfg(test)]
mod test {
    use super::*;

    fn seen(key: usize, id: UnitId, x: i16, y: i16) -> SeenUnit {
        let landed = id == unit::COMMAND_CENTER;
        SeenUnit {
            key,
            slot: 0,
            id,
            position: bw::Point { x, y },
            building: landed,
            landed,
            working: true,
        }
    }

    struct Reader<'a>(&'a [u8]);

    impl Reader<'_> {
        fn byte(&mut self) -> u8 {
            let b = self.0[0];
            self.0 = &self.0[1..];
            b
        }

        fn varint(&mut self) -> u32 {
            let mut value = 0;
            let mut shift = 0;
            loop {
                let b = self.byte();
                value |= u32::from(b & 0x7f) << shift;
                if b < 0x80 {
                    return value;
                }
                shift += 7;
            }
        }

        fn signed(&mut self) -> i32 {
            let v = self.varint();
            (v >> 1) as i32 ^ -((v & 1) as i32)
        }
    }

    #[test]
    fn varints_and_zigzag_round_trip() {
        for value in [0, 1, 127, 128, 300, 1 << 20, u32::MAX] {
            let mut out = Vec::new();
            write_varint(&mut out, value);
            assert_eq!(Reader(&out).varint(), value);
        }
        for value in [0, -1, 1, -64, 64, -1000, 1000] {
            let mut out = Vec::new();
            write_varint(&mut out, zigzag(value));
            assert_eq!(Reader(&out).signed(), value);
        }
    }

    #[test]
    fn a_unit_hidden_for_a_while_keeps_its_track_with_a_gap() {
        let mut positions = UnitPositions::new(test_units());
        positions.record_sample(&[seen(1, unit::MARINE, 80, 80)], 24);
        positions.record_sample(&[], 48);
        positions.record_sample(&[], 72);
        positions.record_sample(&[seen(1, unit::MARINE, 160, 80)], 96);

        let encoded = positions.encode(128, 96);
        let mut r = Reader(&encoded);
        assert_eq!((r.byte(), r.byte()), (ENCODING_VERSION, POSITION_SHIFT));
        assert_eq!((r.varint(), r.varint()), (128, 96));
        assert_eq!(r.varint(), 4);
        let frames: Vec<u32> = (0..4).map(|_| r.varint()).collect();
        assert_eq!(frames, [24, 24, 24, 24]);
        assert_eq!(r.varint(), 1, "one track");
        assert_eq!(r.byte(), 0);
        assert_eq!(r.varint(), u32::from(unit::MARINE.0));
        assert_eq!(r.byte(), MapKind::Army as u8);
        assert_eq!(r.byte(), 2);
        assert_eq!(r.varint(), 0, "first scan");
        assert_eq!(r.varint(), 2, "two runs");
        assert_eq!((r.varint(), r.varint()), (0, 1));
        assert_eq!((r.signed(), r.signed()), (10, 10));
        assert_eq!(
            (r.varint(), r.varint()),
            (2, 1),
            "skips the two scans it was hidden in"
        );
        assert_eq!((r.signed(), r.signed()), (10, 0));
        assert_eq!(r.varint(), 0, "no buildings");
        assert_eq!(r.varint(), 0, "no deaths");
        assert_eq!(r.varint(), 0, "no resources");
        assert!(r.0.is_empty());
    }

    #[test]
    fn a_dead_units_reused_slot_starts_a_new_track() {
        let mut positions = UnitPositions::new(test_units());
        positions.record_sample(&[seen(1, unit::MARINE, 80, 80)], 24);
        positions.record_death(1, 0, unit::MARINE, &bw::Point { x: 88, y: 80 }, 30, true);
        positions.record_sample(&[seen(1, unit::MARINE, 800, 800)], 48);
        assert_eq!(positions.tracks.len(), 2);
        assert_eq!(positions.deaths.len(), 1);
        assert_eq!(positions.deaths[0].position, (11, 10));
    }

    #[test]
    fn a_worker_becoming_a_building_ends_its_track_and_starts_a_building() {
        let mut positions = UnitPositions::new(test_units());
        positions.record_sample(&[seen(1, unit::SCV, 80, 80)], 24);
        positions.record_sample(&[seen(1, unit::COMMAND_CENTER, 96, 96)], 48);
        positions.record_sample(&[], 72);
        assert_eq!(positions.tracks.len(), 1);
        assert_eq!(positions.tracks[0].positions.len(), 1);
        assert_eq!(positions.buildings.len(), 1);
        assert_eq!(positions.buildings[0].start_frame, 48);
        assert_eq!(positions.buildings[0].end_frame, Some(72));
    }

    #[test]
    fn a_unit_used_up_without_dying_is_no_death() {
        let mut positions = UnitPositions::new(test_units());
        positions.record_sample(&[seen(1, unit::SCV, 80, 80)], 24);
        positions.record_death(1, 0, unit::SCV, &bw::Point { x: 80, y: 80 }, 30, false);
        positions.record_sample(&[seen(1, unit::SCV, 800, 800)], 48);
        assert_eq!(
            positions.tracks.len(),
            2,
            "stopped following it all the same"
        );
        assert!(positions.deaths.is_empty());
    }

    #[test]
    fn mineral_fields_and_geysers_are_kept_and_nothing_else() {
        let mut units = test_units();
        units.footprint[unit::MINERAL_FIELD_1.0 as usize] = (2, 1);
        units.footprint[unit::VESPENE_GEYSER.0 as usize] = (4, 2);
        let mut positions = UnitPositions::new(units);
        positions.record_resource(unit::MINERAL_FIELD_1, &bw::Point { x: 80, y: 40 });
        positions.record_resource(unit::VESPENE_GEYSER, &bw::Point { x: 160, y: 80 });
        positions.record_resource(unit::MARINE, &bw::Point { x: 0, y: 0 });

        let encoded = positions.encode(64, 64);
        // Version and shift, map size, then no scans, tracks, buildings or deaths.
        let mut r = Reader(&encoded[2..]);
        assert_eq!((r.varint(), r.varint()), (64, 64));
        assert_eq!([r.varint(), r.varint(), r.varint(), r.varint()], [0; 4]);
        assert_eq!(r.varint(), 2);
        assert_eq!((r.byte(), r.varint(), r.varint()), (0, 10, 5));
        assert_eq!((r.byte(), r.byte()), (2, 1));
        assert_eq!((r.byte(), r.varint(), r.varint()), (1, 20, 10));
        assert_eq!((r.byte(), r.byte()), (4, 2));
        assert!(r.0.is_empty());
    }

    #[test]
    fn units_off_the_minimap_are_left_out() {
        let mut positions = UnitPositions::new(test_units());
        positions.record_sample(&[seen(1, unit::LARVA, 80, 80)], 24);
        positions.record_death(1, 0, unit::LARVA, &bw::Point { x: 80, y: 80 }, 30, true);
        assert!(positions.tracks.is_empty());
        assert!(positions.deaths.is_empty());
    }
}
