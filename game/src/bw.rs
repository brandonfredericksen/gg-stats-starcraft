use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub use bw_dat::structs::*;
use libc::{c_void, sockaddr};
use players::StormPlayerId;
use quick_error::quick_error;

use crate::app_messages::{MapInfo, Settings};
use crate::bw_scr::BwScr;

pub mod commands;
pub mod list;
pub mod players;
pub mod unit;

static BW_IMPL: OnceLock<&'static BwScr> = OnceLock::new();

/// Gets access to the object that is used for actually manipulating Broodwar state.
pub fn get_bw() -> &'static BwScr {
    BW_IMPL.get().unwrap()
}

pub fn set_bw_impl(bw: &'static BwScr) {
    let _ = BW_IMPL.set(bw);
}

#[derive(Debug, Copy, Clone)]
pub struct LobbyOptions {
    pub game_type: BwGameType,
    pub turn_rate: u32,
    pub use_legacy_limits: bool,
}

impl Default for LobbyOptions {
    fn default() -> Self {
        Self {
            game_type: BwGameType {
                primary: 0x2,
                subtype: 0x1,
            },
            turn_rate: 0,
            use_legacy_limits: false,
        }
    }
}

/// The interface to Broodwar.
///
/// Has mainly specialized functions that can only be sensibly called from
/// one point in code, but also some functions returning pointers to internal
/// structures that are more versatile.
pub trait Bw: Sync + Send {
    /// Guaranteed to be called before any of BW's code is ran.
    fn set_settings(&self, settings: &Settings);
    unsafe fn run_game_loop(&self);
    unsafe fn clean_up_for_exit(&self);
    unsafe fn init_sprites(&self);
    unsafe fn remaining_game_init(&self, local_player_name: &str);
    unsafe fn maybe_receive_turns(&self) -> bool;
    unsafe fn ready_lobby_for_start(&self);
    unsafe fn do_lobby_game_init(&self, seed: u32);
    unsafe fn try_finish_lobby_game_init(&self) -> bool;

    /// Reads the local player's storm id global (the same one `do_lobby_game_init` and
    /// `update_nation_and_human_ids` key off). Valid once a Storm session has been created for
    /// this client.
    unsafe fn local_storm_id(&self) -> u32;

    /// Inits player's info from storm to starcraft.
    /// Called once player has joined and is visible to storm.
    unsafe fn init_network_player_info(&self, storm_player_id: u32);
    unsafe fn create_lobby(
        &self,
        map_path: &Path,
        map_info: &MapInfo,
        lobby_name: &str,
        options: LobbyOptions,
    ) -> Result<(), LobbyCreateError>;
    unsafe fn game(&self) -> *mut Game;
    unsafe fn game_data(&self) -> *mut BwGameData;
    unsafe fn players(&self) -> *mut Player;
    /// May be null in some edge case?
    /// But since it is used for both recording and replaying it usually isn't.
    /// Should still check for null.
    unsafe fn replay_data(&self) -> *mut ReplayData;
    unsafe fn replay_header(&self) -> *mut ReplayHeader;
    fn game_command_lengths(&self) -> &[u32];
    unsafe fn process_replay_commands(&self, commands: &[u8], player: StormPlayerId);

    unsafe fn set_player_name(&self, id: u8, name: &str);

    unsafe fn active_units(&self) -> unit::UnitIterator;
    /// Every unit slot, for finding the units commands name.
    unsafe fn unit_array(&self) -> bw_dat::UnitArray;
    unsafe fn set_user_latency(&self, latency: UserLatency);

    /// Size unspecified.
    unsafe fn storm_player_flags(&self) -> Vec<u32>;

    unsafe fn storm_set_last_error(&self, error: u32);
    unsafe fn alloc(&self, size: usize) -> *mut u8;
    unsafe fn free(&self, ptr: *mut u8);
}

pub const MAX_STORM_PLAYERS: usize = 12;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct BwGameType {
    pub primary: u8,
    pub subtype: u8,
}

impl BwGameType {
    pub const fn melee() -> Self {
        Self {
            primary: 0x2,
            subtype: 0x1,
        }
    }

    pub const fn ffa() -> Self {
        Self {
            primary: 0x3,
            subtype: 0x1,
        }
    }

    pub const fn one_v_one() -> Self {
        Self {
            primary: 0x4,
            subtype: 0x1,
        }
    }

    pub const fn ums() -> Self {
        Self {
            primary: 0xa,
            subtype: 0x1,
        }
    }

    pub const fn team_melee(team_count: u8) -> Self {
        Self {
            primary: 0xb,
            subtype: team_count - 1,
        }
    }

    pub const fn team_ffa(team_count: u8) -> Self {
        Self {
            primary: 0xc,
            subtype: team_count - 1,
        }
    }

    pub const fn top_v_bottom(players_on_top: u8) -> Self {
        Self {
            primary: 0xf,
            subtype: players_on_top,
        }
    }

    pub fn as_u32(self) -> u32 {
        self.primary as u32 | ((self.subtype as u32) << 16)
    }

    pub fn is_ums(&self) -> bool {
        self.primary == 0xa
    }

    /// Whether the game type has shared control among one or more users, like Team Melee.
    pub fn is_team_game(&self) -> bool {
        matches!(self.primary, 0xb | 0xc | 0xd)
    }
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum LobbyCreateError {
        Unknown {}
        Invalid {}                 // This scenario is intended for use with a StarCraft Expansion Set.
        WrongGameType {}           // This map can only be played with the "Use Map Settings" game type.
        LadderBadAuth {}           // You must select an authenticated ladder map to start a ladder game.
        AlreadyExists {}           // A game by that name already exists!
        TooManyNames {}            // Unable to create game because there are too many games already running on this network.
        BadParameters {}           // An error occurred while trying to create the game.
        InvalidPlayerCount {}      // The selected scenario is not valid.
        UnsupportedGameType {}     // The selected map does not support the selected game type and options.
        MissingSaveGamePassword {} // You must enter a password to start a saved game.
        MissingReplayPassword {}   // You must enter a password to start a replay.
        IsDirectory {}             // (Changes the directory)
        NoHumanSlots {}            // This map does not have a slot for a human participant.
        NoComputerSlots {}         // You must have at least one computer opponent.
        InvalidLeagueMap {}        // You must select an official league map to start a league game.
        GameTypeUnavailable {}     // Unable to create game because the selected game type is currently unavailable.
        NotEnoughSlots {}          // The selected map does not have enough player slots for the selected game type.
        LeagueMissingBroodwar {}   // Brood War is required to play league games.
        LeagueBadAuth {}           // You must select an authenticated ladder map to start a ladder game.
        MapNotFound {
            display("Map was not found")
        }
        NonAnsiPath(path: PathBuf) {
            display("Path '{}' cannot be passed to BW", path.display())
        }
        Other(msg: String) {
            display("{}", msg)
        }
    }
}

impl LobbyCreateError {
    pub fn from_error_code(code: u32) -> LobbyCreateError {
        match code {
            0x8000_0001 => LobbyCreateError::Invalid,
            0x8000_0002 => LobbyCreateError::WrongGameType,
            0x8000_0003 => LobbyCreateError::LadderBadAuth,
            0x8000_0004 => LobbyCreateError::AlreadyExists,
            0x8000_0005 => LobbyCreateError::TooManyNames,
            0x8000_0006 => LobbyCreateError::BadParameters,
            0x8000_0007 => LobbyCreateError::InvalidPlayerCount,
            0x8000_0008 => LobbyCreateError::UnsupportedGameType,
            0x8000_0009 => LobbyCreateError::MissingSaveGamePassword,
            0x8000_000a => LobbyCreateError::MissingReplayPassword,
            0x8000_000b => LobbyCreateError::IsDirectory,
            0x8000_000c => LobbyCreateError::NoHumanSlots,
            0x8000_000d => LobbyCreateError::NoComputerSlots,
            0x8000_000e => LobbyCreateError::InvalidLeagueMap,
            0x8000_000f => LobbyCreateError::GameTypeUnavailable,
            0x8000_0010 => LobbyCreateError::NotEnoughSlots,
            0x8000_0011 => LobbyCreateError::LeagueMissingBroodwar,
            0x8000_0012 => LobbyCreateError::LeagueBadAuth,
            _ => LobbyCreateError::Unknown,
        }
    }
}

pub const PLAYER_TYPE_NONE: u8 = 0x0;
/// A computer in a game that has started. Computers are `PLAYER_TYPE_LOBBY_COMPUTER` until then.
pub const PLAYER_TYPE_COMPUTER: u8 = 0x1;
pub const PLAYER_TYPE_HUMAN: u8 = 0x2;
pub const PLAYER_TYPE_LOBBY_COMPUTER: u8 = 0x5;
pub const PLAYER_TYPE_OPEN: u8 = 0x6;
/// An observer slot (players[12..16]) with nobody in it. (SC:R itself distinguishes closed (0x8)
/// from open/joinable (0xC) observer slots; we seat everyone ourselves, so every empty observer
/// slot just stays 0x8.)
pub const PLAYER_TYPE_OBSERVER_NONE: u8 = 0x8;
/// An observer slot occupied by a human. SC:R's chat/format paths branch on this type (e.g. an
/// observer sender gets the `[Observer]` chat format instead of a team-force lookup that assumes
/// `team >= 1`), so occupied observer slots must carry it rather than `PLAYER_TYPE_HUMAN`.
pub const PLAYER_TYPE_OBSERVER: u8 = 0x9;
pub const RACE_ZERG: u8 = 0x0;
pub const RACE_TERRAN: u8 = 0x1;
pub const RACE_PROTOSS: u8 = 0x2;
pub const RACE_RANDOM: u8 = 0x6;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum UserLatency {
    Low,
    High,
    ExtraHigh,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct StormListHead<T> {
    pub unk: usize,
    pub node: StormListLink<T>,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct StormListLink<T> {
    pub prev: *mut T,
    /// NOTE: Bit 1 being set means that this is list end node, pointing to &list_head.node
    /// (Storm lists loop on itself)
    pub next: *mut T,
}

#[repr(C)]
pub struct SNetPlayerConnection {
    pub list: StormListLink<SNetPlayerConnection>,
    pub name: [u8; 0x100],
    /// Just sockaddr_in but making sure the layout is ok
    pub sockaddr: [u8; 0x10],
    pub flags: u32,
    pub last_message_tick: u32, // unsure
    pub last_resend_tick: u32,  // unsure
    pub unk_12c: [u8; 0x14],
    pub unconfirmed_sends: [StormListHead<c_void>; 4],
    pub received_packets: [StormListHead<c_void>; 4],
    pub unk_release_list: [StormListHead<c_void>; 4],
    pub unk_class2_list: StormListHead<c_void>,
    pub unk_seq_for_class: [u16; 4],
    pub next_seq_for_class: [u16; 4],
    pub class2_next_seq_unk: u16,
    pub unk3_seq_for_class: [u16; 4],
    pub unk4_seq_for_class: [u16; 4],
    pub unk_tick_for_class: [u32; 4],
    pub unk: [u8; 0x12],
    /// 0..0xc instead of 0..8 0x80..0x84 that bw sees storm players as
    pub storm_player_id: u8,
    pub unk_other_player_id: u8,
}

/// BW's lobby command that ends lobby setup and starts the game with a shared random seed.
pub const LOBBY_GAME_INIT_COMMAND: u8 = 0x48;

/// The lobby game-init record for a fresh (non-save) game: the command id, the seed as a
/// little-endian u32, then one player-remap byte per slot, all 8 (BW's "no remapping" value).
pub fn lobby_game_init_record(seed: u32) -> [u8; 13] {
    let mut record = [8u8; 13];
    record[0] = LOBBY_GAME_INIT_COMMAND;
    record[1..5].copy_from_slice(&seed.to_le_bytes());
    record
}

#[repr(C)]
pub struct SnpFunctions {
    pub unk0: usize,
    pub free_packet: unsafe extern "system" fn(*mut sockaddr, *const u8, u32) -> i32,
    pub initialize: unsafe extern "system" fn(
        *const crate::bw::ClientInfo,
        *mut c_void,
        *mut c_void,
        *mut c_void,
    ) -> i32,
    pub unk0c: usize,
    pub receive_packet:
        unsafe extern "system" fn(*mut *mut sockaddr, *mut *const u8, *mut u32) -> i32,
    pub send_packet: unsafe extern "system" fn(*const sockaddr, *const u8, u32) -> i32,
    pub unk18: usize,
    pub broadcast_game: unsafe extern "system" fn(
        *const u8,
        *const u8,
        *const u8,
        i32,
        u32,
        i32,
        i32,
        i32,
        *mut c_void,
        u32,
    ) -> i32,
    pub stop_broadcasting_game: unsafe extern "system" fn() -> i32,
    pub unk24: usize,
    pub unk28: usize,
    pub joined_game: Option<unsafe extern "system" fn(*const u8, usize) -> i32>,
    pub unk30: usize,
    pub unk34: usize,
    pub start_listening_for_games: Option<unsafe extern "system" fn() -> i32>,
    pub future_padding: [usize; 0x10],
}

#[repr(C)]
#[derive(Clone)]
pub struct SnpCapabilities {
    pub size: u32,
    pub unknown1: u32,
    pub max_packet_size: u32,
    pub unknown3: u32,
    pub displayed_player_count: u32,
    pub unknown5: u32,
    pub player_latency: u32,
    pub max_player_count: u32,
    pub turn_delay: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ClientInfo {
    pub size: u32,
    pub product_name: *const u8,
    pub version_str: *const u8,
    pub product_code: u32,
    pub version_code: u32,
    pub unk1: u32,
    pub max_players: u32,
    pub unk2: u32,
    pub unk3: u32,
    pub unk4: u32,
    pub unk5: u32,
    pub cd_key: *const u8,
    pub owner_name: *const u8,
    pub is_shareware: u32,
    pub language_id: u32,
}

#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct BwGameData {
    pub index: u32,
    pub name: [u8; 24],
    pub save_checksum: u32,
    pub map_width: u16,
    pub map_height: u16,
    pub active_player_count: u8,
    pub max_player_count: u8,
    pub game_speed: u8,
    pub approval: u8,
    pub game_type: u16,
    pub game_subtype: u16,
    pub turn_rate: u32,
    pub tileset: u16,
    pub is_replay: u8,
    pub active_computer_players: u8, // Only set when saving - why..
    pub game_creator: [u8; 25],
    pub map_name: [u8; 32],
    pub game_template: GameTemplate,
}

impl BwGameData {
    pub fn game_type(&self) -> BwGameType {
        BwGameType {
            primary: self.game_type as u8,
            subtype: self.game_subtype as u8,
        }
    }
}

#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct GameTemplate {
    pub game_type: u16,
    pub game_subtype: u16,
    pub game_subtype_display: u16,
    pub game_subtype_label: u16,
    pub victory_condition: u8,
    pub resource_type: u8,
    pub use_standard_unit_stats: u8,
    pub fog_of_war: u8,
    pub starting_units: u8,
    pub use_fixed_position: u8,
    pub restriction_flags: u8,
    pub allies_enabled: u8,
    pub num_teams: u8,
    pub cheats_enabled: u8,
    pub tournament_mode: u8,
    pub victory_condition_value: u32,
    pub mineral_value: u32,
    pub gas_value: u32,
    pub padding: u8,
}

#[repr(C)]
pub struct ReplayData {
    pub recording: u32,
    pub playing_back: u32,
    pub data_start: *mut u8,
    pub data_length: u32,
    pub data_capacity: u32,
    /// Start of the command bytes of the frame record the recorder is still appending to, or
    /// null when no record is open. The record's count byte sits just before this pointer and is
    /// only written when the record is closed (by the next record opening, or by the replay
    /// writer before it walks the buffer).
    pub current_frame_data_start: *mut u8,
    /// The game frame the recorder last opened a record for. An append at this same frame goes
    /// into the buffer without opening a record, on the assumption the record for it is still
    /// open.
    pub current_frame: u32,
    pub data_pos: *mut u8,
}

#[repr(C, packed)]
pub struct ReplayHeader {
    pub is_bw: u8,
    pub replay_end_frame: u32,
    pub campaign_mission: u16,
    pub save_data_command: [u8; 0xd],
    pub game_info: BwGameData,
    pub players: [Player; 0xc],
    pub ai_player_names: [u32; 8],
    pub ums_user_select_slots: [u8; 8],
}

unsafe impl Send for SnpFunctions {}
unsafe impl Sync for SnpFunctions {}
unsafe impl Send for ClientInfo {}
unsafe impl Sync for ClientInfo {}

#[test]
fn struct_sizes() {
    use std::mem::size_of;
    #[cfg(target_arch = "x86")]
    fn size(value: usize, _: usize) -> usize {
        value
    }
    #[cfg(target_arch = "x86_64")]
    fn size(_: usize, value: usize) -> usize {
        value
    }

    assert_eq!(size_of::<BwGameData>(), 0x8d);
    assert_eq!(size_of::<GameTemplate>(), 0x20);
    assert_eq!(size_of::<ReplayData>(), size(0x20, 0x30));
    assert_eq!(size_of::<ReplayHeader>(), 0x279);
    assert_eq!(size_of::<SNetPlayerConnection>(), size(0x21c, 0x2c0));
}

pub unsafe fn player_name(player: *mut Player) -> Cow<'static, str> {
    unsafe {
        let name = &(*player).name;
        let name_length = name.iter().position(|&x| x == 0).unwrap_or(name.len());
        let name = &name[..name_length];
        String::from_utf8_lossy(name)
    }
}
