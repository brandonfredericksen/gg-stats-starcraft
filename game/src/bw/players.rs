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
