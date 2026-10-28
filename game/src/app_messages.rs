use std::fmt::Display;

use serde::{Deserialize, Serialize};

use crate::bw;
use crate::bw::{BwGameType, LobbyOptions};

// Structures of messages that are used to communicate with the electron app.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub local: serde_json::Map<String, serde_json::Value>,
    pub scr: serde_json::Map<String, serde_json::Value>,
    pub settings_file_path: String,
    /// If set, the bounds of the monitor that the user wants to launch on (in fullscreen modes).
    pub monitor_bounds: Option<(i32, i32, u32, u32)>,
}

// app/common/game_status.js
pub const GAME_STATUS_ERROR: u32 = 666;
#[derive(Serialize)]
pub struct SetupProgress {
    pub status: SetupProgressInfo,
}

#[derive(Serialize)]
pub struct SetupProgressInfo {
    pub state: u32,
    pub extra: Option<String>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SbUserId(pub u32);

impl From<u32> for SbUserId {
    fn from(value: u32) -> Self {
        SbUserId(value)
    }
}

impl From<&u32> for SbUserId {
    fn from(value: &u32) -> Self {
        SbUserId(*value)
    }
}

impl From<SbUserId> for u32 {
    fn from(value: SbUserId) -> Self {
        value.0
    }
}

impl From<&SbUserId> for u32 {
    fn from(value: &SbUserId) -> Self {
        value.0
    }
}

impl Display for SbUserId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct SbUser {
    pub id: SbUserId,
    pub name: String,
    /// A fully-qualified URL to the user's uploaded profile avatar, or `None` if they haven't
    /// uploaded one. This is a resolved URL, not the underlying storage path.
    #[serde(rename = "avatarUrl", default)]
    pub avatar_url: Option<String>,
}

#[derive(Serialize)]
pub struct WindowMove {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameType {
    Melee,
    Ffa,
    OneVOne,
    Ums,
    TeamMelee,
    TeamFfa,
    TopVBottom,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSetupInfo {
    pub name: String,
    pub map: MapInfo,
    pub map_path: String,
    pub game_type: GameType,
    pub game_sub_type: Option<u8>,
    pub slots: Vec<PlayerInfo>,
    pub users: Vec<SbUser>,
    #[expect(dead_code)]
    pub ratings: Option<Vec<(SbUserId, f32)>>,
    pub disable_alliance_changes: Option<bool>,
    pub use_legacy_limits: Option<bool>,
    pub turn_rate: Option<u32>,
    pub user_latency: Option<u32>,
    pub seed: u32,
}

impl GameSetupInfo {
    pub fn is_replay(&self) -> bool {
        match self.map {
            MapInfo::Replay(_) => true,
            MapInfo::Game(_) => false,
        }
    }

    pub fn is_replay_analysis(&self) -> bool {
        match &self.map {
            MapInfo::Replay(replay) => replay.analyze,
            MapInfo::Game(_) => false,
        }
    }

    /// The frame a watched replay opens at, if it isn't the start.
    pub fn replay_start_frame(&self) -> Option<u32> {
        match &self.map {
            MapInfo::Replay(replay) if !replay.analyze => replay.start_frame,
            _ => None,
        }
    }

    pub fn bw_game_type(&self) -> Option<BwGameType> {
        match self.game_type {
            GameType::Melee => Some(BwGameType::melee()),
            GameType::Ffa => Some(BwGameType::ffa()),
            GameType::OneVOne => Some(BwGameType::one_v_one()),
            GameType::Ums => Some(BwGameType::ums()),
            GameType::TeamMelee => Some(BwGameType::team_melee(self.game_sub_type?)),
            GameType::TeamFfa => Some(BwGameType::team_ffa(self.game_sub_type?)),
            GameType::TopVBottom => Some(BwGameType::top_v_bottom(self.game_sub_type?)),
        }
    }
}

impl From<&GameSetupInfo> for LobbyOptions {
    fn from(value: &GameSetupInfo) -> Self {
        LobbyOptions {
            game_type: value.bw_game_type().unwrap_or(BwGameType {
                primary: 0x2,
                subtype: 0x1,
            }),
            turn_rate: value.turn_rate.unwrap_or(0),
            use_legacy_limits: value.use_legacy_limits.unwrap_or(false),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
#[allow(dead_code)]
pub enum MapInfo {
    Replay(ReplayMapInfo),
    // Boxed since `GameMapInfo` is much larger than `ReplayMapInfo`; `Box<T>` deserializes
    // transparently, so this doesn't change the wire format.
    Game(Box<GameMapInfo>),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ReplayMapInfo {
    pub is_replay: bool,
    pub path: String,
    /// Plays the replay through to its end without showing the game, then reports its score data
    /// instead of letting someone watch it.
    #[serde(default)]
    pub analyze: bool,
    /// Opens the replay at this frame instead of its start, like a moment the coach points to.
    #[serde(default)]
    pub start_frame: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct GameMapInfo {
    pub id: String,
    pub hash: String,
    pub name: String,
    pub description: String,
    pub map_data: MapData,
    pub map_url: Option<String>,
    pub image256_url: Option<String>,
    pub image512_url: Option<String>,
    pub image1024_url: Option<String>,
    pub image2048_url: Option<String>,
    pub image_version: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MapData {
    pub height: u16,
    pub width: u16,
    pub ums_slots: u8,
    pub slots: u8,
    pub tileset: u16,
    pub is_eud: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Hash)]
#[serde(transparent)]
pub struct LobbyPlayerId(String);

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SbSlotType {
    Human,
    Observer,
    Computer,
    ControlledOpen,
    ControlledClosed,
    UmsComputer,
    Open,
    Closed,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    // The lobby player id from the server's slot list. Part of the wire format but not consulted by
    // the game DLL (it maps players by user id / slot index instead).
    #[allow(dead_code)]
    pub id: LobbyPlayerId,
    pub race: Option<String>,
    pub user_id: Option<SbUserId>,
    /// BW player slot index. Only set in UMS; for other game types the index is equal to
    /// GameSetupInfo.slots index.
    /// And either way this value becomes useless after BW randomizes the slots during
    /// game initialization.
    pub player_id: Option<u8>,
    pub team_id: u8,
    /// This is the slot type used by ShieldBattery code.
    #[serde(rename = "type")]
    pub player_type: SbSlotType,
    /// This is the slot type ID used in BW structures.
    #[serde(rename = "typeId")]
    pub player_type_id: u8,
}

impl PlayerInfo {
    /// Returns true for non-observing human players
    pub fn is_human(&self) -> bool {
        self.player_type == SbSlotType::Human
    }

    pub fn is_observer(&self) -> bool {
        self.player_type == SbSlotType::Observer
    }

    pub fn bw_player_type(&self) -> u8 {
        match self.player_type {
            SbSlotType::Human => bw::PLAYER_TYPE_HUMAN,
            SbSlotType::Observer => bw::PLAYER_TYPE_OBSERVER,
            SbSlotType::Computer => bw::PLAYER_TYPE_LOBBY_COMPUTER,
            SbSlotType::ControlledOpen
            | SbSlotType::ControlledClosed
            | SbSlotType::Open
            | SbSlotType::Closed => bw::PLAYER_TYPE_OPEN,
            _ => bw::PLAYER_TYPE_NONE,
        }
    }

    pub fn bw_race(&self) -> u8 {
        match self.race.as_deref() {
            Some("z") => bw::RACE_ZERG,
            Some("t") => bw::RACE_TERRAN,
            Some("p") => bw::RACE_PROTOSS,
            _ => bw::RACE_RANDOM,
        }
    }
}
