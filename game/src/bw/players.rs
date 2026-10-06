use crate::bw;
use serde::Serialize;

/// An ID used to identify a particular game client by "Storm" (e.g. mostly the networking
/// layer of SC:R).
#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash)]
#[repr(transparent)]
pub struct StormPlayerId(pub u8);

/// An ID used to identify a particular player by the game code.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash)]
#[repr(transparent)]
pub struct BwPlayerId(pub u8);

impl BwPlayerId {
    /// Returns whether or not this player ID is for an observer.
    pub const fn is_observer(self) -> bool {
        self.0 >= 8
    }
}

/// Race of a player during a game (after random selection).
#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize)]
pub enum AssignedRace {
    #[serde(rename = "z")]
    Zerg,
    #[serde(rename = "t")]
    Terran,
    #[serde(rename = "p")]
    Protoss,
}

impl TryFrom<u8> for AssignedRace {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            bw::RACE_ZERG => Ok(AssignedRace::Zerg),
            bw::RACE_TERRAN => Ok(AssignedRace::Terran),
            bw::RACE_PROTOSS => Ok(AssignedRace::Protoss),
            _ => Err(format!("Invalid assigned race: {value}")),
        }
    }
}
