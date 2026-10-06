//! Collects each player's stats over a game and reports them once it ends. A replay launched to be
//! analyzed rather than watched is seeked straight to its end and reported there.
//!
//! None of this may disturb the game itself: everything here avoids panicking (which aborts the
//! game), checks the game globals before reading them, and reports what it can't know as missing
//! rather than guessing.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};

use bw_dat::{TechId, UnitId, UpgradeId, order, tech, unit, upgrade};
use serde::Serialize;

use crate::bw::commands::{self, id};
use crate::bw::{self, Bw, get_bw, player_name};
use crate::game_thread::{self, GameThreadMessage, send_game_msg_to_async};

/// Indexes into `Game::scores`.
mod score {
    pub const UNIT_SCORE: usize = 5;
    pub const KILL_SCORE: usize = 6;
    pub const BUILDING_SCORE: usize = 12;
    pub const RAZING_SCORE: usize = 13;
}

/// `Game::victory_state` values.
mod victory_state {
    pub const PLAYING: u8 = 0;
    pub const DEFEAT: u8 = 2;
    pub const VICTORY: u8 = 3;
}

const PLAYER_COUNT: usize = 8;
const UNIT_TYPE_COUNT: usize = unit::NONE.0 as usize;
const UPGRADE_COUNT: usize = upgrade::NONE.0 as usize;
const TECH_COUNT: usize = tech::NONE.0 as usize;
const SCORE_COUNT: usize = 0x12;
/// The game keeps its per player tables with room for 12 players, observers included.
type PerPlayer = [u32; 0xc];

const fn unit_type_set<const N: usize>(ids: [UnitId; N]) -> [bool; UNIT_TYPE_COUNT] {
    let mut set = [false; UNIT_TYPE_COUNT];
    let mut i = 0;
    while i < N {
        set[ids[i].0 as usize] = true;
        i += 1;
    }
    set
}

/// Unit types that exist without anyone producing them on purpose: parts of other units, larvae
/// and the eggs and cocoons units morph inside, ammunition and spawns, and spell effects.
const NOT_PRODUCED: [bool; UNIT_TYPE_COUNT] = unit_type_set([
    unit::GOLIATH_TURRET,
    unit::SIEGE_TANK_TURRET,
    unit::SIEGE_TANK_SIEGE_TURRET,
    unit::SPIDER_MINE,
    unit::SCANNER_SWEEP,
    unit::LARVA,
    unit::EGG,
    unit::COCOON,
    unit::LURKER_EGG,
    unit::BROODLING,
    unit::INTERCEPTOR,
    unit::SCARAB,
    unit::DISRUPTION_WEB,
    unit::DARK_SWARM,
]);

/// Unit types left out of the lists of what each player destroyed and lost: parts of other units,
/// and units that die by being used up or running out of time. How many of these died says
/// nothing about how a fight went.
const NOT_FOUGHT: [bool; UNIT_TYPE_COUNT] = unit_type_set([
    unit::GOLIATH_TURRET,
    unit::SIEGE_TANK_TURRET,
    unit::SIEGE_TANK_SIEGE_TURRET,
    unit::SPIDER_MINE,
    unit::NUCLEAR_MISSILE,
    unit::SCANNER_SWEEP,
    unit::BROODLING,
    unit::SCARAB,
    unit::DISRUPTION_WEB,
    unit::DARK_SWARM,
]);

/// Unit types made by morphing another, which is used up, and what they're morphed from. Earlier
/// stages come first.
const MORPHS: [(UnitId, UnitId); 8] = [
    (unit::LURKER, unit::HYDRALISK),
    (unit::GUARDIAN, unit::MUTALISK),
    (unit::DEVOURER, unit::MUTALISK),
    (unit::LAIR, unit::HATCHERY),
    (unit::HIVE, unit::LAIR),
    (unit::GREATER_SPIRE, unit::SPIRE),
    (unit::SUNKEN_COLONY, unit::CREEP_COLONY),
    (unit::SPORE_COLONY, unit::CREEP_COLONY),
];

/// Main buildings, which each make a base.
const TOWN_HALLS: [bool; UNIT_TYPE_COUNT] = unit_type_set([
    unit::COMMAND_CENTER,
    unit::NEXUS,
    unit::HATCHERY,
    unit::LAIR,
    unit::HIVE,
]);

/// How far a town hall can be from mineral fields and still be mining them, in pixels.
const MINERAL_REACH: i32 = 10 * 32;
/// How close town halls can be and still be part of the same base, like a macro Hatchery next to
/// a main one, in pixels.
const BASE_SPREAD: i32 = 12 * 32;

/// Supply is counted in halves, since Zerglings and Scourge take half a supply each.
const SUPPLY_LIMIT: u32 = 200 * 2;

/// A player who leaves this long before the game ends is reported as having left, rather than as
/// someone who stayed until the end.
const LEFT_EARLY_FRAMES: u32 = 24 * 5;
/// How often each player's progress is recorded: every 10 seconds of game time on Fastest.
const SNAPSHOT_FRAMES: u32 = 238;
/// How often the game's units are looked through for larvae and scouting: every second.
const SCAN_FRAMES: u32 = 24;
/// A gap between scans longer than this, like a replay seeking, isn't counted, since what happened
/// in it can't be told.
const MAX_SCAN_GAP: u32 = SCAN_FRAMES * 4;
/// Larvae this close to a Hatchery, Lair or Hive are taken to be its own, in pixels.
const LARVA_REACH: i32 = 6 * 32;
/// The larvae a Hatchery holds before it stops making more.
const LARVA_CAP: u32 = 3;
/// A unit this close to an enemy's starting base has scouted it, in pixels.
const SCOUT_REACH: i32 = 12 * 32;
/// How many of a player's latest actions are kept for judging whether their next one is effective.
const RECENT_ACTIONS: usize = 16;

/// Each game runs in its own process, so these only ever need to latch once.
static SEEK_REQUESTED: AtomicBool = AtomicBool::new(false);
/// Whether a watched replay that opens at a later frame has been sent there.
static START_SEEK_REQUESTED: AtomicBool = AtomicBool::new(false);
static REPORTED: AtomicBool = AtomicBool::new(false);

/// Stats gathered as a game goes, since much of what the game keeps is cleared as players leave
/// and nothing records production or actions at all. It's reset whenever the game is initialized
/// again, which a replay does when seeking backwards.
///
/// Players and slots are both indexed by player id. Each player plays their own slot, except in
/// games with shared control, where everyone on a team plays their team's main player's slot.
pub struct GameStatsTracker {
    /// Who was in each slot when tracking started. Leaving closes a player's slot, so this is what
    /// says who played.
    players: [Option<StartingPlayer>; PLAYER_COUNT],
    /// The slot each player's units, score and resources belong to.
    slot_of: [usize; PLAYER_COUNT],
    /// Whether each slot is still being played. Leaving or being defeated clears some of what the
    /// game keeps for a slot, so it stops being followed once that happens.
    following: [bool; PLAYER_COUNT],
    /// Each slot's minerals and gas gathered when tracking started, so what it began with isn't
    /// counted as mined.
    starting_gathered: [(u32, u32); PLAYER_COUNT],
    /// Each slot's totals as of the last frame it was followed.
    totals: Box<Totals>,
    /// How many of each unit type each slot had finished or lost as of the last update. Any
    /// increase is a unit produced.
    last_counts: Box<[[u32; PLAYER_COUNT]; UNIT_TYPE_COUNT]>,
    produced: Box<[[u32; PLAYER_COUNT]; UNIT_TYPE_COUNT]>,
    activity: [PlayerActivity; PLAYER_COUNT],
    units: Box<UnitCatalog>,
    /// Counts each slot's bases, or returns `None` if the game's units can't be looked through.
    count_bases: unsafe fn() -> Option<[u32; PLAYER_COUNT]>,
    /// Lists the game's units for larvae and scouting, or returns `None` if they can't be looked
    /// through.
    list_units: unsafe fn() -> Option<Vec<SeenUnit>>,
    scouting: Box<Scouting>,
    /// The frames each slot's progress was recorded on.
    snapshot_frames: Vec<u32>,
    /// Each slot's recorded progress, one per frame in `snapshot_frames` for as long as the slot
    /// was being played.
    snapshots: [Vec<Snapshot>; PLAYER_COUNT],
    /// How many frames each slot couldn't make more units because it was out of supply.
    supply_blocked_frames: [u32; PLAYER_COUNT],
    build_orders: Box<BuildOrders>,
    /// Whether the game has counted what each slot starts with yet. It only does a little after
    /// the game starts, so until a slot has finished units, whatever shows up for it is what it
    /// started with rather than anything it made.
    started: [bool; PLAYER_COUNT],
}

/// One of the game's units, as much as larvae and scouting need.
#[derive(Copy, Clone, Debug)]
struct SeenUnit {
    slot: usize,
    id: UnitId,
    position: bw::Point,
    /// A building, finished or not, which can't scout.
    building: bool,
    /// Finished, or a Hatchery or Lair morphing into the next, which still makes larvae.
    working: bool,
}

/// Where each slot started, who scouted whom when, and how long Zerg Hatcheries sat full of larvae.
#[derive(Default)]
struct Scouting {
    last_scan_frame: Option<u32>,
    /// Where each slot's first town hall was.
    start_bases: [Option<bw::Point>; PLAYER_COUNT],
    /// The frame each slot first had a unit near an enemy's starting base.
    first_scout_frame: [Option<u32>; PLAYER_COUNT],
    /// Frames each slot's Hatcheries, Lairs and Hives spent working, added up over all of them.
    hatchery_frames: [u32; PLAYER_COUNT],
    /// Of those, frames they spent holding all the larvae they can, which wastes the next ones.
    larva_capped_frames: [u32; PLAYER_COUNT],
}

/// What each slot started making, researching and upgrading, and what's needed to notice it.
struct BuildOrders {
    steps: [Vec<BuildStep>; PLAYER_COUNT],
    /// How many of each unit type each slot had as of the last update, counting ones still being
    /// made.
    unit_counts: [[u32; PLAYER_COUNT]; UNIT_TYPE_COUNT],
    upgrade_levels: [[u8; UPGRADE_COUNT]; PLAYER_COUNT],
    techs: [[bool; TECH_COUNT]; PLAYER_COUNT],
    /// Each slot's supply in use, in halves, from each frame it changed on.
    supply_history: [Vec<(u32, u32)>; PLAYER_COUNT],
    /// Each slot's minerals and gas on hand as of the last update.
    bank: [Resources; PLAYER_COUNT],
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum BuildStepKind {
    Unit,
    Upgrade,
    Tech,
}

/// One thing a player started making, researching or upgrading.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildStep {
    /// When it was started.
    frame: u32,
    kind: BuildStepKind,
    /// The unit type, upgrade or tech.
    id: u16,
    /// The level an upgrade went up to.
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<u8>,
    /// The player's supply in use just before it was started, in whole units.
    supply: Option<u32>,
    /// How many were started at once, like the two Zerglings from one egg.
    count: u32,
    cancelled: bool,
}

#[derive(Copy, Clone)]
struct Snapshot {
    workers: u32,
    army_score: u32,
    resources_mined: u32,
    unspent: u32,
    supply: Supply,
    /// Actions so far by everyone playing the slot, if they issue any.
    actions: Option<u32>,
    /// The ones of those that weren't wasted, see [`PlayerActivity`].
    effective_actions: Option<u32>,
    resources_lost: u32,
    bases: u32,
    supply_blocked_frames: u32,
    hatchery_frames: u32,
    larva_capped_frames: u32,
}

/// A slot's supply, in halves.
#[derive(Copy, Clone, Default)]
struct Supply {
    used: u32,
    /// What the slot's supply buildings provide, up to the limit.
    available: u32,
}

impl Supply {
    /// Reads a slot's supply, for the race it plays. Unknown races have no supply.
    unsafe fn read(game: *mut bw::Game, slot: usize, race: u8) -> Supply {
        let Some(supplies) = (unsafe { (*game).supplies.get(race as usize) }) else {
            return Supply::default();
        };
        Supply {
            used: supplies.used[slot],
            available: supplies.provided[slot].min(supplies.max[slot]),
        }
    }

    /// Whether more units can't be made until more supply is built.
    fn is_blocked(self) -> bool {
        self.available < SUPPLY_LIMIT && self.used >= self.available
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum UnitKind {
    Worker,
    Army,
    /// Buildings, and units that neither gather nor fight, like Overlords and the spawns, eggs
    /// and spell effects that nobody produces on purpose.
    Other,
}

/// Minerals and gas.
#[derive(Copy, Clone, Default)]
struct Resources {
    minerals: u32,
    gas: u32,
}

impl Resources {
    fn plus(self, other: Resources) -> Resources {
        Resources {
            minerals: self.minerals.saturating_add(other.minerals),
            gas: self.gas.saturating_add(other.gas),
        }
    }

    fn times(self, n: u32) -> Resources {
        Resources {
            minerals: self.minerals.saturating_mul(n),
            gas: self.gas.saturating_mul(n),
        }
    }
}

/// What a group of units is worth: the game's own score for them, which weighs gas and tech more
/// than minerals, and the minerals and gas they took.
#[derive(Copy, Clone, Default, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Worth {
    score: u32,
    minerals: u32,
    gas: u32,
}

/// What units of one type are worth.
#[derive(Copy, Clone, Default)]
struct UnitWorth {
    /// The minerals and gas two of them take. It's for two since Zerglings and Scourge come in
    /// pairs for what the game lists them as costing.
    pair_cost: Resources,
    /// The game's build score for one of them, which it adds to a player's unit score when the
    /// unit is made.
    score: u32,
}

impl UnitWorth {
    fn plus(self, other: UnitWorth) -> UnitWorth {
        UnitWorth {
            pair_cost: self.pair_cost.plus(other.pair_cost),
            score: self.score.saturating_add(other.score),
        }
    }

    fn times(self, n: u32) -> UnitWorth {
        UnitWorth {
            pair_cost: self.pair_cost.times(n),
            score: self.score.saturating_mul(n),
        }
    }
}

/// Which of a unit's worth to count.
#[derive(Copy, Clone)]
enum Counting {
    /// What making it added, on top of the units it was made from, for units produced. A
    /// Hydralisk morphed into a Lurker was already counted when it was made.
    Added,
    /// Everything it's worth, including the units it was made from, for units that died or are
    /// still standing.
    Whole,
}

/// How long researching takes, in frames.
struct ResearchTimes {
    /// For each upgrade, the time for its first level and how much longer each level after takes.
    upgrades: [(u32, u32); UPGRADE_COUNT],
    techs: [u32; TECH_COUNT],
}

impl ResearchTimes {
    fn from_game_data() -> ResearchTimes {
        ResearchTimes {
            upgrades: std::array::from_fn(|i| {
                let id = UpgradeId(i as u16);
                (id.time(), id.time_factor())
            }),
            techs: std::array::from_fn(|i| TechId(i as u16).time()),
        }
    }

    /// How long researching an upgrade up to `level` took.
    fn upgrade(&self, upgrade: usize, level: u8) -> u32 {
        let (time, time_factor) = self.upgrades.get(upgrade).copied().unwrap_or_default();
        time.saturating_add(time_factor.saturating_mul(u32::from(level.saturating_sub(1))))
    }
}

/// What each unit type is, and what it's worth.
struct UnitCatalog {
    kind: [UnitKind; UNIT_TYPE_COUNT],
    building: [bool; UNIT_TYPE_COUNT],
    /// How long units hatched from larvae or cocoons take, in frames, which the game only counts
    /// once they hatch. Zero for everything else.
    hatch_time: [u32; UNIT_TYPE_COUNT],
    research: ResearchTimes,
    added: [UnitWorth; UNIT_TYPE_COUNT],
    /// A Zerg building's Drone isn't included, since losing a Drone that way isn't a unit lost.
    whole: [UnitWorth; UNIT_TYPE_COUNT],
}

/// The group flag in the game's unit data marking Zerg unit types.
const ZERG_GROUP_FLAG: u32 = 0x1;

/// The field of the game's unit data holding each unit type's build score.
const BUILD_SCORE_FIELD: u32 = 49;

impl UnitCatalog {
    /// Reads the catalog from the game's unit data, which is loaded by the time a game starts.
    fn from_game_data() -> UnitCatalog {
        let kind = std::array::from_fn(|i| {
            let id = UnitId(i as u16);
            if id.is_worker() {
                UnitKind::Worker
            } else if id.is_building()
                || NOT_PRODUCED[i]
                || id == unit::OVERLORD
                || id == unit::NUCLEAR_MISSILE
            {
                UnitKind::Other
            } else {
                UnitKind::Army
            }
        });
        let listed = std::array::from_fn(|i| {
            let id = UnitId(i as u16);
            (
                Resources {
                    minerals: id.mineral_cost(),
                    gas: id.gas_cost(),
                },
                id.get(BUILD_SCORE_FIELD),
            )
        });
        let mut catalog = UnitCatalog::new(kind, listed);
        catalog.building = std::array::from_fn(|i| UnitId(i as u16).is_building());
        catalog.hatch_time = std::array::from_fn(|i| {
            let id = UnitId(i as u16);
            let is_zerg = id.group_flags() & ZERG_GROUP_FLAG != 0;
            if is_zerg && !id.is_building() && !NOT_PRODUCED[i] {
                id.build_time()
            } else {
                0
            }
        });
        catalog.research = ResearchTimes::from_game_data();
        catalog
    }

    /// Values each unit type from what the game lists it as costing and scoring, which doesn't
    /// always say what a unit is worth.
    fn new(
        kind: [UnitKind; UNIT_TYPE_COUNT],
        listed: [(Resources, u32); UNIT_TYPE_COUNT],
    ) -> UnitCatalog {
        let index = |id: UnitId| id.0 as usize;
        let mut added = listed.map(|(cost, score)| UnitWorth {
            pair_cost: cost.times(2),
            score,
        });
        // These hatch in pairs for what's listed.
        for pair in [unit::ZERGLING, unit::SCOURGE] {
            added[index(pair)].pair_cost = listed[index(pair)].0;
        }
        // Merging costs nothing more than the templar did.
        let merges = [
            (unit::ARCHON, unit::HIGH_TEMPLAR),
            (unit::DARK_ARCHON, unit::DARK_TEMPLAR),
        ];
        for (merged, _) in merges {
            added[index(merged)].pair_cost = Resources::default();
        }

        let mut whole = added;
        // Morphing uses up what's morphed. Earlier stages come first, so later ones build on
        // their whole worth.
        for (morphed, from) in MORPHS {
            whole[index(morphed)] = added[index(morphed)].plus(whole[index(from)]);
        }
        for (merged, from) in merges {
            whole[index(merged)] = added[index(merged)].plus(whole[index(from)].times(2));
        }
        UnitCatalog {
            kind,
            building: [false; UNIT_TYPE_COUNT],
            hatch_time: [0; UNIT_TYPE_COUNT],
            research: ResearchTimes {
                upgrades: [(0, 0); UPGRADE_COUNT],
                techs: [0; TECH_COUNT],
            },
            added,
            whole,
        }
    }

    /// What the units counted in `counts` (indexed by unit id) are worth, counting only the unit
    /// types `include` says to.
    fn worth_of(
        &self,
        counts: impl IntoIterator<Item = u32>,
        include: impl Fn(usize) -> bool,
        counting: Counting,
    ) -> Worth {
        let table = match counting {
            Counting::Added => &self.added,
            Counting::Whole => &self.whole,
        };
        let total = counts
            .into_iter()
            .zip(table)
            .enumerate()
            .filter(|&(unit_id, _)| include(unit_id))
            .fold(UnitWorth::default(), |total, (_, (count, worth))| {
                total.plus(worth.times(count))
            });
        Worth {
            score: total.score,
            minerals: total.pair_cost.minerals / 2,
            gas: total.pair_cost.gas / 2,
        }
    }

    /// What the army units counted in `counts` are worth. Workers, buildings and Overlords aren't
    /// part of an army.
    fn army_worth(&self, counts: impl IntoIterator<Item = u32>, counting: Counting) -> Worth {
        self.worth_of(counts, |unit_id| self.is_army(unit_id), counting)
    }

    /// What the units counted in `counts` were worth in minerals and gas together, leaving out
    /// the unit types in `left_out`.
    fn value_of(
        &self,
        counts: impl IntoIterator<Item = u32>,
        left_out: &[bool; UNIT_TYPE_COUNT],
    ) -> u32 {
        let worth = self.worth_of(counts, |unit_id| !left_out[unit_id], Counting::Whole);
        worth.minerals.saturating_add(worth.gas)
    }

    fn is_army(&self, unit_id: usize) -> bool {
        self.kind.get(unit_id) == Some(&UnitKind::Army)
    }
}

struct StartingPlayer {
    name: String,
    race: u8,
    team: u8,
    is_computer: bool,
}

/// The running totals the game keeps for each slot, laid out the way the game keeps them.
struct Totals {
    /// Minerals and gas gathered, including what the slot started with.
    gathered: [(u32, u32); PLAYER_COUNT],
    scores: [[u32; PLAYER_COUNT]; SCORE_COUNT],
    kills: [[u32; PLAYER_COUNT]; UNIT_TYPE_COUNT],
    deaths: [[u32; PLAYER_COUNT]; UNIT_TYPE_COUNT],
}

#[derive(Default)]
struct PlayerActivity {
    left_at_frame: Option<u32>,
    actions: u32,
    effective_actions: u32,
    recent: VecDeque<Action>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStats {
    map_name: String,
    frames: u32,
    /// False when the stats don't cover the whole game: a replay being analyzed stopped before its
    /// end, or the game kept going after it ended for this client.
    complete: bool,
    /// The frames each player's progress was recorded on, see `PlayerStats::timeline`.
    snapshot_frames: Vec<u32>,
    players: Vec<PlayerStats>,
}

/// A player's progress over the game, with one value per frame in `GameStats::snapshot_frames` for
/// as long as they were playing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Timeline {
    workers: Vec<u32>,
    /// The game's score for the player's army, see [`Worth`]. Workers, buildings and Overlords
    /// aren't part of an army.
    army_score: Vec<u32>,
    /// Minerals and gas mined so far.
    resources_mined: Vec<u32>,
    /// Minerals and gas on hand, not yet spent.
    unspent: Vec<u32>,
    supply_used: Vec<u32>,
    /// What the player's supply buildings provided, up to the limit of 200.
    supply_available: Vec<u32>,
    /// Actions so far, missing for computers.
    actions: Option<Vec<u32>>,
    /// Effective actions so far, missing for computers.
    effective_actions: Option<Vec<u32>>,
    /// What everything the player lost so far was worth in minerals and gas together.
    resources_lost: Vec<u32>,
    /// Town halls with minerals left near them, counting ones close together as one base.
    bases: Vec<u32>,
    /// How many frames the player had been out of supply so far.
    supply_blocked_frames: Vec<u32>,
    /// For Zerg, frames their Hatcheries, Lairs and Hives had worked so far, added up over all of
    /// them, and of those, frames they held all the larvae they could.
    #[serde(skip_serializing_if = "Option::is_none")]
    hatchery_frames: Option<Vec<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    larva_capped_frames: Option<Vec<u32>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerStats {
    id: u8,
    /// More than one in games with shared control, where everyone sharing a slot is reported
    /// together.
    names: Vec<String>,
    race: u8,
    team: u8,
    victory_state: u8,
    left_at_frame: Option<u32>,
    /// Missing for computers, which play without issuing commands.
    actions: Option<u32>,
    effective_actions: Option<u32>,
    /// Unit id and count for each type of unit this player produced, not counting what they
    /// started with. Counts what was started rather than finished for morphs: canceling one gives
    /// back the unit it came from, which is counted again. Units taken with Mind Control count as
    /// produced too.
    ///
    /// This and the unit lists below are missing on maps with their own rules, whose triggers can
    /// create, give away and count units however they like.
    produced: Option<Vec<(u16, u32)>>,
    minerals_mined: u32,
    gas_mined: u32,
    unit_score: u32,
    kill_score: u32,
    building_score: u32,
    razing_score: u32,
    /// Unit id and count for each type of enemy this player destroyed.
    kills: Option<Vec<(u16, u32)>>,
    /// Unit id and count for each type of this player's own units that died.
    deaths: Option<Vec<(u16, u32)>>,
    /// What the army units this player produced, killed and lost were worth. Workers, buildings
    /// and Overlords aren't part of an army.
    army_produced: Option<Worth>,
    army_killed: Option<Worth>,
    army_lost: Option<Worth>,
    /// What everything this player destroyed was worth in minerals and gas together.
    resources_destroyed: Option<u32>,
    /// What everything this player lost was worth in minerals and gas together.
    resources_lost: Option<u32>,
    /// How many frames the player couldn't make more units because they were out of supply.
    supply_blocked_frames: Option<u32>,
    timeline: Option<Timeline>,
    /// What the player started making, researching and upgrading, in order.
    build_order: Option<Vec<BuildStep>>,
    /// The frame the player first had a unit near an enemy's starting base.
    #[serde(skip_serializing_if = "Option::is_none")]
    first_scout_frame: Option<u32>,
}

/// Live games are tracked so they can be reported when they end, and so are replays being
/// analyzed. Replays someone is watching aren't, since nothing reads their stats.
fn is_tracking() -> bool {
    !game_thread::is_replay() || game_thread::is_replay_analysis()
}

fn game() -> Option<*mut bw::Game> {
    let game = unsafe { get_bw().game() };
    (!game.is_null()).then_some(game)
}

fn players() -> Option<*mut bw::Player> {
    let players = unsafe { get_bw().players() };
    (!players.is_null()).then_some(players)
}

/// The frame the replay being played ends on, if the replay says.
fn replay_end_frame() -> Option<u32> {
    let header = unsafe { get_bw().replay_header() };
    if header.is_null() {
        return None;
    }
    let end_frame = unsafe { (*header).replay_end_frame };
    (end_frame != 0).then_some(end_frame)
}

/// Whether a slot holds someone playing, as opposed to being empty, closed, neutral, rescuable or
/// an observer.
fn is_player_type(player_type: u8) -> bool {
    matches!(
        player_type,
        bw::PLAYER_TYPE_COMPUTER | bw::PLAYER_TYPE_HUMAN
    )
}

/// Runs after every game step. Keeps the stats up to date, and while analyzing a replay, seeks to
/// its end once it has started and reports when it gets there.
pub unsafe fn after_step() {
    // A watched replay that opens at a moment, like one the coach points to, jumps there once it
    // has started.
    if let Some(start_frame) = game_thread::replay_start_frame()
        && !START_SEEK_REQUESTED.swap(true, Ordering::Relaxed)
    {
        debug!("Opening replay at frame {start_frame}");
        unsafe { get_bw().seek_replay(start_frame) };
    }

    // Nothing more is reported after the stats are, even if the game goes on.
    if !is_tracking() || REPORTED.load(Ordering::Relaxed) {
        return;
    }
    let (Some(game), Some(players)) = (game(), players()) else {
        return;
    };
    let frame = unsafe { (*game).frame_count };
    if let Some(mut tracker) = get_bw().game_stats().lock() {
        let tracker =
            tracker.get_or_insert_with(|| unsafe { GameStatsTracker::start(game, players) });
        unsafe { tracker.update(game, players, frame) };
    }

    if game_thread::is_replay_analysis() {
        match replay_end_frame() {
            Some(end_frame) if frame >= end_frame => unsafe { report() },
            Some(end_frame) => {
                if !SEEK_REQUESTED.swap(true, Ordering::Relaxed) {
                    debug!("Analyzing replay, seeking from frame {frame} to {end_frame}");
                    unsafe { get_bw().seek_replay(end_frame) };
                }
            }
            None => {
                // Without a known end there's nothing to seek to, and playing the whole replay
                // out in real time would take as long as the game did.
                warn!("Can't analyze a replay without a known end frame");
                send_once(GameThreadMessage::GameStatsFailed);
            }
        }
    }
}

/// Reports the stats once the game has ended for this client. For a replay being analyzed this
/// only matters if it stopped before reaching its end, which is reported as incomplete.
pub unsafe fn game_ended() {
    if is_tracking() {
        unsafe { report() };
    }
}

/// Records a command a player issued, for their action counts and for noticing when they leave.
pub unsafe fn record_command(player: u8, command: &[u8]) {
    let player = player as usize;
    if player >= PLAYER_COUNT || !is_tracking() {
        return;
    }
    let (Some(game), Some(players)) = (game(), players()) else {
        return;
    };
    let frame = unsafe { (*game).frame_count };
    if let Some(mut tracker) = get_bw().game_stats().lock() {
        let tracker =
            tracker.get_or_insert_with(|| unsafe { GameStatsTracker::start(game, players) });
        tracker.activity[player].record_command(command, frame);
    }
}

impl GameStatsTracker {
    unsafe fn start(game: *mut bw::Game, players: *mut bw::Player) -> GameStatsTracker {
        unsafe {
            GameStatsTracker::new(
                game,
                players,
                game_thread::is_team_game(),
                UnitCatalog::from_game_data(),
                count_bases_in_game,
                list_units_in_game,
            )
        }
    }

    unsafe fn new(
        game: *mut bw::Game,
        players: *mut bw::Player,
        is_team_game: bool,
        units: UnitCatalog,
        count_bases: unsafe fn() -> Option<[u32; PLAYER_COUNT]>,
        list_units: unsafe fn() -> Option<Vec<SeenUnit>>,
    ) -> GameStatsTracker {
        unsafe {
            let starting_players: [Option<StartingPlayer>; PLAYER_COUNT] =
                std::array::from_fn(|id| {
                    let player = players.add(id);
                    is_player_type((*player).player_type).then(|| StartingPlayer {
                        name: player_name(player).into_owned(),
                        race: (*player).race,
                        team: (*player).team,
                        is_computer: (*player).player_type == bw::PLAYER_TYPE_COMPUTER,
                    })
                });
            let slot_of = if is_team_game {
                shared_control_slots(&starting_players, &(*game).team_game_main_player)
            } else {
                std::array::from_fn(|id| id)
            };
            let mut tracker = GameStatsTracker {
                following: std::array::from_fn(|id| starting_players[id].is_some()),
                players: starting_players,
                slot_of,
                starting_gathered: std::array::from_fn(|slot| gathered(game, slot)),
                totals: Box::new(Totals {
                    gathered: [(0, 0); PLAYER_COUNT],
                    scores: [[0; PLAYER_COUNT]; SCORE_COUNT],
                    kills: [[0; PLAYER_COUNT]; UNIT_TYPE_COUNT],
                    deaths: [[0; PLAYER_COUNT]; UNIT_TYPE_COUNT],
                }),
                last_counts: Box::new([[0; PLAYER_COUNT]; UNIT_TYPE_COUNT]),
                produced: Box::new([[0; PLAYER_COUNT]; UNIT_TYPE_COUNT]),
                activity: Default::default(),
                units: Box::new(units),
                count_bases,
                list_units,
                scouting: Default::default(),
                snapshot_frames: Vec::new(),
                snapshots: Default::default(),
                supply_blocked_frames: [0; PLAYER_COUNT],
                build_orders: Box::new(BuildOrders {
                    steps: Default::default(),
                    unit_counts: [[0; PLAYER_COUNT]; UNIT_TYPE_COUNT],
                    upgrade_levels: [[0; UPGRADE_COUNT]; PLAYER_COUNT],
                    techs: [[false; TECH_COUNT]; PLAYER_COUNT],
                    supply_history: Default::default(),
                    bank: [Resources::default(); PLAYER_COUNT],
                }),
                started: [false; PLAYER_COUNT],
            };
            tracker.update(game, players, (*game).frame_count);
            tracker
        }
    }

    unsafe fn update(&mut self, game: *mut bw::Game, players: *mut bw::Player, frame: u32) {
        unsafe {
            for (id, player) in self.players.iter().enumerate() {
                let activity = &mut self.activity[id];
                if player.is_none() || activity.left_at_frame.is_some() {
                    continue;
                }
                // Their slot was closed without them sending a leave, like when they drop, or
                // they were defeated and stayed to watch.
                let closed = !is_player_type((*players.add(id)).player_type);
                let defeated = (*game).victory_state.get(self.slot_of[id]).copied()
                    == Some(victory_state::DEFEAT);
                if closed || defeated {
                    activity.left_at_frame = Some(frame);
                }
            }
            self.following = std::array::from_fn(|slot| {
                self.following[slot] && self.is_still_played(game, slot)
            });
            for slot in 0..PLAYER_COUNT {
                if self.following[slot] && !self.started[slot] && has_finished_units(game, slot) {
                    self.start_slot(game, slot);
                }
            }
            // Before the totals are updated, since it compares the bank with the last update's.
            self.record_build_steps(game, frame);

            let following = &self.following;
            let totals = &mut *self.totals;
            for ((gathered_total, &followed), slot) in
                totals.gathered.iter_mut().zip(following).zip(0..)
            {
                if followed {
                    *gathered_total = gathered(game, slot);
                }
            }
            for (total, by_player) in totals.scores.iter_mut().zip(&(*game).scores) {
                copy_followed(following, total, by_player);
            }
            for (unit_id, &not_produced) in NOT_PRODUCED.iter().enumerate() {
                copy_followed(
                    following,
                    &mut totals.kills[unit_id],
                    &(*game).unit_kills[unit_id],
                );
                copy_followed(
                    following,
                    &mut totals.deaths[unit_id],
                    &(*game).deaths[unit_id],
                );
                if not_produced || unit_id == unit::SIEGE_TANK_SIEGE.0 as usize {
                    continue;
                }
                let counts = finished_or_lost(game, unit_id);
                let last_counts = &mut self.last_counts[unit_id];
                let produced = &mut self.produced[unit_id];
                for slot in (0..PLAYER_COUNT).filter(|&slot| following[slot] && self.started[slot])
                {
                    // A count only drops when a unit morphs into something else, which isn't a
                    // unit lost.
                    let new = counts[slot].saturating_sub(last_counts[slot]);
                    produced[slot] = produced[slot].saturating_add(new);
                    last_counts[slot] = counts[slot];
                }
            }

            for slot in (0..PLAYER_COUNT).filter(|&slot| self.following[slot]) {
                if Supply::read(game, slot, self.race_of(slot)).is_blocked() {
                    let blocked = &mut self.supply_blocked_frames[slot];
                    *blocked = blocked.saturating_add(1);
                }
            }

            let scan_due = self
                .scouting
                .last_scan_frame
                .is_none_or(|last| frame >= last.saturating_add(SCAN_FRAMES));
            if scan_due && let Some(units) = (self.list_units)() {
                self.record_scan(&units, frame);
            }

            let due = self
                .snapshot_frames
                .last()
                .is_none_or(|&last| frame >= last.saturating_add(SNAPSHOT_FRAMES));
            if due {
                self.take_snapshot(game, frame);
            }
        }
    }

    /// Takes what a slot has once the game first counts it as what it started with, so it's not
    /// counted as made.
    unsafe fn start_slot(&mut self, game: *mut bw::Game, slot: usize) {
        unsafe {
            for unit_id in 0..UNIT_TYPE_COUNT {
                self.last_counts[unit_id][slot] = finished_or_lost(game, unit_id)[slot];
                self.build_orders.unit_counts[unit_id][slot] = all_counts(game, unit_id)[slot];
            }
            let (levels, techs) = research(game, slot);
            let build = &mut *self.build_orders;
            build.upgrade_levels[slot] = levels;
            build.techs[slot] = techs;
            build.bank[slot] = bank(game, slot);
        }
        self.started[slot] = true;
    }

    /// Adds whatever each followed slot started making, researching or upgrading since the last
    /// update to its build order.
    unsafe fn record_build_steps(&mut self, game: *mut bw::Game, frame: u32) {
        for slot in (0..PLAYER_COUNT).filter(|&slot| self.following[slot]) {
            let race = self.race_of(slot);
            let used = unsafe { Supply::read(game, slot, race).used };
            let history = &mut self.build_orders.supply_history[slot];
            if history.last().is_none_or(|&(_, last)| last != used) {
                history.push((frame, used));
            }
            if !self.started[slot] {
                continue;
            }
            let build = &mut *self.build_orders;
            let mut started = [0u32; UNIT_TYPE_COUNT];
            let mut gone = [0u32; UNIT_TYPE_COUNT];
            for (unit_id, &not_produced) in NOT_PRODUCED.iter().enumerate() {
                if not_produced || unit_id == unit::SIEGE_TANK_SIEGE.0 as usize {
                    continue;
                }
                let count = unsafe { all_counts(game, unit_id)[slot] };
                let last = &mut build.unit_counts[unit_id][slot];
                started[unit_id] = count.saturating_sub(*last);
                gone[unit_id] = last.saturating_sub(count);
                *last = count;
            }
            for (morphed, from) in MORPHS {
                let (morphed, from) = (morphed.0 as usize, from.0 as usize);
                // A canceled morph gives back what was being morphed, which isn't something new.
                let given_back = started[from].min(gone[morphed]);
                started[from] -= given_back;
                // Morphing uses up what's morphed, which isn't a cancel.
                gone[from] = gone[from].saturating_sub(started[morphed]);
            }

            let steps = &mut build.steps[slot];
            // Canceling gives back at least three quarters of what something cost right away,
            // while losing it gives nothing back, so what came back without being mined says
            // what was canceled.
            let now = unsafe { bank(game, slot) };
            let (minerals_mined, gas_mined) = unsafe { gathered(game, slot) };
            let (last_minerals_mined, last_gas_mined) = self.totals.gathered[slot];
            let mut given_back = (
                i64::from(now.minerals)
                    - i64::from(build.bank[slot].minerals)
                    - (i64::from(minerals_mined) - i64::from(last_minerals_mined)),
                i64::from(now.gas)
                    - i64::from(build.bank[slot].gas)
                    - (i64::from(gas_mined) - i64::from(last_gas_mined)),
            );
            build.bank[slot] = now;
            let mut canceled_buildings = 0;
            for (unit_id, &count) in gone.iter().enumerate() {
                // The cost of two, so three eighths of it is three quarters of one's.
                let pair_cost = self.units.added[unit_id].pair_cost;
                let refund = (
                    i64::from(pair_cost.minerals) * 3 / 8,
                    i64::from(pair_cost.gas) * 3 / 8,
                );
                if count == 0 || refund == (0, 0) {
                    continue;
                }
                let mut canceled = 0;
                while canceled < count && given_back.0 >= refund.0 && given_back.1 >= refund.1 {
                    given_back = (given_back.0 - refund.0, given_back.1 - refund.1);
                    canceled += 1;
                }
                if self.units.building[unit_id] {
                    canceled_buildings += canceled;
                }
                for step in steps.iter_mut().rev() {
                    if canceled == 0 {
                        break;
                    }
                    if step.kind == BuildStepKind::Unit
                        && usize::from(step.id) == unit_id
                        && !step.cancelled
                    {
                        step.cancelled = true;
                        canceled -= 1;
                    }
                }
            }
            if race == bw::RACE_ZERG {
                // A canceled Zerg building gives back the Drone that became it.
                let drones = &mut started[unit::DRONE.0 as usize];
                *drones = drones.saturating_sub(canceled_buildings);
            }

            for (unit_id, &count) in started.iter().enumerate().filter(|&(_, &count)| count > 0) {
                steps.push(BuildStep {
                    // Units hatched from larvae are only counted once they hatch.
                    frame: frame.saturating_sub(self.units.hatch_time[unit_id]),
                    kind: BuildStepKind::Unit,
                    id: unit_id as u16,
                    level: None,
                    supply: None,
                    count,
                    cancelled: false,
                });
            }

            let (levels, techs) = unsafe { research(game, slot) };
            for (upgrade_id, &level) in levels.iter().enumerate() {
                for reached in build.upgrade_levels[slot][upgrade_id].saturating_add(1)..=level {
                    steps.push(BuildStep {
                        frame: frame
                            .saturating_sub(self.units.research.upgrade(upgrade_id, reached)),
                        kind: BuildStepKind::Upgrade,
                        id: upgrade_id as u16,
                        level: Some(reached),
                        supply: None,
                        count: 1,
                        cancelled: false,
                    });
                }
            }
            for (tech_id, &researched) in techs.iter().enumerate() {
                if researched && !build.techs[slot][tech_id] {
                    steps.push(BuildStep {
                        frame: frame.saturating_sub(self.units.research.techs[tech_id]),
                        kind: BuildStepKind::Tech,
                        id: tech_id as u16,
                        level: None,
                        supply: None,
                        count: 1,
                        cancelled: false,
                    });
                }
            }
            build.upgrade_levels[slot] = levels;
            build.techs[slot] = techs;
        }
    }

    /// A slot's build order, in the order things were started.
    fn build_order(&self, slot: usize) -> Vec<BuildStep> {
        let history = &self.build_orders.supply_history[slot];
        let mut steps = self.build_orders.steps[slot].clone();
        for step in &mut steps {
            // What it was by the end of the frame before, since starting something takes supply.
            let before = history.partition_point(|&(frame, _)| frame < step.frame);
            step.supply = before.checked_sub(1).map(|i| history[i].1.div_ceil(2));
        }
        // Research and units from larvae are noticed after they started, behind things started
        // since.
        steps.sort_by_key(|step| step.frame);
        steps
    }

    /// Records each followed slot's progress as of `frame`, unless it already was.
    unsafe fn take_snapshot(&mut self, game: *mut bw::Game, frame: u32) {
        if self.snapshot_frames.last() == Some(&frame) {
            return;
        }
        self.snapshot_frames.push(frame);
        let bases_by_slot = unsafe { (self.count_bases)() };
        for slot in (0..PLAYER_COUNT).filter(|&slot| self.following[slot]) {
            let mut workers = 0u32;
            let mut town_halls = 0u32;
            let completed =
                |unit_id: usize| unsafe { (*game).completed_units_count[unit_id][slot] };
            for (unit_id, &kind) in self.units.kind.iter().enumerate() {
                let count = completed(unit_id);
                if kind == UnitKind::Worker {
                    workers = workers.saturating_add(count);
                }
                if TOWN_HALLS[unit_id] {
                    town_halls = town_halls.saturating_add(count);
                }
            }
            let (minerals, gas) = self.totals.gathered[slot];
            let (starting_minerals, starting_gas) = self.starting_gathered[slot];
            let army_score = self
                .units
                .army_worth((0..UNIT_TYPE_COUNT).map(completed), Counting::Whole)
                .score;
            let unspent = unsafe { (*game).minerals[slot].saturating_add((*game).gas[slot]) };
            let resources_lost = self
                .units
                .value_of(column(&self.totals.deaths, slot), &NOT_FOUGHT);
            self.snapshots[slot].push(Snapshot {
                workers,
                army_score,
                resources_mined: minerals
                    .saturating_sub(starting_minerals)
                    .saturating_add(gas.saturating_sub(starting_gas)),
                unspent,
                supply: unsafe { Supply::read(game, slot, self.race_of(slot)) },
                actions: self.slot_actions(slot, |activity| activity.actions),
                effective_actions: self.slot_actions(slot, |activity| activity.effective_actions),
                resources_lost,
                // Without the units to look at, every town hall is taken to be a base.
                bases: bases_by_slot.map_or(town_halls, |bases| bases[slot]),
                supply_blocked_frames: self.supply_blocked_frames[slot],
                hatchery_frames: self.scouting.hatchery_frames[slot],
                larva_capped_frames: self.scouting.larva_capped_frames[slot],
            });
        }
    }

    /// Notes where each slot started, who first had a unit near an enemy's starting base, and how
    /// long Zerg Hatcheries held all the larvae they could, from the units the game has at `frame`.
    fn record_scan(&mut self, units: &[SeenUnit], frame: u32) {
        let scouting = &mut *self.scouting;
        let elapsed = scouting
            .last_scan_frame
            .map_or(0, |last| frame.saturating_sub(last))
            .min(MAX_SCAN_GAP);
        scouting.last_scan_frame = Some(frame);

        for unit in units
            .iter()
            .filter(|u| u.working && TOWN_HALLS[u.id.0 as usize])
        {
            let start = &mut scouting.start_bases[unit.slot];
            if start.is_none() {
                *start = Some(unit.position);
            }
        }

        // Without teams, everyone plays for themselves.
        let first_team = self.players.iter().flatten().map(|p| p.team).next();
        let has_teams = self
            .players
            .iter()
            .flatten()
            .any(|p| Some(p.team) != first_team);
        let side = |slot: usize| match &self.players[slot] {
            Some(player) if has_teams => usize::from(player.team),
            _ => slot,
        };
        for slot in (0..PLAYER_COUNT).filter(|&slot| self.following[slot]) {
            if scouting.first_scout_frame[slot].is_some() {
                continue;
            }
            let enemy_bases: Vec<bw::Point> = (0..PLAYER_COUNT)
                .filter(|&other| other != slot && side(other) != side(slot))
                .filter_map(|other| scouting.start_bases[other])
                .collect();
            let scouted = units
                .iter()
                .filter(|u| u.slot == slot && !u.building && u.id != unit::LARVA)
                .any(|u| {
                    enemy_bases
                        .iter()
                        .any(|b| within(&u.position, b, SCOUT_REACH))
                });
            if scouted {
                scouting.first_scout_frame[slot] = Some(frame);
            }
        }

        if elapsed == 0 {
            return;
        }
        for slot in (0..PLAYER_COUNT).filter(|&slot| self.following[slot]) {
            let hatcheries: Vec<bw::Point> = units
                .iter()
                .filter(|u| u.slot == slot && u.working && is_larva_maker(u.id))
                .map(|u| u.position)
                .collect();
            if hatcheries.is_empty() {
                continue;
            }
            let mut larvae = vec![0u32; hatcheries.len()];
            for larva in units
                .iter()
                .filter(|u| u.slot == slot && u.id == unit::LARVA)
            {
                let nearest = hatcheries
                    .iter()
                    .enumerate()
                    .filter(|(_, h)| within(&larva.position, h, LARVA_REACH))
                    .min_by_key(|(_, h)| distance_squared(&larva.position, h));
                if let Some((i, _)) = nearest {
                    larvae[i] += 1;
                }
            }
            let capped = larvae.iter().filter(|&&count| count >= LARVA_CAP).count() as u32;
            let hatchery_frames = &mut scouting.hatchery_frames[slot];
            *hatchery_frames =
                hatchery_frames.saturating_add(elapsed.saturating_mul(hatcheries.len() as u32));
            let capped_frames = &mut scouting.larva_capped_frames[slot];
            *capped_frames = capped_frames.saturating_add(elapsed.saturating_mul(capped));
        }
    }

    /// The race played in a slot.
    fn race_of(&self, slot: usize) -> u8 {
        self.players[slot]
            .as_ref()
            .map_or(u8::MAX, |player| player.race)
    }

    /// A count of actions so far by everyone playing a slot, or `None` for a computer's.
    fn slot_actions(&self, slot: usize, count: fn(&PlayerActivity) -> u32) -> Option<u32> {
        let mut members = (0..PLAYER_COUNT)
            .filter(|&id| self.slot_of[id] == slot)
            .filter_map(|id| self.players[id].as_ref().map(|player| (id, player)))
            .peekable();
        if members.peek().is_none_or(|(_, player)| player.is_computer) {
            return None;
        }
        Some(members.fold(0u32, |total, (id, _)| {
            total.saturating_add(count(&self.activity[id]))
        }))
    }

    /// Whether a slot is still being played: it wasn't defeated, and someone playing it hasn't
    /// left. A winner's slot is still played, since winning doesn't clear anything, and so is a
    /// shared slot whose main player dropped while teammates play on.
    unsafe fn is_still_played(&self, game: *mut bw::Game, slot: usize) -> bool {
        let defeated = unsafe { (*game).victory_state[slot] } == victory_state::DEFEAT;
        !defeated
            && (0..PLAYER_COUNT).any(|id| {
                self.players[id].is_some()
                    && self.slot_of[id] == slot
                    && self.activity[id].left_at_frame.is_none()
            })
    }

    /// Each player's stats, with players sharing a slot still separate.
    fn player_stats(&self, victory_states: &[u8], counts_units: bool) -> Vec<PlayerStats> {
        let totals = &*self.totals;
        self.players
            .iter()
            .enumerate()
            .filter_map(|(id, player)| {
                let player = player.as_ref()?;
                let slot = self.slot_of[id];
                let activity = &self.activity[id];
                let (starting_minerals, starting_gas) = self.starting_gathered[slot];
                let (minerals, gas) = totals.gathered[slot];
                let score = |index: usize| totals.scores[index][slot];
                Some(PlayerStats {
                    id: id as u8,
                    names: vec![player.name.clone()],
                    race: player.race,
                    team: player.team,
                    victory_state: victory_states.get(slot).copied().unwrap_or(0),
                    left_at_frame: activity.left_at_frame,
                    actions: (!player.is_computer).then_some(activity.actions),
                    effective_actions: (!player.is_computer).then_some(activity.effective_actions),
                    produced: counts_units
                        .then(|| unit_counts(column(&*self.produced, slot), &NOT_PRODUCED)),
                    minerals_mined: minerals.saturating_sub(starting_minerals),
                    gas_mined: gas.saturating_sub(starting_gas),
                    unit_score: score(score::UNIT_SCORE),
                    kill_score: score(score::KILL_SCORE),
                    building_score: score(score::BUILDING_SCORE),
                    razing_score: score(score::RAZING_SCORE),
                    kills: counts_units
                        .then(|| unit_counts(column(&totals.kills, slot), &NOT_FOUGHT)),
                    deaths: counts_units
                        .then(|| unit_counts(column(&totals.deaths, slot), &NOT_FOUGHT)),
                    army_produced: counts_units.then(|| {
                        self.units
                            .army_worth(column(&*self.produced, slot), Counting::Added)
                    }),
                    army_killed: counts_units.then(|| {
                        self.units
                            .army_worth(column(&totals.kills, slot), Counting::Whole)
                    }),
                    army_lost: counts_units.then(|| {
                        self.units
                            .army_worth(column(&totals.deaths, slot), Counting::Whole)
                    }),
                    resources_destroyed: counts_units.then(|| {
                        self.units
                            .value_of(column(&totals.kills, slot), &NOT_FOUGHT)
                    }),
                    resources_lost: counts_units.then(|| {
                        self.units
                            .value_of(column(&totals.deaths, slot), &NOT_FOUGHT)
                    }),
                    supply_blocked_frames: counts_units.then_some(self.supply_blocked_frames[slot]),
                    timeline: counts_units.then(|| self.timeline(slot)),
                    build_order: counts_units.then(|| self.build_order(slot)),
                    first_scout_frame: self.scouting.first_scout_frame[slot],
                })
            })
            .collect()
    }
}

impl GameStatsTracker {
    fn timeline(&self, slot: usize) -> Timeline {
        let snapshots = &self.snapshots[slot];
        let each = |value: fn(&Snapshot) -> u32| snapshots.iter().map(value).collect();
        // Supply is shown in whole units, with a half used counting as one.
        Timeline {
            workers: each(|s| s.workers),
            army_score: each(|s| s.army_score),
            resources_mined: each(|s| s.resources_mined),
            unspent: each(|s| s.unspent),
            supply_used: each(|s| s.supply.used.div_ceil(2)),
            supply_available: each(|s| s.supply.available / 2),
            actions: snapshots.iter().map(|s| s.actions).collect(),
            effective_actions: snapshots.iter().map(|s| s.effective_actions).collect(),
            resources_lost: each(|s| s.resources_lost),
            bases: each(|s| s.bases),
            supply_blocked_frames: each(|s| s.supply_blocked_frames),
            hatchery_frames: (self.race_of(slot) == bw::RACE_ZERG)
                .then(|| each(|s| s.hatchery_frames)),
            larva_capped_frames: (self.race_of(slot) == bw::RACE_ZERG)
                .then(|| each(|s| s.larva_capped_frames)),
        }
    }
}

/// Hatcheries, Lairs and Hives, which make larvae.
fn is_larva_maker(id: UnitId) -> bool {
    matches!(id, unit::HATCHERY | unit::LAIR | unit::HIVE)
}

fn distance_squared(a: &bw::Point, b: &bw::Point) -> i32 {
    let dx = i32::from(a.x) - i32::from(b.x);
    let dy = i32::from(a.y) - i32::from(b.y);
    dx * dx + dy * dy
}

fn within(a: &bw::Point, b: &bw::Point, distance: i32) -> bool {
    distance_squared(a, b) <= distance * distance
}

/// The game's units, for larvae and scouting. Hallucinations aren't real units, so they're left
/// out.
unsafe fn list_units_in_game() -> Option<Vec<SeenUnit>> {
    let units = unsafe { get_bw().active_units() }
        .filter(|unit| !unit.is_hallucination() && usize::from(unit.player()) < PLAYER_COUNT)
        .map(|unit| SeenUnit {
            slot: usize::from(unit.player()),
            id: unit.id(),
            position: unit.position(),
            building: unit.is_landed_building() || unit.id().is_building(),
            working: unit.is_completed_or_morphing_to_higher_tier(),
        })
        .collect();
    Some(units)
}

/// Each slot's bases, counted from the game's units: see [`count_bases`].
unsafe fn count_bases_in_game() -> Option<[u32; PLAYER_COUNT]> {
    let mut town_halls = Vec::new();
    let mut minerals = Vec::new();
    for unit in unsafe { get_bw().active_units() } {
        let id = unit.id();
        if matches!(
            id,
            unit::MINERAL_FIELD_1 | unit::MINERAL_FIELD_2 | unit::MINERAL_FIELD_3
        ) {
            minerals.push(unit.position());
        } else if TOWN_HALLS.get(id.0 as usize).copied().unwrap_or(false)
            // A Lair or Hive is still a base while it morphs, and a lifted Command Center isn't.
            && unit.is_completed_or_morphing_to_higher_tier()
            && unit.is_landed_building()
        {
            town_halls.push((unit.player() as usize, unit.position()));
        }
    }
    Some(count_bases(&town_halls, &minerals))
}

/// Each slot's bases, from where its town halls (and which slot owns them) and the mineral fields
/// are. A base is a town hall with minerals left near it, and town halls close together make one
/// base, so a macro Hatchery doesn't count as a base of its own.
fn count_bases(town_halls: &[(usize, bw::Point)], minerals: &[bw::Point]) -> [u32; PLAYER_COUNT] {
    let mut bases: [Vec<bw::Point>; PLAYER_COUNT] = Default::default();
    for (slot, position) in town_halls {
        let Some(slot_bases) = bases.get_mut(*slot) else {
            continue;
        };
        let mining = minerals.iter().any(|m| within(m, position, MINERAL_REACH));
        if mining && !slot_bases.iter().any(|b| within(b, position, BASE_SPREAD)) {
            slot_bases.push(*position);
        }
    }
    std::array::from_fn(|slot| bases[slot].len() as u32)
}

/// The slot each player plays in a game with shared control: their team's main player's.
fn shared_control_slots(
    players: &[Option<StartingPlayer>; PLAYER_COUNT],
    team_main_players: &[u8],
) -> [usize; PLAYER_COUNT] {
    std::array::from_fn(|id| {
        players[id]
            .as_ref()
            // Teams start from 1.
            .and_then(|player| (player.team as usize).checked_sub(1))
            .and_then(|team| team_main_players.get(team))
            .map(|&main_player| main_player as usize)
            .filter(|&main_player| main_player < PLAYER_COUNT)
            .unwrap_or(id)
    })
}

/// One slot's values from a table with a row per unit type.
fn column(table: &[[u32; PLAYER_COUNT]], slot: usize) -> impl Iterator<Item = u32> + '_ {
    table.iter().map(move |row| row[slot])
}

/// Copies the followed slots' values out of one of the game's per player rows.
fn copy_followed(following: &[bool; PLAYER_COUNT], to: &mut [u32; PLAYER_COUNT], from: &PerPlayer) {
    for ((to, &from), &followed) in to.iter_mut().zip(from).zip(following) {
        if followed {
            *to = from;
        }
    }
}

/// How many of a unit type each slot has, counting ones still being made. Sieging changes a tank's
/// unit type, so both modes count as tanks.
unsafe fn all_counts(game: *mut bw::Game, unit_id: usize) -> [u32; PLAYER_COUNT] {
    // The count of everything doesn't include what a slot starts with until the game's first
    // step, while the count of finished units always does.
    let count = |unit_id: usize, slot: usize| unsafe {
        (*game).all_units_count[unit_id][slot].max((*game).completed_units_count[unit_id][slot])
    };
    std::array::from_fn(|slot| {
        let mut total = count(unit_id, slot);
        if unit_id == unit::SIEGE_TANK_TANK.0 as usize {
            total = total.saturating_add(count(unit::SIEGE_TANK_SIEGE.0 as usize, slot));
        }
        total
    })
}

/// Whether the game has counted any of a slot's units as finished.
unsafe fn has_finished_units(game: *mut bw::Game, slot: usize) -> bool {
    unsafe {
        (*game)
            .completed_units_count
            .iter()
            .any(|counts| counts[slot] > 0)
    }
}

/// A slot's minerals and gas on hand.
unsafe fn bank(game: *mut bw::Game, slot: usize) -> Resources {
    unsafe {
        Resources {
            minerals: (*game).minerals[slot],
            gas: (*game).gas[slot],
        }
    }
}

/// A slot's upgrade levels and which techs it has researched.
unsafe fn research(game: *mut bw::Game, slot: usize) -> ([u8; UPGRADE_COUNT], [bool; TECH_COUNT]) {
    let game = unsafe { bw_dat::Game::from_ptr(game) };
    let player = slot as u8;
    (
        std::array::from_fn(|i| game.upgrade_level(player, UpgradeId(i as u16))),
        std::array::from_fn(|i| game.tech_researched(player, TechId(i as u16))),
    )
}

/// How many of a unit type each slot has finished or lost so far. Sieging changes a tank's unit
/// type, so both modes count as tanks.
unsafe fn finished_or_lost(game: *mut bw::Game, unit_id: usize) -> [u32; PLAYER_COUNT] {
    let count = |unit_id: usize, slot: usize| unsafe {
        let finished = (*game).completed_units_count[unit_id][slot];
        finished.saturating_add((*game).deaths[unit_id][slot])
    };
    std::array::from_fn(|slot| {
        let mut total = count(unit_id, slot);
        if unit_id == unit::SIEGE_TANK_TANK.0 as usize {
            total = total.saturating_add(count(unit::SIEGE_TANK_SIEGE.0 as usize, slot));
        }
        total
    })
}

impl PlayerActivity {
    fn record_command(&mut self, command: &[u8], frame: u32) {
        if command.first() == Some(&id::LEAVE_GAME) {
            self.left_at_frame.get_or_insert(frame);
        } else if self.left_at_frame.is_none()
            && let Some(action) = Action::from_command(command, frame)
        {
            self.record(action);
        }
    }

    fn record(&mut self, action: Action) {
        self.actions = self.actions.saturating_add(1);
        if action.is_effective(&self.recent) {
            self.effective_actions = self.effective_actions.saturating_add(1);
        }
        self.recent.push_back(action);
        if self.recent.len() > RECENT_ACTIONS {
            self.recent.pop_front();
        }
    }
}

fn send_once(message: GameThreadMessage) {
    if !REPORTED.swap(true, Ordering::Relaxed) {
        send_game_msg_to_async(message);
    }
}

unsafe fn report() {
    if REPORTED.load(Ordering::Relaxed) {
        return;
    }
    match unsafe { collect() } {
        Some(stats) => send_once(GameThreadMessage::GameStats(stats)),
        None => {
            error!("Couldn't collect game stats, they weren't tracked");
            send_once(GameThreadMessage::GameStatsFailed);
        }
    }
}

unsafe fn collect() -> Option<GameStats> {
    let game = game()?;
    let players = players()?;
    let mut tracker = get_bw().game_stats().lock()?;
    let tracker = tracker.as_mut()?;
    unsafe {
        let frames = (*game).frame_count;
        // Catches anything that changed since the last step, like the local player leaving.
        tracker.update(game, players, frames);
        tracker.take_snapshot(game, frames);
        let counts_units = !game_thread::is_ums();
        let stats = tracker.player_stats(&(*game).victory_state, counts_units);
        let mut stats = merge_shared_control(&tracker.slot_of, stats);

        let reached_end = !game_thread::is_replay_analysis()
            || replay_end_frame().is_some_and(|end_frame| frames >= end_frame);
        if game_thread::is_replay_analysis() && reached_end {
            mark_recorder_left(&mut stats, frames);
        }
        // A replay also stops early when its recorder leaves, since their own leave isn't in it.
        let decided = settle_outcome(&mut stats);
        let complete = decided && reached_end;
        for player in &mut stats {
            player.left_at_frame = player
                .left_at_frame
                .filter(|&frame| frame.saturating_add(LEFT_EARLY_FRAMES) < frames);
        }

        Some(GameStats {
            map_name: map_name(&(*game).map_title),
            frames,
            complete,
            snapshot_frames: tracker.snapshot_frames.clone(),
            players: stats,
        })
    }
}

/// In games with shared control, everyone sharing a slot plays as the player whose slot it is,
/// who owns all of the team's units and score. Each slot is reported as one entry under that
/// player, with every member's actions added together. Without shared control, everyone has their
/// own slot and this changes nothing.
fn merge_shared_control(
    slot_of: &[usize; PLAYER_COUNT],
    players: Vec<PlayerStats>,
) -> Vec<PlayerStats> {
    let slot_of = |player: &PlayerStats| slot_of.get(player.id as usize).copied();
    let (mut merged, teammates): (Vec<_>, Vec<_>) = players
        .into_iter()
        .partition(|player| slot_of(player) == Some(player.id as usize));
    for teammate in teammates {
        let Some(main) = merged
            .iter_mut()
            .find(|p| Some(p.id as usize) == slot_of(&teammate))
        else {
            merged.push(teammate);
            continue;
        };
        main.names.extend(teammate.names);
        main.actions = sum_known(main.actions, teammate.actions);
        main.effective_actions = sum_known(main.effective_actions, teammate.effective_actions);
        // The slot is only left once everyone sharing it has left.
        main.left_at_frame = main
            .left_at_frame
            .zip(teammate.left_at_frame)
            .map(|(a, b)| a.max(b));
    }
    merged
}

fn sum_known(a: Option<u32>, b: Option<u32>) -> Option<u32> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.saturating_add(b)),
        (a, b) => a.or(b),
    }
}

/// Which side a player is on: their team, or in games without teams, just themselves.
fn side_finder(players: &[PlayerStats]) -> impl Fn(&PlayerStats) -> u8 + use<> {
    // Without teams, everyone shares the same one and plays for themselves.
    let first_team = players.first().map(|p| p.team);
    let has_teams = players.iter().any(|p| Some(p.team) != first_team);
    move |player| if has_teams { player.team } else { player.id }
}

fn is_playing(player: &PlayerStats) -> bool {
    player.left_at_frame.is_none() && player.victory_state == victory_state::PLAYING
}

/// A replay stops as soon as the player who recorded it leaves, without recording that they did.
/// When it ends with the game undecided and one side is down to a single player while the rest of
/// their team is out, that player must be the one who recorded it, leaving as the last of their
/// team. They're marked as having left at the end, `end_frame`. With more than one side like that,
/// or none, who recorded it can't be told.
fn mark_recorder_left(players: &mut [PlayerStats], end_frame: u32) {
    let side_of = side_finder(players);
    let mut sides: Vec<u8> = players.iter().map(&side_of).collect();
    sides.sort_unstable();
    sides.dedup();
    let last_ones_standing: Vec<usize> = sides
        .into_iter()
        .filter_map(|side| {
            let mut members = players
                .iter()
                .enumerate()
                .filter(|(_, p)| side_of(p) == side);
            let playing: Vec<usize> = members
                .clone()
                .filter(|(_, p)| is_playing(p))
                .map(|(i, _)| i)
                .collect();
            let anyone_out = members.any(|(_, p)| !is_playing(p));
            (anyone_out && playing.len() == 1).then(|| playing[0])
        })
        .collect();
    if let [recorder] = last_ones_standing[..] {
        players[recorder].left_at_frame = Some(end_frame);
    }
}

/// Returns whether the game was decided, with nobody still playing except at most one side, which
/// covers this client leaving a game that was already won or lost as well as the game ending.
///
/// Once only one side is left, it has won and everyone else has lost, even if the game hasn't said
/// so yet. It only declares winners when it next checks, which a game can end before for this
/// client, like when they're the last of the losers to leave. Their replay stops right there too.
fn settle_outcome(players: &mut [PlayerStats]) -> bool {
    let side_of = side_finder(players);

    if players
        .iter()
        .any(|p| p.victory_state == victory_state::VICTORY)
    {
        // The game already declared who won, which a player who left moments before doesn't
        // change.
        return true;
    }
    let mut playing_sides = players.iter().filter(|p| is_playing(p)).map(&side_of);
    let Some(remaining) = playing_sides.next() else {
        return true;
    };
    if !playing_sides.all(|side| side == remaining) {
        return false;
    }
    if players.iter().all(|p| side_of(p) == remaining) {
        // Nobody was ever playing against them.
        return true;
    }

    for player in players.iter_mut() {
        player.victory_state =
            if side_of(player) == remaining && player.victory_state != victory_state::DEFEAT {
                victory_state::VICTORY
            } else {
                victory_state::DEFEAT
            };
    }
    true
}

fn map_name(title: &[u8]) -> String {
    let length = title.iter().position(|&c| c == 0).unwrap_or(title.len());
    String::from_utf8_lossy(&title[..length])
        .chars()
        // Map titles use control characters to switch text colors.
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

/// A slot's total minerals and gas gathered so far, including what it started with.
unsafe fn gathered(game: *mut bw::Game, slot: usize) -> (u32, u32) {
    // `dc60` is each slot's total gas gathered, followed by its total minerals gathered.
    let totals: &[u8; 0x60] = unsafe { &(*game).dc60 };
    let read = |offset: usize| {
        let start = offset + slot * 4;
        match totals.get(start..start + 4) {
            Some(&[a, b, c, d]) => u32::from_le_bytes([a, b, c, d]),
            _ => 0,
        }
    };
    (read(0x30), read(0))
}

/// Unit id and count for each nonzero count in `counts` (indexed by unit id), leaving out the
/// unit types in `left_out`.
fn unit_counts(
    counts: impl IntoIterator<Item = u32>,
    left_out: &[bool; UNIT_TYPE_COUNT],
) -> Vec<(u16, u32)> {
    counts
        .into_iter()
        .zip(left_out)
        .enumerate()
        .filter(|&(_, (count, &left_out))| count != 0 && !left_out)
        .map(|(unit_id, (count, _))| (unit_id as u16, count))
        .collect()
}

/// The parts of a command that matter for deciding whether it was an effective action.
#[derive(Copy, Clone)]
struct Action {
    frame: u32,
    kind: ActionKind,
    order: Option<u8>,
    hotkey: Option<Hotkey>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ActionKind {
    Command(u8),
    /// A building landing, which is sent as a build command with the land order.
    Land,
}

use ActionKind::Command;

#[derive(Copy, Clone, PartialEq, Eq)]
struct Hotkey {
    kind: u8,
    group: u8,
}

/// The hotkey command's kind for recalling a group, rather than assigning or adding to one.
const HOTKEY_SELECT: u8 = 1;

/// Orders that do nothing new when repeated right away: stopping, holding position, attacking,
/// moving and setting a rally point.
fn is_order_repeated_for_nothing(order_id: u8) -> bool {
    [
        order::STOP,
        order::REAVER_STOP,
        order::CARRIER_STOP,
        order::HOLD_POSITION,
        order::CARRIER_HOLD_POSITION,
        order::REAVER_HOLD_POSITION,
        order::QUEEN_HOLD_POSITION,
        order::MEDIC_HOLD_POSITION,
        order::ATTACK,
        order::ATTACK_OBSCURED,
        order::ATTACK_UNIT,
        order::ATTACK_FIXED_RANGE,
        order::ATTACK_MOVE,
        order::CARRIER_ATTACK,
        order::REAVER_ATTACK,
        order::MOVE,
        order::RALLY_UNIT,
        order::RALLY_POS,
    ]
    .iter()
    .any(|order| order.0 == order_id)
}

impl Action {
    fn from_command(command: &[u8], frame: u32) -> Option<Action> {
        if !commands::is_game_action(command) || command.first() == Some(&id::LEAVE_GAME) {
            return None;
        }
        let command_id = *command.first()?;
        let order = match command_id {
            id::BUILD => command.get(1).copied(),
            id::TARGETED_ORDER => command.get(9).copied(),
            id::TARGETED_ORDER_121 => command.get(11).copied(),
            _ => None,
        };
        let kind = if command_id == id::BUILD && order == Some(order::BUILDING_LAND.0) {
            ActionKind::Land
        } else {
            Command(command_id)
        };
        let hotkey = match (command_id, command.get(1), command.get(2)) {
            (id::HOTKEY, Some(&hotkey_kind), Some(&group)) => Some(Hotkey {
                kind: hotkey_kind,
                group,
            }),
            _ => None,
        };
        Some(Action {
            frame,
            kind,
            order,
            hotkey,
        })
    }

    fn changes_selection(&self) -> bool {
        matches!(
            self.kind,
            Command(
                id::SELECT
                    | id::SELECT_ADD
                    | id::SELECT_REMOVE
                    | id::SELECT_121
                    | id::SELECT_ADD_121
                    | id::SELECT_REMOVE_121
            )
        ) || self.hotkey.is_some_and(|h| h.kind == HOTKEY_SELECT)
    }

    /// Whether this action did something, given the same player's actions before it (oldest
    /// first). An action counts unless it's shown to have been wasted: queueing past a full
    /// production queue, canceling right away, repeating an order before it could matter,
    /// switching selections too fast to have looked at them, or repeating a command that can only
    /// take effect once.
    ///
    /// These rules and their frame windows follow the EAPM algorithm from screp
    /// (https://github.com/icza/screp, Apache 2.0). Unlike screp, chat isn't counted as an action
    /// here, so it never sits between two actions it would otherwise compare.
    fn is_effective(&self, previous: &VecDeque<Action>) -> bool {
        let Some(prev) = previous.back() else {
            return true;
        };

        if matches!(
            self.kind,
            Command(id::TRAIN | id::TRAIN_FIGHTER | id::CANCEL_TRAIN)
        ) {
            // A production queue holds 5 units, so a sixth identical order within about a second
            // on the same selection can't do anything.
            let mut same = 1;
            for action in previous.iter().rev() {
                if action.frame.saturating_add(25) < self.frame || action.changes_selection() {
                    break;
                }
                if action.kind == self.kind {
                    same += 1;
                }
            }
            if same >= 6 {
                return false;
            }
        }

        let frames_since = self.frame.saturating_sub(prev.frame);
        let canceled = matches!(
            (prev.kind, self.kind),
            (
                Command(id::TRAIN | id::TRAIN_FIGHTER),
                Command(id::CANCEL_TRAIN)
            ) | (
                Command(id::UNIT_MORPH | id::BUILDING_MORPH),
                Command(id::CANCEL_MORPH)
            ) | (Command(id::UPGRADE), Command(id::CANCEL_UPGRADE))
                | (Command(id::TECH), Command(id::CANCEL_TECH))
        );
        if frames_since <= 20 && canceled {
            return false;
        }

        if frames_since <= 10 && self.kind == prev.kind {
            match self.kind {
                Command(id::STOP | id::HOLD_POSITION) | ActionKind::Land => return false,
                Command(id::TARGETED_ORDER | id::TARGETED_ORDER_121)
                    if self.order == prev.order
                        && self.order.is_some_and(is_order_repeated_for_nothing) =>
                {
                    return false;
                }
                _ => {}
            }
        }

        if frames_since <= 8 && self.changes_selection() && prev.changes_selection() {
            let adds_or_removes = matches!(
                self.kind,
                Command(
                    id::SELECT_ADD | id::SELECT_REMOVE | id::SELECT_ADD_121 | id::SELECT_REMOVE_121
                )
            );
            // Double tapping a hotkey centers the screen on its group, so only a third tap is
            // wasted.
            let same_hotkey = self.hotkey.is_some() && self.hotkey == prev.hotkey;
            if same_hotkey {
                let tapped_before = previous.iter().rev().nth(1).is_some_and(|before| {
                    before.hotkey == self.hotkey && before.frame.saturating_add(8) >= prev.frame
                });
                if tapped_before {
                    return false;
                }
            } else if !adds_or_removes {
                return false;
            }
        }

        if self.kind == prev.kind {
            match self.kind {
                Command(
                    id::UNIT_MORPH
                    | id::BUILDING_MORPH
                    | id::UPGRADE
                    | id::MERGE_ARCHON
                    | id::MERGE_DARK_ARCHON
                    | id::LIFT_OFF
                    | id::CANCEL_ADDON
                    | id::CANCEL_BUILD
                    | id::CANCEL_MORPH
                    | id::CANCEL_NUKE
                    | id::CANCEL_TECH
                    | id::CANCEL_UPGRADE,
                ) => return false,
                // Protoss can warp in several buildings with one probe, so only other races'
                // repeated builds are wasted.
                Command(id::BUILD) if self.order != Some(order::PROBE_BUILD.0) => return false,
                _ => {}
            }
        }

        if let Some(hotkey) = self.hotkey
            && hotkey.kind != HOTKEY_SELECT
            && prev.hotkey == Some(hotkey)
        {
            // Assigning or adding to the same group twice in a row does nothing the second time.
            return false;
        }

        true
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn action(frame: u32, command: &[u8]) -> Action {
        Action::from_command(command, frame).unwrap()
    }

    fn effective(history: &[Action], next: Action) -> bool {
        next.is_effective(&history.iter().copied().collect())
    }

    fn player(id: u8, team: u8, name: &str) -> PlayerStats {
        PlayerStats {
            id,
            names: vec![name.into()],
            race: 1,
            team,
            victory_state: victory_state::PLAYING,
            left_at_frame: None,
            actions: Some(100),
            effective_actions: Some(80),
            produced: Some(vec![]),
            minerals_mined: 0,
            gas_mined: 0,
            unit_score: 0,
            kill_score: 0,
            building_score: 0,
            razing_score: 0,
            kills: Some(vec![]),
            deaths: Some(vec![]),
            army_produced: None,
            army_killed: None,
            army_lost: None,
            resources_destroyed: Some(0),
            resources_lost: Some(0),
            supply_blocked_frames: Some(0),
            timeline: None,
            build_order: None,
            first_scout_frame: None,
        }
    }

    #[test]
    fn first_action_is_effective() {
        assert!(effective(&[], action(10, &[0x1a, 0])));
    }

    #[test]
    fn network_upkeep_chat_and_leaving_are_not_actions() {
        assert!(Action::from_command(&[id::SYNC, 0, 0, 0, 0, 0, 0], 0).is_none());
        assert!(Action::from_command(&[id::CHAT, 0], 0).is_none());
        assert!(Action::from_command(&[id::LEAVE_GAME, 0], 0).is_none());
        assert!(Action::from_command(&[], 0).is_none());
    }

    #[test]
    fn fast_repeated_stop_is_wasted() {
        let stop = [0x1a, 0];
        assert!(!effective(&[action(10, &stop)], action(15, &stop)));
        assert!(effective(&[action(10, &stop)], action(30, &stop)));
    }

    #[test]
    fn fast_repeated_move_is_wasted_but_a_spell_is_not() {
        let mut move_order = [0u8; 11];
        move_order[0] = 0x15;
        move_order[9] = order::MOVE.0;
        let mut storm = move_order;
        storm[9] = 0x8e;
        assert!(!effective(
            &[action(10, &move_order)],
            action(15, &move_order)
        ));
        assert!(effective(&[action(10, &storm)], action(15, &storm)));
    }

    #[test]
    fn one_to_one_twenty_one_orders_read_their_order_further_in() {
        let mut move_order = [0u8; 13];
        move_order[0] = 0x61;
        move_order[11] = order::MOVE.0;
        assert_eq!(action(10, &move_order).order, Some(order::MOVE.0));
        assert!(!effective(
            &[action(10, &move_order)],
            action(15, &move_order)
        ));
    }

    #[test]
    fn fast_cancel_is_wasted() {
        let train = [0x1f, 0x41, 0];
        let cancel = [0x20, 0, 0];
        assert!(!effective(&[action(10, &train)], action(20, &cancel)));
        assert!(effective(&[action(10, &train)], action(40, &cancel)));
    }

    #[test]
    fn fast_canceled_morph_is_wasted() {
        let morph = [0x23, 0x67, 0];
        let cancel = [0x19];
        assert!(!effective(&[action(10, &morph)], action(25, &cancel)));
    }

    #[test]
    fn sixth_queued_unit_is_wasted() {
        let train = [0x1f, 0x41, 0];
        let five: Vec<_> = (0..5).map(|i| action(10 + i, &train)).collect();
        assert!(effective(&five[..4], action(14, &train)));
        assert!(!effective(&five, action(15, &train)));
    }

    #[test]
    fn queue_count_restarts_on_a_new_selection() {
        let train = [0x1f, 0x41, 0];
        let mut history: Vec<_> = (0..5).map(|i| action(10 + i, &train)).collect();
        history.push(action(15, &[0x09, 1, 0, 0]));
        assert!(effective(&history, action(16, &train)));
    }

    #[test]
    fn queue_count_only_looks_back_about_a_second() {
        let train = [0x1f, 0x41, 0];
        let five: Vec<_> = (0..5).map(|i| action(10 + i, &train)).collect();
        assert!(effective(&five, action(40, &train)));
    }

    #[test]
    fn fast_repeated_landing_is_wasted() {
        let land = [0x0c, order::BUILDING_LAND.0, 0, 0, 0, 0, 0x6f, 0];
        assert!(action(10, &land).kind == ActionKind::Land);
        assert!(!effective(&[action(10, &land)], action(15, &land)));
        assert!(effective(&[action(10, &land)], action(30, &land)));
    }

    #[test]
    fn hotkey_double_tap_is_effective_but_triple_is_not() {
        let select_1 = [0x13, 1, 1];
        assert!(effective(&[action(10, &select_1)], action(14, &select_1)));
        assert!(!effective(
            &[action(10, &select_1), action(14, &select_1)],
            action(18, &select_1)
        ));
    }

    #[test]
    fn a_tap_after_a_pause_starts_a_new_double_tap() {
        let select_1 = [0x13, 1, 1];
        assert!(effective(
            &[action(10, &select_1), action(30, &select_1)],
            action(34, &select_1)
        ));
    }

    #[test]
    fn flipping_between_hotkey_groups_too_fast_is_wasted() {
        assert!(!effective(
            &[action(10, &[0x13, 1, 1])],
            action(14, &[0x13, 1, 2])
        ));
    }

    #[test]
    fn fast_reselection_is_wasted_but_shift_selection_is_not() {
        let select = [0x09, 1, 0, 0];
        let select_add = [0x0a, 1, 0, 0];
        assert!(!effective(&[action(10, &select)], action(14, &select)));
        assert!(effective(&[action(10, &select)], action(14, &select_add)));
    }

    #[test]
    fn repeated_hotkey_assign_is_wasted() {
        let assign_2 = [0x13, 0, 2];
        assert!(!effective(&[action(10, &assign_2)], action(200, &assign_2)));
    }

    #[test]
    fn protoss_can_place_several_buildings_in_a_row() {
        let protoss_build = [0x0c, 0x1f, 0, 0, 0, 0, 0x9c, 0];
        let terran_build = [0x0c, 0x1e, 0, 0, 0, 0, 0x6d, 0];
        assert!(effective(
            &[action(10, &protoss_build)],
            action(100, &protoss_build)
        ));
        assert!(!effective(
            &[action(10, &terran_build)],
            action(100, &terran_build)
        ));
    }

    #[test]
    fn earlier_frame_than_the_last_action_does_not_underflow() {
        let stop = [0x1a, 0];
        assert!(!effective(&[action(100, &stop)], action(50, &stop)));
    }

    #[test]
    fn truncated_commands_are_still_classified() {
        assert!(Action::from_command(&[0x15], 0).is_some_and(|a| a.order.is_none()));
        assert!(Action::from_command(&[0x13, 1], 0).is_some_and(|a| a.hotkey.is_none()));
    }

    #[test]
    fn leaving_stops_counting_actions() {
        let mut activity = PlayerActivity::default();
        activity.record_command(&[0x1a, 0], 10);
        activity.record_command(&[id::LEAVE_GAME, 0], 20);
        activity.record_command(&[0x1a, 0], 30);
        activity.record_command(&[id::LEAVE_GAME, 0], 40);
        assert_eq!(activity.actions, 1);
        assert_eq!(activity.left_at_frame, Some(20));
    }

    #[test]
    fn map_name_drops_color_codes() {
        let mut title = [0u8; 0x20];
        title[..9].copy_from_slice(b"\x03Big Hunt");
        assert_eq!(map_name(&title), "Big Hunt");
    }

    #[test]
    fn unit_counts_leave_out_empty_counts_and_the_given_types() {
        let mut counts = [0u32; UNIT_TYPE_COUNT];
        counts[0] = 3;
        counts[unit::SPIDER_MINE.0 as usize] = 40;
        counts[unit::INTERCEPTOR.0 as usize] = 8;
        assert_eq!(
            unit_counts(counts, &NOT_FOUGHT),
            vec![(0, 3), (unit::INTERCEPTOR.0, 8)]
        );
        assert_eq!(unit_counts(counts, &NOT_PRODUCED), vec![(0, 3)]);
    }

    #[test]
    fn units_that_die_by_being_used_up_are_not_listed_as_fought() {
        assert!(NOT_FOUGHT[unit::SPIDER_MINE.0 as usize]);
        assert!(NOT_FOUGHT[unit::NUCLEAR_MISSILE.0 as usize]);
        assert!(!NOT_FOUGHT[unit::LARVA.0 as usize]);
        assert!(NOT_PRODUCED[unit::LARVA.0 as usize]);
        assert!(!NOT_PRODUCED[unit::NUCLEAR_MISSILE.0 as usize]);
        assert!(!NOT_PRODUCED[unit::SIEGE_TANK_TANK.0 as usize]);
    }

    #[test]
    fn known_counts_add_up_and_missing_ones_stay_missing() {
        assert_eq!(sum_known(Some(2), Some(3)), Some(5));
        assert_eq!(sum_known(None, Some(3)), Some(3));
        assert_eq!(sum_known(None, None), None);
    }

    fn slots(pairs: &[(usize, usize)]) -> [usize; PLAYER_COUNT] {
        let mut slot_of = std::array::from_fn(|id| id);
        for &(id, slot) in pairs {
            slot_of[id] = slot;
        }
        slot_of
    }

    #[test]
    fn shared_control_teams_merge_under_their_main_player() {
        let mut left = player(0, 1, "Flash");
        left.left_at_frame = Some(500);
        let mut main = player(2, 1, "Jaedong");
        main.unit_score = 4000;
        let merged =
            merge_shared_control(&slots(&[(0, 2)]), vec![left, player(1, 2, "Bisu"), main]);

        assert_eq!(merged.len(), 2);
        let team_1 = merged.iter().find(|p| p.id == 2).unwrap();
        assert_eq!(team_1.names, ["Jaedong", "Flash"]);
        assert_eq!(team_1.actions, Some(200));
        assert_eq!(team_1.unit_score, 4000);
        // Jaedong never left, so the shared slot was still played until the end.
        assert_eq!(team_1.left_at_frame, None);
        assert_eq!(merged.iter().find(|p| p.id == 1).unwrap().names, ["Bisu"]);
    }

    #[test]
    fn a_team_is_only_gone_once_all_three_members_left() {
        let mut members = vec![
            player(3, 1, "Stork"),
            player(4, 1, "Kal"),
            player(5, 1, "Best"),
        ];
        members[0].left_at_frame = Some(700);
        members[1].left_at_frame = Some(900);
        members[2].left_at_frame = Some(800);
        let merged = merge_shared_control(&slots(&[(4, 3), (5, 3)]), members);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].names, ["Stork", "Kal", "Best"]);
        assert_eq!(merged[0].actions, Some(300));
        assert_eq!(merged[0].left_at_frame, Some(900));
    }

    #[test]
    fn players_with_their_own_slots_are_left_alone_when_merging() {
        let merged = merge_shared_control(&slots(&[]), vec![player(3, 0, "Stork")]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].names, ["Stork"]);
    }

    fn outcomes(players: &[PlayerStats]) -> Vec<u8> {
        players.iter().map(|p| p.victory_state).collect()
    }

    #[test]
    fn a_game_that_ended_normally_keeps_its_outcome() {
        let mut won = player(0, 0, "Flash");
        won.victory_state = victory_state::VICTORY;
        let mut lost = player(1, 0, "Jaedong");
        lost.victory_state = victory_state::DEFEAT;
        let mut players = [won, lost];

        assert!(settle_outcome(&mut players));
        assert_eq!(outcomes(&players), [3, 2]);
    }

    #[test]
    fn whoever_is_left_after_the_others_leave_has_won() {
        let mut left = player(0, 0, "Flash");
        left.left_at_frame = Some(100);
        let mut players = [left, player(1, 0, "Jaedong")];

        assert!(settle_outcome(&mut players));
        assert_eq!(outcomes(&players), [2, 3]);
    }

    #[test]
    fn a_free_for_all_with_two_still_fighting_is_undecided() {
        let mut left = player(0, 0, "Flash");
        left.left_at_frame = Some(100);
        let mut players = [left, player(1, 0, "Jaedong"), player(2, 0, "Bisu")];

        assert!(!settle_outcome(&mut players));
        assert_eq!(outcomes(&players), [0, 0, 0]);
    }

    #[test]
    fn a_team_still_playing_wins_once_the_other_team_is_gone() {
        // Flash left before the end, but his team played on and won.
        let mut flash = player(0, 1, "Flash");
        flash.left_at_frame = Some(100);
        let mut bisu = player(2, 2, "Bisu");
        bisu.victory_state = victory_state::DEFEAT;
        let mut stork = player(3, 2, "Stork");
        stork.left_at_frame = Some(9000);
        let mut players = [flash, player(1, 1, "Jaedong"), bisu, stork];
        assert!(settle_outcome(&mut players));
        assert_eq!(outcomes(&players), [3, 3, 2, 2]);

        let mut players = [player(0, 1, "Flash"), player(2, 2, "Bisu")];
        assert!(!settle_outcome(&mut players));
    }

    #[test]
    fn a_game_with_nobody_to_play_against_has_nothing_to_settle() {
        let mut players = [player(0, 0, "Flash")];
        assert!(settle_outcome(&mut players));
        assert_eq!(outcomes(&players), [0]);
        assert!(settle_outcome(&mut []));
    }

    /// A game with every value zeroed, which is what the game holds before it starts.
    struct TestGame {
        game: Box<bw::Game>,
        players: Box<[bw::Player; 12]>,
    }

    impl TestGame {
        /// `players` is each player's type and team.
        fn new(players: &[(u8, u8)]) -> TestGame {
            // Both are plain data, so all zeroes is a valid value.
            let mut game = TestGame {
                game: unsafe { Box::<bw::Game>::new_zeroed().assume_init() },
                players: unsafe { Box::<[bw::Player; 12]>::new_zeroed().assume_init() },
            };
            for (id, &(player_type, team)) in players.iter().enumerate() {
                let player = &mut game.players[id];
                player.player_type = player_type;
                player.team = team;
                player.name[0] = b'a' + id as u8;
            }
            game
        }

        fn start(&mut self, is_team_game: bool) -> GameStatsTracker {
            unsafe {
                GameStatsTracker::new(
                    &mut *self.game,
                    self.players.as_mut_ptr(),
                    is_team_game,
                    test_catalog(),
                    no_units,
                    no_seen_units,
                )
            }
        }

        fn step_to(&mut self, tracker: &mut GameStatsTracker, frame: u32) {
            self.game.frame_count = frame - 1;
            self.step(tracker);
        }

        fn step(&mut self, tracker: &mut GameStatsTracker) {
            self.game.frame_count += 1;
            let frame = self.game.frame_count;
            unsafe { tracker.update(&mut *self.game, self.players.as_mut_ptr(), frame) };
        }

        fn set_completed(&mut self, unit_id: UnitId, slot: usize, count: u32) {
            self.game.completed_units_count[unit_id.0 as usize][slot] = count;
        }

        /// Gives a slot a unit it starts with, since slots only start being counted once they
        /// have one.
        fn give_starting_unit(&mut self, slot: usize) {
            self.set_completed(unit::OVERLORD, slot, 1);
        }

        fn set_minerals_gathered(&mut self, slot: usize, minerals: u32) {
            let start = 0x30 + slot * 4;
            self.game.dc60[start..start + 4].copy_from_slice(&minerals.to_le_bytes());
        }
    }

    /// The test games have no units to look through.
    unsafe fn no_units() -> Option<[u32; PLAYER_COUNT]> {
        None
    }

    unsafe fn no_seen_units() -> Option<Vec<SeenUnit>> {
        None
    }

    /// Workers, some army and an Overlord, at what the game lists them as costing.
    fn test_catalog() -> UnitCatalog {
        let mut kind = [UnitKind::Other; UNIT_TYPE_COUNT];
        let mut listed = [(Resources::default(), 0); UNIT_TYPE_COUNT];
        for (id, unit_kind, minerals, gas, score) in [
            (unit::SCV, UnitKind::Worker, 50, 0, 50),
            (unit::DRONE, UnitKind::Worker, 50, 0, 50),
            (unit::MARINE, UnitKind::Army, 50, 0, 50),
            (unit::OVERLORD, UnitKind::Other, 100, 0, 100),
            (unit::ZERGLING, UnitKind::Army, 50, 0, 25),
            (unit::SCOURGE, UnitKind::Army, 25, 75, 100),
            (unit::HYDRALISK, UnitKind::Army, 75, 25, 125),
            (unit::LURKER, UnitKind::Army, 50, 100, 250),
            (unit::HIGH_TEMPLAR, UnitKind::Army, 50, 150, 350),
            (unit::ARCHON, UnitKind::Army, 0, 0, 0),
            (unit::SPAWNING_POOL, UnitKind::Other, 200, 0, 0),
            (unit::HATCHERY, UnitKind::Other, 300, 0, 0),
            (unit::LAIR, UnitKind::Other, 150, 100, 0),
        ] {
            kind[id.0 as usize] = unit_kind;
            listed[id.0 as usize] = (Resources { minerals, gas }, score);
        }
        let mut catalog = UnitCatalog::new(kind, listed);
        for building in [
            unit::HATCHERY,
            unit::LAIR,
            unit::SPAWNING_POOL,
            unit::COMMAND_CENTER,
        ] {
            catalog.building[building.0 as usize] = true;
        }
        catalog.research.upgrades[upgrade::METABOLIC_BOOST.0 as usize] = (1500, 0);
        catalog.research.upgrades[upgrade::ZERG_MELEE_ATTACKS.0 as usize] = (4000, 480);
        catalog.research.techs[tech::BURROWING.0 as usize] = 1200;
        catalog
    }

    fn produced(tracker: &GameStatsTracker, slot: usize, unit_id: UnitId) -> u32 {
        tracker.produced[unit_id.0 as usize][slot]
    }

    #[test]
    fn production_counts_new_units_but_not_starting_ones() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        game.set_completed(unit::SCV, 0, 4);
        let mut tracker = game.start(false);
        game.set_completed(unit::SCV, 0, 6);
        game.step(&mut tracker);
        assert_eq!(produced(&tracker, 0, unit::SCV), 2);

        // An SCV that dies is still one that was produced.
        game.set_completed(unit::SCV, 0, 5);
        game.game.deaths[unit::SCV.0 as usize][0] = 1;
        game.step(&mut tracker);
        assert_eq!(produced(&tracker, 0, unit::SCV), 2);
    }

    #[test]
    fn sieging_a_tank_isnt_producing_another() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        game.give_starting_unit(0);
        let mut tracker = game.start(false);
        game.set_completed(unit::SIEGE_TANK_TANK, 0, 1);
        game.step(&mut tracker);
        game.set_completed(unit::SIEGE_TANK_TANK, 0, 0);
        game.set_completed(unit::SIEGE_TANK_SIEGE, 0, 1);
        game.step(&mut tracker);
        assert_eq!(produced(&tracker, 0, unit::SIEGE_TANK_TANK), 1);
        assert_eq!(produced(&tracker, 0, unit::SIEGE_TANK_SIEGE), 0);
    }

    #[test]
    fn morphing_away_a_unit_doesnt_undo_its_production() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        game.give_starting_unit(0);
        let mut tracker = game.start(false);
        game.set_completed(unit::DRONE, 0, 2);
        game.step(&mut tracker);
        game.set_completed(unit::DRONE, 0, 1);
        game.set_completed(unit::SPAWNING_POOL, 0, 1);
        game.step(&mut tracker);
        game.set_completed(unit::DRONE, 0, 2);
        game.step(&mut tracker);
        assert_eq!(produced(&tracker, 0, unit::DRONE), 3);
        assert_eq!(produced(&tracker, 0, unit::SPAWNING_POOL), 1);
    }

    #[test]
    fn a_player_who_left_keeps_their_totals_from_before_they_left() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_HUMAN, 0)]);
        game.set_minerals_gathered(1, 50);
        let mut tracker = game.start(false);
        game.game.unit_kills[unit::MARINE.0 as usize][1] = 3;
        game.set_minerals_gathered(1, 550);
        game.step(&mut tracker);

        tracker.activity[1].record_command(&[id::LEAVE_GAME, 0], game.game.frame_count + 1);
        game.game.unit_kills[unit::MARINE.0 as usize][1] = 0;
        game.set_minerals_gathered(1, 0);
        game.players[1].player_type = bw::PLAYER_TYPE_NONE;
        game.step(&mut tracker);

        let stats = tracker.player_stats(&game.game.victory_state, true);
        let left = &stats[1];
        assert_eq!(left.left_at_frame, Some(2));
        assert_eq!(left.kills, Some(vec![(unit::MARINE.0, 3)]));
        assert_eq!(left.minerals_mined, 500);
    }

    #[test]
    fn a_dropped_player_counts_as_having_left() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_HUMAN, 0)]);
        let mut tracker = game.start(false);
        game.players[1].player_type = bw::PLAYER_TYPE_NONE;
        game.step(&mut tracker);
        assert_eq!(tracker.activity[1].left_at_frame, Some(1));
        assert!(!tracker.following[1]);
        assert!(tracker.following[0]);
    }

    #[test]
    fn a_defeated_player_keeps_their_totals_from_before_their_defeat() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_HUMAN, 0)]);
        let mut tracker = game.start(false);
        game.game.scores[score::UNIT_SCORE][0] = 1200;
        game.step(&mut tracker);
        game.game.victory_state[0] = 2;
        game.game.scores[score::UNIT_SCORE][0] = 0;
        game.step(&mut tracker);
        let stats = tracker.player_stats(&game.game.victory_state, true);
        assert_eq!(stats[0].unit_score, 1200);
    }

    #[test]
    fn a_shared_slot_keeps_going_after_its_main_player_leaves() {
        // Players 0 and 1 share player 1's slot.
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 1), (bw::PLAYER_TYPE_HUMAN, 1)]);
        game.game.team_game_main_player[0] = 1;
        let mut tracker = game.start(true);
        tracker.activity[1].record_command(&[id::LEAVE_GAME, 0], 1);
        game.game.unit_kills[unit::ZERGLING.0 as usize][1] = 7;
        game.step(&mut tracker);
        assert!(tracker.following[1]);

        let stats = merge_shared_control(
            &tracker.slot_of,
            tracker.player_stats(&game.game.victory_state, true),
        );
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].names, ["b", "a"]);
        assert_eq!(stats[0].kills, Some(vec![(unit::ZERGLING.0, 7)]));
        assert_eq!(stats[0].left_at_frame, None);
    }

    #[test]
    fn computers_have_no_action_counts() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_COMPUTER, 0)]);
        let tracker = game.start(false);
        let stats = tracker.player_stats(&game.game.victory_state, true);
        assert_eq!(stats[0].actions, Some(0));
        assert_eq!(stats[1].actions, None);
        assert_eq!(stats[1].effective_actions, None);
    }

    #[test]
    fn unit_lists_are_left_out_where_they_mean_nothing() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        let tracker = game.start(false);
        let stats = tracker.player_stats(&game.game.victory_state, false);
        assert!(stats[0].produced.is_none());
        assert!(stats[0].kills.is_none());
        assert!(stats[0].deaths.is_none());
    }

    #[test]
    fn empty_and_observer_slots_are_not_players() {
        let mut game = TestGame::new(&[
            (bw::PLAYER_TYPE_HUMAN, 0),
            (bw::PLAYER_TYPE_OPEN, 0),
            (bw::PLAYER_TYPE_OBSERVER, 0),
        ]);
        let tracker = game.start(false);
        let stats = tracker.player_stats(&game.game.victory_state, true);
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].names, ["a"]);
    }

    fn worth(catalog: &UnitCatalog, units: &[(UnitId, u32)], counting: Counting) -> Worth {
        let mut counts = [0; UNIT_TYPE_COUNT];
        for &(id, count) in units {
            counts[id.0 as usize] = count;
        }
        catalog.worth_of(counts, |_| true, counting)
    }

    #[test]
    fn units_are_worth_what_they_were_made_from() {
        let catalog = test_catalog();
        let whole = |id: UnitId, count: u32| {
            let worth = worth(&catalog, &[(id, count)], Counting::Whole);
            (worth.score, worth.minerals, worth.gas)
        };
        assert_eq!(whole(unit::ZERGLING, 1), (25, 25, 0));
        // Scourge come in pairs too, and an odd one out isn't lost to rounding twice.
        assert_eq!(whole(unit::SCOURGE, 3), (300, 37, 112));
        assert_eq!(whole(unit::LURKER, 1), (375, 125, 125));
        assert_eq!(whole(unit::ARCHON, 1), (700, 100, 300));
    }

    #[test]
    fn producing_a_unit_and_what_it_was_made_from_isnt_counted_twice() {
        let catalog = test_catalog();
        // A Hydralisk morphed into a Lurker, and two Templar merged into an Archon.
        let made = [
            (unit::HYDRALISK, 1),
            (unit::LURKER, 1),
            (unit::HIGH_TEMPLAR, 2),
            (unit::ARCHON, 1),
        ];
        let standing = [(unit::LURKER, 1), (unit::ARCHON, 1)];
        assert_eq!(
            worth(&catalog, &made, Counting::Added),
            worth(&catalog, &standing, Counting::Whole),
        );
    }

    #[test]
    fn army_value_leaves_out_workers_and_overlords() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        game.give_starting_unit(0);
        let mut tracker = game.start(false);
        game.set_completed(unit::MARINE, 0, 2);
        game.set_completed(unit::SCV, 0, 3);
        game.game.unit_kills[unit::HYDRALISK.0 as usize][0] = 2;
        game.game.unit_kills[unit::DRONE.0 as usize][0] = 4;
        game.game.deaths[unit::MARINE.0 as usize][0] = 1;
        game.game.deaths[unit::SCV.0 as usize][0] = 1;
        game.step(&mut tracker);

        let stats = tracker.player_stats(&game.game.victory_state, true);
        let worth = |score, minerals, gas| {
            Some(Worth {
                score,
                minerals,
                gas,
            })
        };
        // The Marine that died was produced too.
        assert_eq!(stats[0].army_produced, worth(150, 150, 0));
        assert_eq!(stats[0].army_killed, worth(250, 150, 50));
        assert_eq!(stats[0].army_lost, worth(50, 50, 0));
    }

    #[test]
    fn resources_destroyed_and_lost_add_up_what_the_units_were_worth() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_HUMAN, 0)]);
        let mut tracker = game.start(false);
        game.game.unit_kills[unit::ZERGLING.0 as usize][0] = 4;
        game.game.unit_kills[unit::SPIDER_MINE.0 as usize][0] = 3;
        game.game.deaths[unit::MARINE.0 as usize][0] = 2;
        game.step(&mut tracker);

        let stats = tracker.player_stats(&game.game.victory_state, true);
        assert_eq!(stats[0].resources_destroyed, Some(100));
        assert_eq!(stats[0].resources_lost, Some(100));
    }

    #[test]
    fn progress_is_recorded_every_ten_seconds_while_a_slot_is_played() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_HUMAN, 0)]);
        game.set_completed(unit::SCV, 0, 4);
        game.set_completed(unit::OVERLORD, 0, 1);
        game.set_minerals_gathered(0, 50);
        let mut tracker = game.start(false);

        game.set_completed(unit::SCV, 0, 6);
        game.set_completed(unit::MARINE, 0, 3);
        game.set_minerals_gathered(0, 450);
        game.step_to(&mut tracker, SNAPSHOT_FRAMES - 1);
        assert_eq!(tracker.snapshot_frames, [0]);
        game.step_to(&mut tracker, SNAPSHOT_FRAMES);
        assert_eq!(tracker.snapshot_frames, [0, SNAPSHOT_FRAMES]);

        game.players[1].player_type = bw::PLAYER_TYPE_NONE;
        game.step_to(&mut tracker, SNAPSHOT_FRAMES * 2);

        let stats = tracker.player_stats(&game.game.victory_state, true);
        let timeline = stats[0].timeline.as_ref().unwrap();
        assert_eq!(timeline.workers, [4, 6, 6]);
        assert_eq!(timeline.army_score, [0, 150, 150]);
        assert_eq!(timeline.resources_mined, [0, 400, 400]);
        // Player 1 left before the third snapshot.
        assert_eq!(stats[1].timeline.as_ref().unwrap().workers.len(), 2);
    }

    #[test]
    fn a_winner_the_game_declared_is_left_alone() {
        // The game declared Flash the winner just before noticing Jaedong left.
        let mut won = player(0, 0, "Flash");
        won.victory_state = victory_state::VICTORY;
        let mut players = [won, player(1, 0, "Jaedong")];

        assert!(settle_outcome(&mut players));
        assert_eq!(outcomes(&players), [3, 0]);
    }

    #[test]
    fn a_defeated_player_who_stays_to_watch_is_out_from_their_defeat() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_HUMAN, 0)]);
        let mut tracker = game.start(false);
        game.game.victory_state[1] = victory_state::DEFEAT;
        game.step(&mut tracker);
        tracker.activity[1].record_command(&[0x1a, 0], 2);

        assert_eq!(tracker.activity[1].left_at_frame, Some(1));
        assert_eq!(tracker.activity[1].actions, 0);
        assert!(!tracker.following[1]);
    }

    #[test]
    fn a_shared_slot_plays_on_when_its_main_player_drops() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 1), (bw::PLAYER_TYPE_HUMAN, 1)]);
        game.game.team_game_main_player[0] = 1;
        let mut tracker = game.start(true);
        // Disconnected.
        game.game.victory_state[1] = 1;
        game.players[1].player_type = bw::PLAYER_TYPE_NONE;
        game.step(&mut tracker);

        assert!(tracker.following[1]);
        assert_eq!(tracker.activity[1].left_at_frame, Some(1));
        assert_eq!(tracker.activity[0].left_at_frame, None);
    }

    #[test]
    fn players_without_a_usable_team_keep_their_own_slot() {
        let mut players: [Option<StartingPlayer>; PLAYER_COUNT] = Default::default();
        for (id, team) in [(0, 0), (1, 1), (2, 2)] {
            players[id] = Some(StartingPlayer {
                name: String::new(),
                race: 0,
                team,
                is_computer: false,
            });
        }
        // Team 1 is led by player 1, and team 2's main player isn't a real slot.
        let slots = shared_control_slots(&players, &[1, 9, 0, 0]);
        assert_eq!(slots[..3], [0, 1, 2]);
    }

    #[test]
    fn progress_is_recorded_once_per_frame() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        let mut tracker = game.start(false);
        unsafe { tracker.take_snapshot(&mut *game.game, 0) };
        assert_eq!(tracker.snapshot_frames, [0]);
        assert_eq!(tracker.snapshots[0].len(), 1);
    }

    #[test]
    fn progress_includes_the_economy_supply_actions_and_bases() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        // Terran.
        game.players[0].race = 1;
        game.set_completed(unit::COMMAND_CENTER, 0, 1);
        let mut tracker = game.start(false);

        game.set_completed(unit::COMMAND_CENTER, 0, 2);
        game.game.minerals[0] = 340;
        game.game.gas[0] = 25;
        game.game.supplies[1].used[0] = 21;
        game.game.supplies[1].provided[0] = 30;
        game.game.supplies[1].max[0] = SUPPLY_LIMIT;
        game.game.deaths[unit::MARINE.0 as usize][0] = 2;
        tracker.activity[0].record_command(&[0x1a, 0], 5);
        game.step_to(&mut tracker, SNAPSHOT_FRAMES);

        let stats = tracker.player_stats(&game.game.victory_state, true);
        let timeline = stats[0].timeline.as_ref().unwrap();
        assert_eq!(timeline.bases, [1, 2]);
        assert_eq!(timeline.unspent, [0, 365]);
        assert_eq!(timeline.supply_used, [0, 11]);
        assert_eq!(timeline.supply_available, [0, 15]);
        assert_eq!(timeline.actions, Some(vec![0, 1]));
        assert_eq!(timeline.effective_actions, Some(vec![0, 1]));
        assert_eq!(timeline.resources_lost, [0, 100]);
    }

    #[test]
    fn supply_blocks_are_counted_every_frame_except_at_the_limit() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        // Zerg.
        game.players[0].race = 0;
        let supplies = &mut game.game.supplies[0];
        supplies.used[0] = 18;
        supplies.provided[0] = 18;
        supplies.max[0] = SUPPLY_LIMIT;
        let mut tracker = game.start(false);
        game.step(&mut tracker);
        game.step(&mut tracker);

        game.game.supplies[0].used[0] = SUPPLY_LIMIT;
        game.game.supplies[0].provided[0] = SUPPLY_LIMIT + 16;
        game.step(&mut tracker);

        let stats = tracker.player_stats(&game.game.victory_state, true);
        // Blocked when tracking started and for the next two frames, but not once maxed out.
        assert_eq!(stats[0].supply_blocked_frames, Some(3));
        // Counted as of the snapshot taken when tracking started.
        let timeline = stats[0].timeline.as_ref().unwrap();
        assert_eq!(timeline.supply_blocked_frames, [1]);
    }

    #[test]
    fn computers_have_no_actions_over_time() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_COMPUTER, 0)]);
        let tracker = game.start(false);
        let stats = tracker.player_stats(&game.game.victory_state, true);
        let timeline = stats[0].timeline.as_ref().unwrap();
        assert_eq!(timeline.actions, None);
        assert_eq!(timeline.effective_actions, None);
    }

    #[test]
    fn the_last_of_a_team_still_in_at_a_replays_end_recorded_it() {
        // Team 0 lost two players and the recorder left last, which their replay doesn't show.
        let mut chobosir = player(6, 0, "Chobosir");
        chobosir.left_at_frame = Some(13800);
        let mut irk = player(2, 0, "iRk");
        irk.victory_state = victory_state::DEFEAT;
        let mut players = [
            player(0, 1, "GuCCY"),
            player(1, 1, "T1Dragon"),
            irk,
            player(4, 1, "TheProbe"),
            player(5, 0, "mezee"),
            chobosir,
        ];

        mark_recorder_left(&mut players, 14619);
        assert_eq!(players[4].left_at_frame, Some(14619));
        assert!(settle_outcome(&mut players));
        assert_eq!(outcomes(&players), [3, 3, 2, 3, 2, 2]);
    }

    #[test]
    fn who_recorded_a_replay_is_left_alone_when_it_cant_be_told() {
        // A 1v1, and a 2v2 with one player out on each side.
        let mut one_on_one = [player(0, 0, "Flash"), player(1, 0, "Jaedong")];
        mark_recorder_left(&mut one_on_one, 100);
        assert!(one_on_one.iter().all(|p| p.left_at_frame.is_none()));

        let mut flash = player(0, 1, "Flash");
        flash.left_at_frame = Some(50);
        let mut bisu = player(2, 2, "Bisu");
        bisu.left_at_frame = Some(60);
        let mut two_on_two = [flash, player(1, 1, "Jaedong"), bisu, player(3, 2, "Stork")];
        mark_recorder_left(&mut two_on_two, 100);
        assert_eq!(two_on_two[1].left_at_frame, None);
        assert_eq!(two_on_two[3].left_at_frame, None);
    }

    fn point(x: i16, y: i16) -> bw::Point {
        bw::Point { x, y }
    }

    #[test]
    fn bases_are_town_halls_mining_their_own_minerals() {
        let main_minerals = [point(100, 100), point(132, 100)];
        let natural_minerals = [point(1500, 900)];
        let minerals: Vec<_> = main_minerals.into_iter().chain(natural_minerals).collect();
        let town_halls = [
            // Player 0's main, with a macro Hatchery next to it, and their natural.
            (0, point(200, 250)),
            (0, point(380, 150)),
            (0, point(1550, 1050)),
            // Player 1 built one far from any minerals, and one belongs to nobody playing.
            (1, point(3000, 3000)),
            (9, point(1500, 1000)),
        ];

        let bases = count_bases(&town_halls, &minerals);
        assert_eq!(bases[..2], [2, 0]);
    }

    #[test]
    fn a_mined_out_base_is_no_longer_a_base() {
        let bases = count_bases(&[(0, point(200, 250))], &[]);
        assert_eq!(bases[0], 0);
    }

    fn steps(tracker: &GameStatsTracker, slot: usize) -> Vec<(u32, BuildStepKind, u16, u32, bool)> {
        tracker
            .build_order(slot)
            .iter()
            .map(|s| (s.frame, s.kind, s.id, s.count, s.cancelled))
            .collect()
    }

    #[test]
    fn a_build_order_lists_what_was_started_with_the_supply_before() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        // Zerg, starting with 4 Drones.
        game.players[0].race = 0;
        game.set_completed(unit::DRONE, 0, 4);
        game.game.all_units_count[unit::DRONE.0 as usize][0] = 4;
        game.game.supplies[0].used[0] = 8;
        let mut tracker = game.start(false);

        game.game.all_units_count[unit::SPAWNING_POOL.0 as usize][0] = 1;
        game.game.supplies[0].used[0] = 6;
        game.step(&mut tracker);
        // Zerglings hatch in pairs, and a sieged tank isn't a new one.
        game.game.all_units_count[unit::ZERGLING.0 as usize][0] = 2;
        game.game.all_units_count[unit::SIEGE_TANK_SIEGE.0 as usize][0] = 0;
        game.step(&mut tracker);

        let order = tracker.build_order(0);
        assert_eq!(order[0].id, unit::SPAWNING_POOL.0);
        assert_eq!(order[0].supply, Some(4));
        assert_eq!(order[1].id, unit::ZERGLING.0);
        assert_eq!(order[1].count, 2);
        assert_eq!(order[1].supply, Some(3));
        assert_eq!(order.len(), 2);
    }

    #[test]
    fn a_building_that_gave_back_its_cost_was_canceled_and_one_that_didnt_was_lost() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        // Zerg.
        game.players[0].race = 0;
        game.set_completed(unit::DRONE, 0, 4);
        game.game.all_units_count[unit::DRONE.0 as usize][0] = 4;
        let mut tracker = game.start(false);
        let pool = unit::SPAWNING_POOL.0 as usize;
        game.game.all_units_count[pool][0] = 2;
        game.game.all_units_count[unit::DRONE.0 as usize][0] = 2;
        game.step(&mut tracker);

        // One is canceled, giving back three quarters of its cost and its Drone, while 8
        // minerals are mined.
        game.game.all_units_count[pool][0] = 1;
        game.game.all_units_count[unit::DRONE.0 as usize][0] = 3;
        game.game.minerals[0] = 158;
        game.set_minerals_gathered(0, 8);
        game.step(&mut tracker);
        // The other is destroyed, which gives nothing back, whenever its death is counted.
        game.game.all_units_count[pool][0] = 0;
        game.step(&mut tracker);

        assert_eq!(
            steps(&tracker, 0),
            [(1, BuildStepKind::Unit, unit::SPAWNING_POOL.0, 2, true)]
        );
    }

    #[test]
    fn what_a_slot_starts_with_isnt_part_of_its_build() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_HUMAN, 0)]);
        // Only finished units are counted at first for one, and nothing yet for the other.
        game.set_completed(unit::PROBE, 0, 4);
        let mut tracker = game.start(false);
        game.game.all_units_count[unit::PROBE.0 as usize][0] = 4;
        game.set_completed(unit::SCV, 1, 4);
        game.game.all_units_count[unit::SCV.0 as usize][1] = 4;
        game.step(&mut tracker);

        assert!(tracker.build_order(0).is_empty());
        assert!(tracker.build_order(1).is_empty());
        assert_eq!(produced(&tracker, 1, unit::SCV), 0);
    }

    #[test]
    fn units_from_larvae_are_listed_from_when_their_eggs_started() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        // Zerg.
        game.players[0].race = 0;
        game.give_starting_unit(0);
        game.game.supplies[0].used[0] = 8;
        let mut tracker = game.start(false);
        tracker.units.hatch_time[unit::ZERGLING.0 as usize] = 400;

        // The egg takes supply when it starts, and the Zerglings are counted when they hatch.
        game.game.supplies[0].used[0] = 9;
        game.step_to(&mut tracker, 1000);
        game.game.all_units_count[unit::ZERGLING.0 as usize][0] = 2;
        game.step_to(&mut tracker, 1400);

        let order = tracker.build_order(0);
        assert_eq!(order[0].frame, 1000);
        assert_eq!(order[0].supply, Some(4));
    }

    #[test]
    fn morphing_isnt_canceling_and_a_canceled_morph_isnt_something_new() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        game.set_completed(unit::HATCHERY, 0, 1);
        game.game.all_units_count[unit::HATCHERY.0 as usize][0] = 1;
        let mut tracker = game.start(false);

        game.game.all_units_count[unit::HATCHERY.0 as usize][0] = 0;
        game.game.all_units_count[unit::LAIR.0 as usize][0] = 1;
        game.step(&mut tracker);
        game.game.all_units_count[unit::HATCHERY.0 as usize][0] = 1;
        game.game.all_units_count[unit::LAIR.0 as usize][0] = 0;
        game.game.minerals[0] = 112;
        game.game.gas[0] = 75;
        game.step(&mut tracker);

        assert_eq!(
            steps(&tracker, 0),
            [(1, BuildStepKind::Unit, unit::LAIR.0, 1, true)]
        );
    }

    #[test]
    fn research_is_listed_from_when_it_started() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        game.give_starting_unit(0);
        let mut tracker = game.start(false);
        game.step_to(&mut tracker, 5000);
        game.game.upgrade_level_sc[0][upgrade::METABOLIC_BOOST.0 as usize] = 1;
        game.game.tech_level_sc[0][tech::BURROWING.0 as usize] = 1;
        game.step_to(&mut tracker, 6000);
        // Two levels finishing together, like after a replay seeks past them.
        game.game.upgrade_level_sc[0][upgrade::ZERG_MELEE_ATTACKS.0 as usize] = 2;
        game.step_to(&mut tracker, 10000);

        let order = tracker.build_order(0);
        let summary: Vec<_> = order.iter().map(|s| (s.frame, s.kind, s.level)).collect();
        assert_eq!(
            summary,
            [
                (4500, BuildStepKind::Upgrade, Some(1)),
                (4800, BuildStepKind::Tech, None),
                (5520, BuildStepKind::Upgrade, Some(2)),
                (6000, BuildStepKind::Upgrade, Some(1)),
            ]
        );
    }

    fn seen(slot: usize, id: UnitId, x: i16, y: i16) -> SeenUnit {
        let building = is_larva_maker(id) || id == unit::COMMAND_CENTER;
        SeenUnit {
            slot,
            id,
            position: point(x, y),
            building,
            working: true,
        }
    }

    #[test]
    fn scouting_is_the_first_unit_near_an_enemy_starting_base() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0), (bw::PLAYER_TYPE_HUMAN, 0)]);
        game.give_starting_unit(0);
        game.give_starting_unit(1);
        let mut tracker = game.start(false);
        let bases = [
            seen(0, unit::HATCHERY, 100, 100),
            seen(1, unit::HATCHERY, 3000, 3000),
        ];
        tracker.record_scan(&bases, 24);
        // An Overlord on its way, still far off.
        let far = [bases[0], bases[1], seen(0, unit::OVERLORD, 2000, 2000)];
        tracker.record_scan(&far, 48);
        assert_eq!(tracker.scouting.first_scout_frame, [None; PLAYER_COUNT]);

        let near = [bases[0], bases[1], seen(0, unit::DRONE, 2800, 2900)];
        tracker.record_scan(&near, 72);
        tracker.record_scan(&near, 96);
        assert_eq!(tracker.scouting.first_scout_frame[0], Some(72));
        assert_eq!(tracker.scouting.first_scout_frame[1], None);
    }

    #[test]
    fn teammates_bases_are_not_scouting() {
        let mut game = TestGame::new(&[
            (bw::PLAYER_TYPE_HUMAN, 1),
            (bw::PLAYER_TYPE_HUMAN, 1),
            (bw::PLAYER_TYPE_HUMAN, 2),
        ]);
        for slot in 0..3 {
            game.give_starting_unit(slot);
        }
        let mut tracker = game.start(false);
        let units = [
            seen(0, unit::HATCHERY, 100, 100),
            seen(1, unit::HATCHERY, 300, 100),
            seen(2, unit::HATCHERY, 3000, 3000),
            seen(0, unit::ZERGLING, 300, 120),
        ];
        tracker.record_scan(&units, 24);
        assert_eq!(tracker.scouting.first_scout_frame[0], None);
    }

    #[test]
    fn hatcheries_holding_three_larvae_are_counted_as_full() {
        let mut game = TestGame::new(&[(bw::PLAYER_TYPE_HUMAN, 0)]);
        game.give_starting_unit(0);
        let mut tracker = game.start(false);
        let units = [
            seen(0, unit::HATCHERY, 100, 100),
            seen(0, unit::LARVA, 90, 140),
            seen(0, unit::LARVA, 100, 140),
            seen(0, unit::LARVA, 110, 140),
            // A macro Hatchery with one larva to spare.
            seen(0, unit::HATCHERY, 600, 100),
            seen(0, unit::LARVA, 600, 140),
        ];
        tracker.record_scan(&units, 24);
        tracker.record_scan(&units, 48);
        assert_eq!(tracker.scouting.hatchery_frames[0], 48);
        assert_eq!(tracker.scouting.larva_capped_frames[0], 24);

        // A replay seeking far ahead isn't counted as all that time full.
        tracker.record_scan(&units, 10_000);
        assert_eq!(tracker.scouting.larva_capped_frames[0], 24 + MAX_SCAN_GAP);
    }
}
