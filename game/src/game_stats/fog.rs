//! Commands naming enemy units the player had no way to see: selecting one in the fog of war, or
//! ordering units at one in the fog or cloaked without detection. StarCraft only lets a player click
//! on units they can see, so a command naming a hidden unit came from something that showed it to
//! them, like a map hack.
//!
//! Commands name units by their slot in the game's unit array. Each slot remembers the last frame
//! each player could click on the unit in it, which is kept up to date every frame while a replay is
//! analyzed.
//!
//! Some replays play back differently from the game they recorded, from some point on: units end
//! up in other slots than they were in, so commands name other units than the player meant. That
//! shows as selections no player could make, like a group of the player's own units with an enemy
//! unit among them, and nothing is reported for those replays.

use byteorder::{ByteOrder, LittleEndian};
use serde::Serialize;

use super::PLAYER_COUNT;
use crate::bw::commands::id;

/// How long after a player could last click on a unit a command naming it still counts as a click
/// from then. A command runs a few frames after it's sent, more with high latency, and the unit can
/// step out of sight in between.
pub const GRACE_FRAMES: u32 = 48;

/// The most commands kept for each player. Every one is still counted.
const MAX_KEPT: usize = 100;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetKind {
    /// Selecting the unit, which shows its health and what it's doing.
    Select,
    /// Ordering units at it, like attacking it, casting a spell on it or right clicking it.
    Order,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HiddenBy {
    Fog,
    /// Cloaked or burrowed, with nothing detecting it. The player sees a shimmer at most, which
    /// can't be clicked on.
    Cloak,
}

/// A command naming an enemy unit the player couldn't see.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenTarget {
    pub frame: u32,
    pub kind: TargetKind,
    pub hidden_by: HiddenBy,
    /// The type of the unit named.
    pub unit_id: u16,
    /// The order given, for [`TargetKind::Order`] other than a right click, which lets the units
    /// pick what to do.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u8>,
    /// Where the unit was, in pixels.
    pub x: i16,
    pub y: i16,
    /// The last frame the player could click on the unit, if they ever could.
    pub last_seen_frame: Option<u32>,
}

/// Every command a player gave naming a hidden enemy unit.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenTargets {
    pub count: u32,
    /// The first [`MAX_KEPT`] of them, in the order they were given.
    pub targets: Vec<HiddenTarget>,
}

impl HiddenTargets {
    fn add(&mut self, target: HiddenTarget) {
        self.count = self.count.saturating_add(1);
        if self.targets.len() < MAX_KEPT {
            self.targets.push(target);
        }
    }

    /// Adds in the commands of someone else playing the same slot.
    pub fn merge(&mut self, other: HiddenTargets) {
        self.count = self.count.saturating_add(other.count);
        self.targets.extend(other.targets);
        self.targets.sort_by_key(|target| target.frame);
        self.targets.truncate(MAX_KEPT);
    }
}

/// The units a command names, and what it does with them.
#[derive(Debug, PartialEq, Eq)]
pub struct NamedUnits {
    pub kind: TargetKind,
    /// A selection adding to what was selected, rather than replacing it.
    pub adding: bool,
    pub order: Option<u8>,
    /// The game's ids for the units, see `bw_dat::UnitArray::get_by_unique_id`.
    pub ids: Vec<u32>,
}

/// The units a command names by id: everything a selection picks, or the target of an order. Other
/// commands, and orders at a spot on the ground, name none.
pub fn named_units(command: &[u8]) -> Option<NamedUnits> {
    let (&command_id, rest) = command.split_first()?;
    let selection = |width: usize| {
        let (&count, ids) = rest.split_first()?;
        let ids = ids.get(..usize::from(count) * width)?;
        Some(NamedUnits {
            kind: TargetKind::Select,
            adding: matches!(command_id, id::SELECT_ADD | id::SELECT_ADD_121),
            order: None,
            ids: ids
                .chunks_exact(width)
                .map(|id| match width {
                    2 => u32::from(LittleEndian::read_u16(id)),
                    _ => LittleEndian::read_u32(id),
                })
                .collect(),
        })
    };
    // Orders are { i16 x, i16 y, target, u16 unit_type, u8 order, u8 queued }, and right clicks
    // the same without the order, with the target's id a u16 in the old commands and a u32 in the
    // new ones.
    let order = |target: u32, order: Option<u8>| {
        Some(NamedUnits {
            kind: TargetKind::Order,
            adding: false,
            order,
            ids: if target == 0 { vec![] } else { vec![target] },
        })
    };
    match command_id {
        id::SELECT | id::SELECT_ADD => selection(2),
        id::SELECT_121 | id::SELECT_ADD_121 => selection(4),
        id::TARGETED_ORDER => order(
            u32::from(LittleEndian::read_u16(rest.get(4..6)?)),
            Some(*rest.get(8)?),
        ),
        id::TARGETED_ORDER_121 => order(
            LittleEndian::read_u32(rest.get(4..8)?),
            Some(*rest.get(10)?),
        ),
        id::RIGHT_CLICK => order(u32::from(LittleEndian::read_u16(rest.get(4..6)?)), None),
        id::RIGHT_CLICK_121 => order(LittleEndian::read_u32(rest.get(4..8)?), None),
        _ => None,
    }
}

/// An enemy unit a command named, as it was when the command ran.
pub struct NamedUnit {
    /// Its slot in the game's unit array.
    pub index: usize,
    /// What the game counts up each time the slot is reused, so a new unit in it is told apart
    /// from the one before.
    pub generation: u8,
    pub unit_id: u16,
    pub x: i16,
    pub y: i16,
    /// Whether the player could see the unit, even if only as a cloaked shimmer.
    pub visible: bool,
}

#[derive(Copy, Clone, Default)]
struct SlotSeen {
    generation: u8,
    /// The last frame each player could click on the unit in the slot.
    by: [Option<u32>; PLAYER_COUNT],
}

#[derive(Default)]
pub struct FogWatch {
    /// Whether the units were watched, without which nothing was checked.
    pub watched: bool,
    seen: Vec<SlotSeen>,
    pub hidden: [HiddenTargets; PLAYER_COUNT],
    /// The first frame a command showed the replay playing back out of sync.
    pub out_of_sync_frame: Option<u32>,
}

impl FogWatch {
    /// Records which players could click on the unit in a slot on a frame: one bit for each player
    /// it was visible and detected for.
    pub fn record_seen(&mut self, index: usize, generation: u8, clickable_for: u8, frame: u32) {
        if self.seen.len() <= index {
            self.seen.resize(index + 1, SlotSeen::default());
        }
        let slot = &mut self.seen[index];
        if slot.generation != generation {
            *slot = SlotSeen {
                generation,
                by: [None; PLAYER_COUNT],
            };
        }
        for (player, seen) in slot.by.iter_mut().enumerate() {
            if clickable_for & (1 << player) != 0 {
                *seen = Some(frame);
            }
        }
    }

    /// Checks a command `player` gave naming an enemy unit, where `sight` has a bit for each
    /// player whose vision they have, their own included.
    pub fn check(
        &mut self,
        player: usize,
        sight: u8,
        frame: u32,
        named: &NamedUnits,
        unit: &NamedUnit,
    ) {
        // A player can click on one enemy unit to select it, but never pick one along with others
        // or add one to what they had.
        if named.kind == TargetKind::Select && (named.ids.len() != 1 || named.adding) {
            self.out_of_sync_frame.get_or_insert(frame);
            return;
        }
        let Some(hidden) = self.hidden.get_mut(player) else {
            return;
        };
        let last_seen = self
            .seen
            .get(unit.index)
            .filter(|slot| slot.generation == unit.generation)
            .and_then(|slot| {
                (0..PLAYER_COUNT)
                    .filter(|&p| sight & (1 << p) != 0)
                    .filter_map(|p| slot.by[p])
                    .max()
            });
        if last_seen.is_some_and(|seen| frame <= seen.saturating_add(GRACE_FRAMES)) {
            return;
        }
        hidden.add(HiddenTarget {
            frame,
            kind: named.kind,
            hidden_by: if unit.visible {
                HiddenBy::Cloak
            } else {
                HiddenBy::Fog
            },
            unit_id: unit.unit_id,
            order: named.order,
            x: unit.x,
            y: unit.y,
            last_seen_frame: last_seen,
        });
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn select(frame: u32) -> (NamedUnits, NamedUnit, u32) {
        let named = NamedUnits {
            kind: TargetKind::Select,
            adding: false,
            order: None,
            ids: vec![5],
        };
        let unit = NamedUnit {
            index: 4,
            generation: 1,
            unit_id: 0,
            x: 100,
            y: 200,
            visible: false,
        };
        (named, unit, frame)
    }

    #[test]
    fn reads_named_units() {
        assert_eq!(
            named_units(&[id::SELECT, 2, 5, 0, 0x01, 0x08]),
            Some(NamedUnits {
                kind: TargetKind::Select,
                adding: false,
                order: None,
                ids: vec![5, 0x801],
            })
        );
        assert_eq!(
            named_units(&[id::SELECT_121, 1, 7, 0, 1, 0]),
            Some(NamedUnits {
                kind: TargetKind::Select,
                adding: false,
                order: None,
                ids: vec![0x10007],
            })
        );
        // A selection cut short names nothing rather than part of it.
        assert_eq!(named_units(&[id::SELECT, 2, 5, 0]), None);
        assert_eq!(
            named_units(&[id::TARGETED_ORDER, 1, 0, 2, 0, 9, 0, 0xe4, 0, 0x0a, 0]),
            Some(NamedUnits {
                kind: TargetKind::Order,
                adding: false,
                order: Some(0x0a),
                ids: vec![9],
            })
        );
        assert_eq!(
            named_units(&[
                id::TARGETED_ORDER_121,
                1,
                0,
                2,
                0,
                9,
                0,
                1,
                0,
                0xe4,
                0,
                0x0a,
                0
            ]),
            Some(NamedUnits {
                kind: TargetKind::Order,
                adding: false,
                order: Some(0x0a),
                ids: vec![0x10009],
            })
        );
        // An order at the ground names no unit.
        assert_eq!(
            named_units(&[id::TARGETED_ORDER, 1, 0, 2, 0, 0, 0, 0xe4, 0, 0x0a, 0])
                .map(|named| named.ids),
            Some(vec![])
        );
        assert_eq!(
            named_units(&[id::RIGHT_CLICK, 1, 0, 2, 0, 9, 0, 0xe4, 0, 0]),
            Some(NamedUnits {
                kind: TargetKind::Order,
                adding: false,
                order: None,
                ids: vec![9],
            })
        );
        assert_eq!(
            named_units(&[id::RIGHT_CLICK_121, 1, 0, 2, 0, 9, 0, 1, 0, 0xe4, 0, 0]),
            Some(NamedUnits {
                kind: TargetKind::Order,
                adding: false,
                order: None,
                ids: vec![0x10009],
            })
        );
        assert_eq!(named_units(&[id::STOP, 0]), None);
    }

    #[test]
    fn counts_units_never_seen() {
        let mut fog = FogWatch::default();
        let (named, unit, frame) = select(500);
        fog.check(0, 0b1, frame, &named, &unit);
        assert_eq!(fog.hidden[0].count, 1);
        assert_eq!(fog.hidden[0].targets[0].hidden_by, HiddenBy::Fog);
        assert_eq!(fog.hidden[0].targets[0].last_seen_frame, None);
    }

    #[test]
    fn allows_units_seen_just_before() {
        let mut fog = FogWatch::default();
        fog.record_seen(4, 1, 0b1, 400);
        let (named, unit, _) = select(0);
        fog.check(0, 0b1, 400 + GRACE_FRAMES, &named, &unit);
        assert_eq!(fog.hidden[0].count, 0);
        fog.check(0, 0b1, 401 + GRACE_FRAMES, &named, &unit);
        assert_eq!(fog.hidden[0].count, 1);
        assert_eq!(fog.hidden[0].targets[0].last_seen_frame, Some(400));
    }

    #[test]
    fn counts_what_allies_show() {
        let mut fog = FogWatch::default();
        fog.record_seen(4, 1, 0b100, 400);
        let (named, unit, frame) = select(410);
        fog.check(0, 0b101, frame, &named, &unit);
        assert_eq!(fog.hidden[0].count, 0);
        fog.check(1, 0b010, frame, &named, &unit);
        assert_eq!(fog.hidden[1].count, 1);
    }

    #[test]
    fn forgets_the_unit_a_slot_held_before() {
        let mut fog = FogWatch::default();
        fog.record_seen(4, 0, 0b1, 400);
        let (named, unit, frame) = select(410);
        fog.check(0, 0b1, frame, &named, &unit);
        assert_eq!(fog.hidden[0].count, 1);
    }

    #[test]
    fn tells_cloaked_units_apart() {
        let mut fog = FogWatch::default();
        let (named, mut unit, frame) = select(410);
        unit.visible = true;
        fog.check(0, 0b1, frame, &named, &unit);
        assert_eq!(fog.hidden[0].targets[0].hidden_by, HiddenBy::Cloak);
    }

    #[test]
    fn notices_selections_no_player_could_make() {
        let mut fog = FogWatch::default();
        let (mut named, unit, frame) = select(410);
        named.ids.push(6);
        fog.check(0, 0b1, frame, &named, &unit);
        named.ids.pop();
        named.adding = true;
        fog.check(0, 0b1, frame + 1, &named, &unit);
        assert_eq!(fog.hidden[0].count, 0);
        assert_eq!(fog.out_of_sync_frame, Some(410));
    }

    #[test]
    fn keeps_counting_past_the_ones_kept() {
        let mut fog = FogWatch::default();
        for frame in 0..MAX_KEPT as u32 + 5 {
            let (named, unit, _) = select(0);
            fog.check(0, 0b1, frame, &named, &unit);
        }
        assert_eq!(fog.hidden[0].count, MAX_KEPT as u32 + 5);
        assert_eq!(fog.hidden[0].targets.len(), MAX_KEPT);

        let mut merged = HiddenTargets::default();
        merged.merge(fog.hidden[0].clone());
        assert_eq!(merged.count, MAX_KEPT as u32 + 5);
        assert_eq!(merged.targets.len(), MAX_KEPT);
    }
}
