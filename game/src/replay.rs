//! Reads the ShieldBattery section of replays.

use byteorder::{LE, ReadBytesExt};

pub const SECTION_ID: u32 = 0x74616253; // Sbat
// Change added by each version
// 1: Replay uses order queue limit fixes
// 2: Replay has UMS user selectable slots saved correctly
//      Was broken in SB replays before that; we don't currently do anything that
//      would need to know this, but going to make it easy to tell if we do in future.
// 3: Has workaround for workers getting stuck in gas building if they managed to enter
//      it while on unwalkable terrain (game_thread::order_harvest_gas)
pub const GAME_LOGIC_VERSION: u16 = 0x3;

pub struct SbatReplayData {
    pub team_game_main_players: [u8; 4],
    pub starting_races: [u8; 0xc],
    pub game_logic_version: u16,
}

#[test]
fn test_parse_shieldbattery_data() {
    use byteorder::WriteBytesExt;

    // Section payload as ShieldBattery writes it (offsets are relative to the payload, i.e. after
    // the 8-byte section id/length header).
    let mut data = vec![0u8; 0x58];
    (&mut data[0x0..]).write_u16::<LE>(1).unwrap(); // format_version
    data[0x16..0x1a].copy_from_slice(&[1, 2, 3, 4]); // team_game_main_players
    (&mut data[0x56..])
        .write_u16::<LE>(GAME_LOGIC_VERSION)
        .unwrap();

    let parsed = parse_shieldbattery_data(&data).unwrap();
    assert_eq!(parsed.team_game_main_players, [1, 2, 3, 4]);
    assert_eq!(parsed.game_logic_version, GAME_LOGIC_VERSION);
}

pub fn parse_shieldbattery_data(data: &[u8]) -> Option<SbatReplayData> {
    let format = (&data[0..]).read_u16::<LE>().ok()?;
    if format > 1 {
        return None;
    }
    let team_game_main_players = data.get(0x16..)?.get(..4)?;
    let starting_races = data.get(0x1a..)?.get(..0xc)?;
    let game_logic_version = if format == 1 {
        data.get(0x56..)?.read_u16::<LE>().ok()?
    } else {
        0
    };
    Some(SbatReplayData {
        team_game_main_players: team_game_main_players.try_into().ok()?,
        starting_races: starting_races.try_into().ok()?,
        game_logic_version,
    })
}
