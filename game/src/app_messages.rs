use std::fmt::Display;

use atomic_enum::atomic_enum;
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

use crate::bw;
use crate::bw::{BwGameType, LobbyOptions};
use crate::team_colors::{Color, TeamColorConfig, TeamColorUsage, parse_hex_color};

// Structures of messages that are used to communicate with the electron app.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub local: serde_json::Map<String, serde_json::Value>,
    pub scr: serde_json::Map<String, serde_json::Value>,
    pub settings_file_path: String,
    /// If set, the bounds of the monitor that the user wants to launch on (in fullscreen modes).
    pub monitor_bounds: Option<(i32, i32, u32, u32)>,
    /// The user's resolved custom team-color scheme, or `None` from a client that doesn't send it.
    /// The app maps presets to concrete `#RRGGBB` values before sending, so the DLL only ever sees
    /// resolved colors.
    #[serde(default)]
    pub team_colors: Option<TeamColorsSettings>,
    /// The filename template for this game's auto-saved replay (see [`crate::replay_name`]), or
    /// `None` to use the default.
    #[serde(default)]
    pub replay_name_template: Option<String>,
}

/// Fully-resolved custom team-color scheme, as sent by the app. Colors are `#RRGGBB` strings; the
/// DLL parses them into the engine's [`TeamColorConfig`] via [`TeamColorsSettings::to_config`].
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamColorsSettings {
    pub usage: TeamColorUsage,
    pub shuffle: bool,
    pub team: TeamSchemeColors,
    /// Optional fixed local-player color in team contexts, resolved by the app. When set it
    /// overrides the preset's `team.self` for any preset; absent / `null` leaves the local player on
    /// the preset self color.
    pub team_self: Option<String>,
    /// Identity color pool for FFA / non-team contexts.
    pub ffa: Vec<String>,
    /// Optional fixed local-player color in FFA contexts.
    pub ffa_self: Option<String>,
}

/// The team-scheme half of [`TeamColorsSettings`]: the local player's color plus the ally/enemy
/// pools used when team semantics apply.
#[derive(Deserialize, Debug, Clone)]
pub struct TeamSchemeColors {
    /// The local player's color. `self` is a Rust keyword, so the wire key is remapped.
    #[serde(rename = "self")]
    pub self_color: String,
    pub allies: Vec<String>,
    pub enemies: Vec<String>,
}

impl TeamColorsSettings {
    /// Converts the wire settings into the engine's [`TeamColorConfig`], hex-parsing every pool.
    /// Individually invalid entries are logged and dropped; if the local color is unparseable or
    /// any required pool resolves empty, the feature is disabled (`None`) rather than running with
    /// a degenerate pool.
    pub fn to_config(&self) -> Option<TeamColorConfig> {
        let self_color = match parse_hex_color(&self.team.self_color) {
            Some(c) => c,
            None => {
                warn!(
                    "Custom team colors disabled: invalid self color '{}'",
                    self.team.self_color
                );
                return None;
            }
        };
        let allies = parse_color_pool(&self.team.allies, "team allies");
        let enemies = parse_color_pool(&self.team.enemies, "team enemies");
        let ffa = parse_color_pool(&self.ffa, "ffa");
        let team_self_override = self.team_self.as_deref().and_then(|s| {
            let parsed = parse_hex_color(s);
            if parsed.is_none() {
                warn!("Ignoring invalid team self color '{s}'");
            }
            parsed
        });
        let ffa_self = self.ffa_self.as_deref().and_then(|s| {
            let parsed = parse_hex_color(s);
            if parsed.is_none() {
                warn!("Ignoring invalid ffa self color '{s}'");
            }
            parsed
        });
        if allies.is_empty() || enemies.is_empty() || ffa.is_empty() {
            warn!(
                "Custom team colors disabled: a color pool resolved empty \
                 (allies={}, enemies={}, ffa={})",
                allies.len(),
                enemies.len(),
                ffa.len()
            );
            return None;
        }
        Some(TeamColorConfig {
            usage: self.usage,
            shuffle: self.shuffle,
            self_color,
            team_self_override,
            allies,
            enemies,
            ffa,
            ffa_self,
        })
    }
}

/// Hex-parses a pool of `#RRGGBB` strings, logging and dropping any entry that doesn't parse.
fn parse_color_pool(hexes: &[String], label: &str) -> Vec<Color> {
    let mut out = Vec::with_capacity(hexes.len());
    for hex in hexes {
        match parse_hex_color(hex) {
            Some(color) => out.push(color),
            None => warn!("Dropping invalid {label} color '{hex}'"),
        }
    }
    out
}

#[atomic_enum]
#[derive(Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum StartingFog {
    #[default]
    Transparent,
    ShowResources,
    Legacy,
}

/// The minimap player-color mode, cycled in-game with Shift+Tab. The discriminants match the game's
/// internal `minimap_color_mode` global so the enum can be read/written against it directly, and
/// `serde_repr` (de)serializes it as that number across the wire and in local settings.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Default, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum MinimapColorMode {
    /// Default SC:R player colors everywhere.
    #[default]
    Standard = 0,
    /// Apply the user's color preset on the minimap only.
    PresetOnMinimapOnly = 1,
    /// Apply the user's color preset on both the minimap and the game view.
    Preset = 2,
}

impl TryFrom<u8> for MinimapColorMode {
    type Error = ();

    /// Maps a raw `minimap_color_mode` global value to the enum, failing if it's unrecognized.
    fn try_from(value: u8) -> Result<MinimapColorMode, Self::Error> {
        match value {
            0 => Ok(MinimapColorMode::Standard),
            1 => Ok(MinimapColorMode::PresetOnMinimapOnly),
            2 => Ok(MinimapColorMode::Preset),
            _ => Err(()),
        }
    }
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

/// Sent when a game exits to persist the minimap color toggle (Shift+Tab) that the user may have
/// changed during play.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimapSettings {
    pub color_mode: MinimapColorMode,
}

#[derive(Serialize)]
pub struct ReplaySaved {
    pub path: String,
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
    pub game_id: String,
    pub is_chat_restricted: Option<bool>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn team_colors_settings_deserialize_and_convert() {
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "exceptIn1v1",
            "shuffle": true,
            "team": {
                "self": "#2CB494",
                "allies": ["#FCFC38"],
                "enemies": ["#F40404"],
            },
            "teamSelf": "#123456",
            "ffa": ["#F40404", "#0C48CC"],
            "ffaSelf": "#00E4FC",
        }))
        .unwrap();
        // The wire `self` key maps onto `self_color`.
        assert_eq!(settings.team.self_color, "#2CB494");
        assert_eq!(settings.usage, TeamColorUsage::ExceptIn1v1);
        assert!(settings.shuffle);

        let config = settings.to_config().expect("valid pools resolve");
        assert_eq!(config.usage, TeamColorUsage::ExceptIn1v1);
        assert!(config.shuffle);
        assert_eq!(config.self_color, parse_hex_color("#2CB494").unwrap());
        // `teamSelf` resolves to the override; `team.self` still carries the preset self color.
        assert_eq!(
            config.team_self_override,
            Some(parse_hex_color("#123456").unwrap())
        );
        assert_eq!(config.allies, vec![parse_hex_color("#FCFC38").unwrap()]);
        assert_eq!(config.enemies, vec![parse_hex_color("#F40404").unwrap()]);
        assert_eq!(config.ffa.len(), 2);
        assert_eq!(config.ffa_self, Some(parse_hex_color("#00E4FC").unwrap()));
    }

    #[test]
    fn team_colors_optional_self_colors_default_to_none() {
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "always",
            "shuffle": false,
            "team": { "self": "#2CB494", "allies": ["#FCFC38"], "enemies": ["#F40404"] },
            "ffa": ["#F40404"],
        }))
        .unwrap();
        // Absent `teamSelf` / `ffaSelf` leave both overrides unset without disabling the feature.
        let config = settings.to_config().unwrap();
        assert_eq!(config.team_self_override, None);
        assert_eq!(config.ffa_self, None);
    }

    #[test]
    fn team_colors_invalid_team_self_is_ignored() {
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "always",
            "shuffle": false,
            "team": { "self": "#2CB494", "allies": ["#FCFC38"], "enemies": ["#F40404"] },
            "teamSelf": "not-a-color",
            "ffa": ["#F40404"],
        }))
        .unwrap();
        // An unparseable team self override is logged and dropped, not fatal: unlike the required
        // pools, the feature stays enabled with no override.
        assert_eq!(settings.to_config().unwrap().team_self_override, None);
    }

    #[test]
    fn team_colors_empty_pool_disables_feature() {
        // All-invalid entries drop to an empty pool, which disables the feature rather than
        // building a degenerate config.
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "always",
            "shuffle": false,
            "team": { "self": "#2CB494", "allies": ["not-a-color"], "enemies": ["#F40404"] },
            "ffa": ["#F40404"],
            "ffaSelf": null,
        }))
        .unwrap();
        assert!(settings.to_config().is_none());
    }

    #[test]
    fn team_colors_invalid_self_disables_feature() {
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "always",
            "shuffle": false,
            "team": { "self": "bad", "allies": ["#FCFC38"], "enemies": ["#F40404"] },
            "ffa": ["#F40404"],
        }))
        .unwrap();
        assert!(settings.to_config().is_none());
    }

    #[test]
    fn settings_without_team_colors_defaults_to_none() {
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "local": {},
            "scr": {},
            "settingsFilePath": "path",
            "monitorBounds": null,
        }))
        .unwrap();
        assert!(settings.team_colors.is_none());
    }
}
