//! Hooks and other code that is running on the game/main thread (As opposed to async threads).

mod lobby_init;
mod pathing;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use bw_dat::Unit;
use byteorder::{ByteOrder, LittleEndian};
use lazy_static::lazy_static;
use tokio::sync::mpsc::UnboundedSender;

use crate::app_messages::GameSetupInfo;
use crate::bw::players::StormPlayerId;
use crate::bw::{Bw, get_bw};
use crate::bw_scr::BwScr;
use crate::forge::TRACK_WINDOW_POS;
use crate::game_thread::lobby_init::LobbyInitCompleter;
use crate::replay;
use crate::{bw, forge};

lazy_static! {
    pub static ref SEND_FROM_GAME_THREAD: Mutex<Option<UnboundedSender<GameThreadMessage>>> =
        Mutex::new(None);
    pub static ref GAME_RECEIVE_REQUESTS: Mutex<Option<Receiver<GameThreadRequest>>> =
        Mutex::new(None);
    static ref LOBBY_INIT_COMPLETER: Mutex<LobbyInitCompleter> =
        Mutex::new(LobbyInitCompleter::new());
}

/// Global for accessing game type/slots/etc from hooks.
static SETUP_INFO: OnceLock<GameSetupInfo> = OnceLock::new();
/// Global for shieldbattery-specific replay data.
/// Will not be initialized outside replays. (Or if the replay doesn't have that data)
static SBAT_REPLAY_DATA: OnceLock<replay::SbatReplayData> = OnceLock::new();

pub fn set_sbat_replay_data(data: replay::SbatReplayData) {
    if SBAT_REPLAY_DATA.set(data).is_err() {
        warn!("Tried to set shieldbattery replay data twice");
    }
}

pub fn sbat_replay_data() -> Option<&'static replay::SbatReplayData> {
    SBAT_REPLAY_DATA.get()
}

// Async tasks request game thread to do some work
pub struct GameThreadRequest {
    request_type: GameThreadRequestType,
    // These requests probably won't have any reason to return values on success.
    // If a single one does, it can send a GameThreadMessage.
    done: tokio::sync::oneshot::Sender<()>,
}

impl GameThreadRequest {
    pub fn new(
        request_type: GameThreadRequestType,
    ) -> (GameThreadRequest, tokio::sync::oneshot::Receiver<()>) {
        let (done, wait_done) = tokio::sync::oneshot::channel();
        (GameThreadRequest { request_type, done }, wait_done)
    }
}

pub enum GameThreadRequestType {
    Initialize,
    RunWndProc,
    StartGame,
    ExitCleanup,
    SetupInfo(Arc<GameSetupInfo>),
}

// Game thread sends something to async tasks
pub enum GameThreadMessage {
    WindowMove(i32, i32, i32, i32),
    GameStarting,
    /// Each player's stats, sent once the game ends.
    GameStats(crate::game_stats::GameStats),
    /// The game ended but its stats couldn't be collected.
    GameStatsFailed,
}

/// Sends a message from game thread to the async system.
pub fn send_game_msg_to_async(message: GameThreadMessage) {
    let send_global = SEND_FROM_GAME_THREAD.lock().unwrap();
    if let Some(ref send) = *send_global {
        let _ = send.send(message);
    } else {
        debug!("Game thread messaging not active");
    }
}

pub fn run_event_loop() -> ! {
    debug!("Main thread reached event loop");
    let mut receive_requests = GAME_RECEIVE_REQUESTS.lock().unwrap();
    let receive_requests = receive_requests
        .take()
        .expect("Channel to receive requests not set?");
    while let Ok(msg) = receive_requests.recv() {
        unsafe {
            handle_game_request(msg.request_type);
        }
        let _ = msg.done.send(());
    }
    // We can't return from here, as it would put us back in middle of BW's initialization code
    crate::wait_async_exit();
}

pub fn step_lobby_init() -> bool {
    if let Ok(mut completer) = LOBBY_INIT_COMPLETER.lock() {
        completer.step()
    } else {
        false
    }
}

pub fn until_next_lobby_init_step() -> u64 {
    if let Ok(completer) = LOBBY_INIT_COMPLETER.lock() {
        completer.until_next_step()
    } else {
        // If the lock is poisoned we're probably crashing anyway soooo
        1000
    }
}

unsafe fn handle_game_request(request: GameThreadRequestType) {
    unsafe {
        use self::GameThreadRequestType::*;
        match request {
            Initialize => init_bw(),
            RunWndProc => forge::run_wnd_proc(),
            SetupInfo(info) => {
                if SETUP_INFO.set(Arc::unwrap_or_clone(info)).is_err() {
                    warn!("Received second SetupInfo");
                }
            }
            StartGame => {
                debug!("Game thread received StartGame");
                // A game in the background never shows its window, so it also leaves focus, the
                // cursor and the start sound alone.
                let in_background = crate::is_background();
                if !in_background {
                    forge::bring_window_forward();
                }

                let start_time = Instant::now();

                debug!("Finishing lobby init");
                // Do the last little bit of initialization (we do it here so that we're not
                // jockeying between threads right as the game is starting)

                let bw = get_bw();
                let turn_seq = bw.snet_next_turn_sequence_number();
                debug!("Doing lobby game init, turn seq = {turn_seq}");
                bw.do_lobby_game_init(SETUP_INFO.get().unwrap().seed);

                loop {
                    let sleep_time = until_next_lobby_init_step();
                    if sleep_time > 0 {
                        thread::sleep(Duration::from_millis(sleep_time));
                    }

                    // Wait until the lobby init is done or we've waiting a minimum amount of time.
                    // Note that because of our handling of move/resize events, the window will
                    // not be movable/resizable if lobby init has completeted but we're still under
                    // the minimum time. Since the time is so short, this seems like an okay
                    // trade-off for not making people wait extra time in higher latency lobbies.
                    if step_lobby_init() && start_time.elapsed() >= Duration::from_millis(500) {
                        break;
                    }

                    // Keeps the window responsive while lobby init waits. If the user is resizing
                    // the window, this may not return until that completes. A background game has
                    // no window to keep responsive, and SC:R's process_events can wait there
                    // indefinitely for a window that was never shown.
                    if !in_background {
                        bw.process_events();
                    }
                }

                debug!("LobbyInitCompleter finished, proceeding to game loop");

                send_game_msg_to_async(GameThreadMessage::GameStarting);

                debug!("Game seed: {:#x}", bw.rng_seed());

                if !in_background {
                    forge::fix_clip_cursor();
                }
                forge::game_started();
                bw.set_game_started();
                if !in_background {
                    // The loading screen has handed off to the game, so this is where the
                    // game-start cursor centering belongs. SC:R's own centering happens later,
                    // inside game-loop init, and is dropped (see `BwScr::run_game_loop`).
                    forge::center_cursor_in_game_window();
                }
                bw.run_game_loop();
                report_game_end();

                debug!("Game loop ended");
                TRACK_WINDOW_POS.store(false, Ordering::Release);
                forge::hide_window();
            }
            // Saves registry settings etc.
            ExitCleanup => {
                get_bw().clean_up_for_exit();
            }
        }
    }
}

/// Collects the game's stats once the game has ended for the local player (the victory/defeat
/// dialog spawned, or the game loop exited), whichever comes first. Should only be called from the
/// game thread.
pub fn report_game_end() {
    let bw = get_bw();
    if bw.trigger_game_end_reported() {
        unsafe { crate::game_stats::game_ended() };
    }
}

pub static HAS_INIT_BW: AtomicBool = AtomicBool::new(false);

/// The storm ids `setup_slots` seated into the observer slots (`players[12 + n]`), `u32::MAX`
/// where the slot is empty. Observers hold ordinary storm ids, but BW's
/// game-start path renumbers an occupied observer slot's storm id to its own out-of-band
/// `0x80 + n` convention — this records what the slot's storm id is *supposed* to be, so it can
/// be re-asserted after game init (see `restore_observer_id_mappings`).
pub static OBSERVER_STORM_IDS: [AtomicU32; 4] = [const { AtomicU32::new(u32::MAX) }; 4];

// Does the rest of initialization that is being done in main thread before running forge's
// window proc.
unsafe fn init_bw() {
    unsafe {
        let bw = get_bw();
        // Trigger a redraw here just to ensure things are as up-to-date as possible before a
        // somewhat long blocking operation
        bw.force_redraw_during_init();
        bw.init_sprites();
        (*bw.game()).is_bw = 1;
        HAS_INIT_BW.store(true, Ordering::Release);
        debug!("Process initialized");
    }
}

/// Bw impl is expected to hook the point after init_game_data and call this.
pub unsafe fn after_init_game_data() {
    unsafe {
        // Let async thread know about player randomization.
        // The function that bw_1161/bw_scr refer to as init_game_data mainly initializes global
        // data structures used in a game. Player randomization seems to have been done before that,
        // so if it ever in future ends up being the case that the async thread has a point where it
        // uses wrong game player ids, a more exact point for this hook should be decided.
        //
        // But for now it should be fine, and this should also be late enough in initialization that
        // any possible alternate branches for save/replay/ums randomization should have been executed
        // as well.
        let bw = get_bw();
        let players = bw.players();
        debug!("After randomization:");
        for i in 0..16 {
            let player = *players.add(i);
            debug!(
                "Slot {} has id {}, player_type {}, storm_id {}",
                i, player.id, player.player_type, player.storm_id
            );
        }

        let game_data = bw.game_data();
        if setup_info()
            .and_then(|s| s.disable_alliance_changes)
            .unwrap_or(false)
        {
            (*game_data).game_template.allies_enabled = 0;
        }

        // The game's data is loaded now, which says which icon each upgrade and tech uses.
        crate::game_icons::save_captured();
    }
}

/// Returns whether the current game is a Use Map Settings game.
pub fn is_ums() -> bool {
    unsafe { (*get_bw().game_data()).game_type().is_ums() }
}

/// Returns whether the current game is a "Team" game (that is, has shared control among one or more
/// users for each "player" slot, like Team Melee).
pub fn is_team_game() -> bool {
    unsafe { (*get_bw().game_data()).game_type().is_team_game() }
}

pub fn is_replay() -> bool {
    SETUP_INFO.get().map(|x| x.is_replay()).unwrap_or(false)
}

pub fn is_replay_analysis() -> bool {
    SETUP_INFO.get().is_some_and(|x| x.is_replay_analysis())
}

/// The frame a watched replay opens at, if it isn't the start.
pub fn replay_start_frame() -> Option<u32> {
    SETUP_INFO.get().and_then(|x| x.replay_start_frame())
}

pub fn setup_info() -> Option<&'static GameSetupInfo> {
    SETUP_INFO.get()
}

/// Bw impl is expected to call this after step_game,
/// the function that progresses game objects by a tick/frame/step.
/// In other words, if the game isn't paused/lagging, this gets ran 24 times in second
/// on fastest game speed.
/// This function can be used for hooks that change gameplay state after BW has done (most of)
/// its once-per-gameplay-frame processing but before anything gets rendered. It probably
/// isn't too useful to us unless we end up having a need to change game rules.
pub unsafe fn after_step_game() {
    unsafe {
        crate::game_stats::after_step();
    }
}

/// Reimplementation of replay command reading & processing since the default implementation
/// has buffer overflows for replays where there are too many commands in a frame.
///
/// A function pointer for the original function is still needed to handle replay ending
/// case which we don't need to touch.
pub unsafe fn step_replay_commands(orig: unsafe extern "C" fn()) {
    unsafe {
        let bw = get_bw();
        let game = bw.game();
        let replay = bw.replay_data();
        let command_lengths = bw.game_command_lengths();
        let frame = (*game).frame_count;
        let data_end = (*replay).data_start.add((*replay).data_length as usize);
        let remaining_length = (data_end as usize).saturating_sub((*replay).data_pos as usize);
        // Data is in format
        // u32 frame, u8 length, { u8 storm_player, u8 cmd[] }[length]
        // Repeated for each frame in replay, if the commands don't fit in a single frame
        // then there can be repeated blocks with equal frame number.
        let mut data = std::slice::from_raw_parts((*replay).data_pos, remaining_length);
        if data.is_empty() {
            // Let the original function handle replay ending
            orig();
            return;
        }

        loop {
            let (mut frame_data, rest) = match replay_next_frame(data) {
                Some(s) => s,
                None => {
                    warn!("Broken replay? Unable to read next frame");
                    (*replay).data_pos = data_end;
                    return;
                }
            };
            if frame_data.frame > frame {
                break;
            }
            data = rest;
            while let Some((storm_player, command)) = frame_data.next_command(command_lengths) {
                bw.process_replay_commands(command, storm_player);
            }
        }
        let new_pos = (data_end as usize - data.len()) as *mut u8;
        (*replay).data_pos = new_pos;
    }
}

struct ReplayFrame<'a> {
    frame: u32,
    // (u8 storm_player, u8 command[...]) pairs repeated.
    // (Command length must be known from the data)
    commands: &'a [u8],
}

fn replay_next_frame(input: &[u8]) -> Option<(ReplayFrame<'_>, &[u8])> {
    let &commands_len = input.get(4)?;
    let frame = LittleEndian::read_u32(input.get(..4)?);
    let rest = input.get(5..)?;
    let commands = rest.get(..commands_len as usize)?;
    let rest = rest.get(commands_len as usize..)?;
    Some((ReplayFrame { frame, commands }, rest))
}

impl<'a> ReplayFrame<'a> {
    pub fn next_command(&mut self, command_lengths: &[u32]) -> Option<(StormPlayerId, &'a [u8])> {
        let player = StormPlayerId(*self.commands.first()?);
        let data = self.commands.get(1..)?;
        let length = bw::commands::command_length(data, command_lengths)?;
        let command = data.get(..length)?;
        let rest = data.get(length..)?;
        self.commands = rest;
        Some((player, command))
    }
}

/// Bw impl is expected to hook the point before init_unit_data and call this.
/// (It happens to be easy function for SC:R analysis to find and in a nice
/// spot to inject game init hooks for things that require initialization to
/// have progressed a bit but not too much)
pub unsafe fn before_init_unit_data(bw: &BwScr) {
    unsafe {
        let game = bw.game();
        if let Some(ext) = sbat_replay_data() {
            // This makes team game replays work.
            // This hook is unfortunately after the game has calculated
            // max supply for team games (It can be over 200), so we'll have to fix
            // those as well.
            //
            // (I don't think we have a better way to check for team game replay right now
            // other than just assuming that non-team games have main players as [0, 0, 0, 0])
            if ext.team_game_main_players != [0, 0, 0, 0] {
                (*game).team_game_main_player = ext.team_game_main_players;
                (*game).starting_races = ext.starting_races;
                let team_count = ext
                    .team_game_main_players
                    .iter()
                    .take_while(|&&x| x != 0xff)
                    .count();
                let players_per_team = match team_count {
                    2 => 4,
                    3 => 3,
                    4 => 2,
                    _ => 0,
                };

                // Non-main players get 0 max supply.
                // Clear what bw had already initialized.
                // (Other players having unused max supply likely won't matter but you never know)
                for race_supplies in (*game).supplies.iter_mut() {
                    for max in race_supplies.max.iter_mut() {
                        *max = 0;
                    }
                }

                let mut pos = 0;
                for i in 0..team_count {
                    let main_player = ext.team_game_main_players[i] as usize;
                    let first_pos = pos;
                    let mut race_counts = [0; 3];
                    for _ in 0..players_per_team {
                        // The third team of 3-team game has only two slots, they
                        // get their first slot counted twice
                        let index = match pos < 8 {
                            true => pos,
                            false => first_pos,
                        };
                        let race = ext.starting_races[index];
                        race_counts[race as usize] += 1;
                        pos += 1;
                    }
                    for (race, &count) in race_counts.iter().enumerate() {
                        let count = count.max(1);
                        // This value is twice the displayed, so 200 max supply for each
                        // player in team. (Or 200 if none)
                        (*game).supplies[race].max[main_player] = count * 400;
                    }
                }
            }
        }
    }
}

pub fn sb_game_logic_version() -> u16 {
    if is_replay() {
        sbat_replay_data()
            .map(|x| x.game_logic_version)
            .unwrap_or(0)
    } else {
        replay::GAME_LOGIC_VERSION
    }
}

pub unsafe fn order_harvest_gas(
    bw: &BwScr,
    unit: *mut bw::Unit,
    orig: unsafe extern "C" fn(*mut bw::Unit),
) {
    // Fix a rare issue where the worker won't not be able to exit a gas building
    // if it managed to enter it while on unwalkable terrain.
    //
    // This should be very rare as BW doesn't usually let ground units to move on unwalkable
    // terrain.
    if sb_game_logic_version() >= 3
        && let Some(unit) = Unit::from_ptr(unit)
    {
        // Check if unit is about to try exiting gas building on this step.
        if unit.order_state() == 5 && (**unit).order_timer == 0 {
            let game = bw_dat::Game::from_ptr(bw.game());
            let pathing = bw.pathing();
            let pos = unit.position();
            if pathing::is_at_unwalkable_region(pathing, &pos) {
                debug!(
                    "Fixing gas worker position at {}, {}, during step {}",
                    pos.x,
                    pos.y,
                    game.frame_count(),
                );
                if let Some(new_pos) = find_walkable_position_for_gas_worker(game, pathing, unit) {
                    debug!("Moved gas worker to {}, {}", new_pos.x, new_pos.y);
                    bw.move_unit(unit, &new_pos);
                }
            }
        }
    }
    orig(unit)
}

fn find_walkable_position_for_gas_worker(
    game: bw_dat::Game,
    pathing: *mut bw::Pathing,
    unit: Unit,
) -> Option<bw::Point> {
    // Note: Using gas position as a starting point.
    // Moving the worker on top of gas building is fine, BW's unit placement algorithm
    // will find an empty spot from there as long as the starting position is walkable.
    let pos = unit.target()?.position();

    // BW tile walkability is in 8x8 pixel tile precision. Gas buildings are 128x64 pixels large,
    // and their position should be in middle at (64, 32), so searching [-72, +72] x range,
    // [-40, 40] y range should cover every possible tile at gas, and one tile around
    // them, in case the gas is entirely at unwalkable terrain.
    //
    // (This offset list was sorted to place x = 72 and y = 40 offsets last, and after than that
    // sorted by distance from (0, 0).
    #[rustfmt::skip]
    static SEARCH_OFFSETS: &[(i16, i16)] = &[
        (0, 0), (-8, 0), (0, -8), (0, 8), (8, 0), (-8, -8), (-8, 8), (8, -8), (8, 8), (-16, 0),
        (0, -16), (0, 16), (16, 0), (-16, -8), (-16, 8), (-8, -16), (-8, 16), (8, -16), (8, 16),
        (16, -8), (16, 8), (-16, -16), (-16, 16), (16, -16), (16, 16), (-24, 0), (0, -24), (0, 24),
        (24, 0), (-24, -8), (-24, 8), (-8, -24), (-8, 24), (8, -24), (8, 24), (24, -8), (24, 8),
        (-24, -16), (-24, 16), (-16, -24), (-16, 24), (16, -24), (16, 24), (24, -16), (24, 16),
        (-32, 0), (0, -32), (0, 32), (32, 0), (-32, -8), (-32, 8), (-8, -32), (-8, 32), (8, -32),
        (8, 32), (32, -8), (32, 8), (-24, -24), (-24, 24), (24, -24), (24, 24), (-32, -16),
        (-32, 16), (-16, -32), (-16, 32), (16, -32), (16, 32), (32, -16), (32, 16), (-40, 0),
        (-32, -24), (-32, 24), (-24, -32), (-24, 32), (24, -32), (24, 32), (32, -24), (32, 24),
        (40, 0), (-40, -8), (-40, 8), (40, -8), (40, 8), (-40, -16), (-40, 16), (40, -16),
        (40, 16), (-32, -32), (-32, 32), (32, -32), (32, 32), (-40, -24), (-40, 24), (40, -24),
        (40, 24), (-48, 0), (48, 0), (-48, -8), (-48, 8), (48, -8), (48, 8), (-48, -16), (-48, 16),
        (48, -16), (48, 16), (-40, -32), (-40, 32), (40, -32), (40, 32), (-48, -24), (-48, 24),
        (48, -24), (48, 24), (-56, 0), (56, 0), (-56, -8), (-56, 8), (56, -8), (56, 8), (-48, -32),
        (-48, 32), (48, -32), (48, 32), (-56, -16), (-56, 16), (56, -16), (56, 16), (-56, -24),
        (-56, 24), (56, -24), (56, 24), (-64, 0), (64, 0), (-64, -8), (-64, 8), (-56, -32),
        (-56, 32), (56, -32), (56, 32), (64, -8), (64, 8), (-64, -16), (-64, 16), (64, -16),
        (64, 16), (-64, -24), (-64, 24), (64, -24), (64, 24), (-64, -32), (-64, 32), (64, -32),
        (64, 32),

        (0, -40), (0, 40), (-8, -40), (-8, 40), (8, -40), (8, 40), (-16, -40), (-16, 40),
        (16, -40), (16, 40), (-24, -40), (-24, 40), (24, -40), (24, 40), (-32, -40), (-32, 40),
        (32, -40), (32, 40), (-40, -40), (-40, 40), (40, -40), (40, 40), (-48, -40), (-48, 40),
        (48, -40), (48, 40), (-56, -40), (-56, 40), (56, -40), (56, 40), (-72, 0), (72, 0),
        (-72, -8), (-72, 8), (72, -8), (72, 8), (-72, -16), (-72, 16), (72, -16), (72, 16),
        (-64, -40), (-64, 40), (64, -40), (64, 40), (-72, -24), (-72, 24), (72, -24), (72, 24),
        (-72, -32), (-72, 32), (72, -32), (72, 32), (-72, -40), (-72, 40), (72, -40), (72, 40)
    ];
    SEARCH_OFFSETS.iter().find_map(|offset| {
        let pos = bw::Point {
            x: pos.x.checked_add(offset.0)?,
            y: pos.y.checked_add(offset.1)?,
        };
        if pathing::is_outside_map_coords(game, &pos) {
            return None;
        }
        if pathing::is_at_unwalkable_region(pathing, &pos) {
            return None;
        }
        Some(pos)
    })
}
