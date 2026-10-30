//! Follows each player's selection and hotkey groups from their commands, so every hotkey they
//! press can be reported with the units its group held.

use std::collections::HashMap;

use serde::Serialize;

use crate::bw::commands::id;

/// BW's hotkey commands: assigning a group, selecting it, and adding to it.
const HOTKEY_ASSIGN: u8 = 0;
const HOTKEY_SELECT: u8 = 1;
const HOTKEY_ADD: u8 = 2;

/// The most units a selection or a group can hold.
const MAX_SELECTED: usize = 12;

/// The ten groups, one for each number key.
const GROUP_COUNT: usize = 10;

/// Finds the unit a command names: the id that names it whichever way a command spells it, and its
/// unit type now. `None` once the unit is gone.
pub trait UnitLookup {
    fn lookup(&self, tag: u32) -> Option<(u32, u16)>;
}

impl UnitLookup for bw_dat::UnitArray {
    fn lookup(&self, tag: u32) -> Option<(u32, u16)> {
        let unit = self.get_by_unique_id(tag)?;
        Some((self.to_unique_id(unit), unit.id().0))
    }
}

/// One player's selection and groups, and the hotkeys they pressed.
#[derive(Default)]
pub struct HotkeyTracker {
    selection: Vec<u32>,
    groups: [Vec<u32>; GROUP_COUNT],
    presses: Vec<(u32, u8, u8, u32)>,
    contents: Vec<Vec<(u16, u32)>>,
    content_index: HashMap<Vec<(u16, u32)>, u32>,
}

/// Every hotkey a player pressed, with what the group held at the time.
#[derive(Serialize, Debug, PartialEq)]
pub struct Hotkeys {
    /// Each press as frame, kind (0 assigns the group, 1 selects it, 2 adds to it), group, and an
    /// index into `contents`, oldest first.
    presses: Vec<(u32, u8, u8, u32)>,
    /// Unit id and count for each type of unit in a group, each different one listed once.
    contents: Vec<Vec<(u16, u32)>>,
}

impl HotkeyTracker {
    pub fn record_command(&mut self, command: &[u8], frame: u32, units: &impl UnitLookup) {
        match *command {
            [
                id::SELECT | id::SELECT_ADD | id::SELECT_REMOVE,
                _,
                ref rest @ ..,
            ] => {
                let tags = rest
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|&t| u16::from_le_bytes(t) as u32);
                self.select(command[0], tags, units);
            }
            [
                id::SELECT_121 | id::SELECT_ADD_121 | id::SELECT_REMOVE_121,
                _,
                ref rest @ ..,
            ] => {
                let tags = rest
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|&t| u32::from_le_bytes(t));
                let kind = match command[0] {
                    id::SELECT_121 => id::SELECT,
                    id::SELECT_ADD_121 => id::SELECT_ADD,
                    _ => id::SELECT_REMOVE,
                };
                self.select(kind, tags, units);
            }
            [id::HOTKEY, kind, group, ..] if (group as usize) < GROUP_COUNT => {
                self.press(kind, group, frame, units);
            }
            _ => (),
        }
    }

    fn select(&mut self, kind: u8, tags: impl Iterator<Item = u32>, units: &impl UnitLookup) {
        let named = tags.filter_map(|tag| units.lookup(tag).map(|(id, _)| id));
        match kind {
            id::SELECT => {
                self.selection.clear();
                add_units(&mut self.selection, named);
            }
            id::SELECT_ADD => add_units(&mut self.selection, named),
            _ => {
                let removed: Vec<u32> = named.collect();
                self.selection.retain(|id| !removed.contains(id));
            }
        }
    }

    fn press(&mut self, kind: u8, group: u8, frame: u32, units: &impl UnitLookup) {
        let alive = |ids: &[u32]| -> Vec<u32> {
            ids.iter()
                .filter_map(|&id| units.lookup(id).map(|(id, _)| id))
                .collect()
        };
        let index = group as usize;
        match kind {
            HOTKEY_ASSIGN => self.groups[index] = alive(&self.selection),
            HOTKEY_ADD => {
                let selected = alive(&self.selection);
                self.groups[index].retain(|&id| units.lookup(id).is_some());
                add_units(&mut self.groups[index], selected);
            }
            HOTKEY_SELECT => {
                self.groups[index] = alive(&self.groups[index]);
                // Selecting an empty group leaves the selection as it was.
                if !self.groups[index].is_empty() {
                    self.selection = self.groups[index].clone();
                }
            }
            _ => return,
        }
        let contents = self.contents_of(index, units);
        self.presses.push((frame, kind, group, contents));
    }

    /// The index in `contents` of what a group holds now.
    fn contents_of(&mut self, group: usize, units: &impl UnitLookup) -> u32 {
        let mut counts: Vec<(u16, u32)> = Vec::new();
        for (_, unit_id) in self.groups[group].iter().filter_map(|&id| units.lookup(id)) {
            match counts.iter_mut().find(|(id, _)| *id == unit_id) {
                Some((_, count)) => *count += 1,
                None => counts.push((unit_id, 1)),
            }
        }
        counts.sort_unstable();
        let next = self.contents.len() as u32;
        *self
            .content_index
            .entry(counts)
            .or_insert_with_key(|counts| {
                self.contents.push(counts.clone());
                next
            })
    }

    /// What was pressed, or `None` for a player who never pressed a hotkey.
    pub fn hotkeys(&self) -> Option<Hotkeys> {
        (!self.presses.is_empty()).then(|| Hotkeys {
            presses: self.presses.clone(),
            contents: self.contents.clone(),
        })
    }
}

/// Adds units to a selection or group that doesn't hold them yet, up to the most it can hold.
fn add_units(to: &mut Vec<u32>, units: impl IntoIterator<Item = u32>) {
    for unit in units {
        if to.len() >= MAX_SELECTED {
            break;
        }
        if !to.contains(&unit) {
            to.push(unit);
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    /// Units by tag, with their types. Tags above 0x800 name the same unit as the tag 0x800 less.
    struct FakeUnits(HashMap<u32, u16>);

    impl UnitLookup for FakeUnits {
        fn lookup(&self, tag: u32) -> Option<(u32, u16)> {
            let id = tag & 0x7ff;
            self.0.get(&id).map(|&unit_id| (id, unit_id))
        }
    }

    const ZERGLING: u16 = 37;
    const MUTALISK: u16 = 43;

    fn select(tags: &[u16]) -> Vec<u8> {
        let mut command = vec![id::SELECT, tags.len() as u8];
        for tag in tags {
            command.extend(tag.to_le_bytes());
        }
        command
    }

    fn select_121(kind: u8, tags: &[u32]) -> Vec<u8> {
        let mut command = vec![kind, tags.len() as u8];
        for tag in tags {
            command.extend(tag.to_le_bytes());
        }
        command
    }

    fn contents(tracker: &HotkeyTracker, press: usize) -> &[(u16, u32)] {
        &tracker.contents[tracker.presses[press].3 as usize]
    }

    #[test]
    fn assigned_group_holds_the_selection() {
        let units = FakeUnits(HashMap::from([(1, MUTALISK), (2, MUTALISK), (3, ZERGLING)]));
        let mut tracker = HotkeyTracker::default();
        tracker.record_command(&select(&[1, 2, 3]), 10, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ASSIGN, 1], 11, &units);
        assert_eq!(tracker.presses, vec![(11, HOTKEY_ASSIGN, 1, 0)]);
        assert_eq!(contents(&tracker, 0), &[(ZERGLING, 1), (MUTALISK, 2)]);
    }

    #[test]
    fn selecting_a_group_shows_what_is_left_of_it() {
        let mut units = FakeUnits(HashMap::from([(1, MUTALISK), (2, MUTALISK)]));
        let mut tracker = HotkeyTracker::default();
        tracker.record_command(&select(&[1, 2]), 10, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ASSIGN, 4], 11, &units);
        units.0.remove(&2);
        tracker.record_command(&[id::HOTKEY, HOTKEY_SELECT, 4], 20, &units);
        assert_eq!(contents(&tracker, 1), &[(MUTALISK, 1)]);
    }

    #[test]
    fn group_follows_units_that_morph() {
        const LARVA: u16 = 35;
        let mut units = FakeUnits(HashMap::from([(1, LARVA)]));
        let mut tracker = HotkeyTracker::default();
        tracker.record_command(&select(&[1]), 10, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ASSIGN, 2], 11, &units);
        units.0.insert(1, MUTALISK);
        tracker.record_command(&[id::HOTKEY, HOTKEY_SELECT, 2], 500, &units);
        assert_eq!(contents(&tracker, 1), &[(MUTALISK, 1)]);
    }

    #[test]
    fn adding_to_a_group_keeps_what_it_held() {
        let units = FakeUnits(HashMap::from([(1, MUTALISK), (2, ZERGLING), (3, ZERGLING)]));
        let mut tracker = HotkeyTracker::default();
        tracker.record_command(&select(&[1]), 10, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ASSIGN, 1], 11, &units);
        tracker.record_command(&select_121(id::SELECT_121, &[2, 3 | 0x800]), 12, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ADD, 1], 13, &units);
        assert_eq!(contents(&tracker, 1), &[(ZERGLING, 2), (MUTALISK, 1)]);
    }

    #[test]
    fn selecting_a_group_replaces_the_selection() {
        let units = FakeUnits(HashMap::from([(1, MUTALISK), (2, ZERGLING)]));
        let mut tracker = HotkeyTracker::default();
        tracker.record_command(&select(&[1]), 10, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ASSIGN, 1], 11, &units);
        tracker.record_command(&select(&[2]), 12, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_SELECT, 1], 13, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ASSIGN, 2], 14, &units);
        assert_eq!(contents(&tracker, 2), &[(MUTALISK, 1)]);
    }

    #[test]
    fn removed_units_leave_the_selection() {
        let units = FakeUnits(HashMap::from([(1, MUTALISK), (2, ZERGLING)]));
        let mut tracker = HotkeyTracker::default();
        tracker.record_command(&select(&[1, 2]), 10, &units);
        tracker.record_command(&select_121(id::SELECT_REMOVE_121, &[2]), 11, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ASSIGN, 3], 12, &units);
        assert_eq!(contents(&tracker, 0), &[(MUTALISK, 1)]);
    }

    #[test]
    fn same_contents_are_listed_once() {
        let units = FakeUnits(HashMap::from([(1, MUTALISK)]));
        let mut tracker = HotkeyTracker::default();
        tracker.record_command(&select(&[1]), 10, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_ASSIGN, 1], 11, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_SELECT, 1], 12, &units);
        tracker.record_command(&[id::HOTKEY, HOTKEY_SELECT, 1], 13, &units);
        let hotkeys = tracker.hotkeys().unwrap();
        assert_eq!(hotkeys.contents.len(), 1);
        assert_eq!(hotkeys.presses.len(), 3);
    }

    #[test]
    fn no_presses_reports_nothing() {
        let units = FakeUnits(HashMap::new());
        let mut tracker = HotkeyTracker::default();
        tracker.record_command(&select(&[1]), 10, &units);
        assert_eq!(tracker.hotkeys(), None);
    }
}
