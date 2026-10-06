use std::ffi::CStr;
use std::io;
use std::mem;
use std::path::{Path, PathBuf};
use std::pin::{Pin, pin};
use std::sync::Arc;
use std::time::Duration;

use futures::prelude::*;
use hashbrown::HashMap;
use quick_error::quick_error;
use tokio::select;
use tokio::sync::{mpsc, oneshot};

use crate::app_messages::{
    GAME_STATUS_ERROR, GameSetupInfo, PlayerInfo, SbUser, SbUserId, Settings, SetupProgress,
};
use crate::app_socket;
use crate::bw::players::BwPlayerId;
use crate::bw::{self, Bw, BwGameType, UserLatency, get_bw};
use crate::cancel_token::{CancelToken, Canceler, SharedCanceler};
use crate::forge;
use crate::game_thread::{self, GameThreadMessage, GameThreadRequest, GameThreadRequestType};
use crate::replay;

pub type SendMessages = mpsc::Sender<GameStateMessage>;

pub struct GameState {
    init_state: InitState,
    ws_send: app_socket::SendMessages,
    internal_send: SendMessages,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
    #[allow(dead_code)]
    running_game: Option<Canceler>,
    async_stop: SharedCanceler,
}

enum InitState {
    WaitingForInput(IncompleteInit),
    Started(InitInProgress),
}

struct IncompleteInit {
    local_user: Option<SbUser>,
    /// SbUserIds the local user has blocked; their in-game chat is hidden. Not required for init,
    /// so it defaults to empty if the app never sends it.
    blocked_users: Vec<SbUserId>,
    settings_set: bool,
}

impl IncompleteInit {
    fn init_if_ready(
        &mut self,
        info: &Arc<GameSetupInfo>,
    ) -> Result<InitInProgress, GameInitError> {
        if !self.settings_set {
            return Err(GameInitError::SettingsNotSet);
        }
        if self.local_user.is_none() {
            return Err(GameInitError::LocalUserNotSet);
        }

        Ok(InitInProgress::new(
            info.clone(),
            self.local_user.take().unwrap(),
            mem::take(&mut self.blocked_users),
        ))
    }
}

/// Messages sent from other async tasks to communicate with GameState
pub enum GameStateMessage {
    /// Boxed because it is large and sent once per game.
    SetSettings(Box<Settings>),
    SetLocalUser(SbUser),
    SetBlockedUsers(Vec<SbUserId>),
    SetupGame(Box<GameSetupInfo>),
    GameSetupDone,
    GameThread(GameThreadMessage),
    CleanupQuit,
    QuitIfNotStarted,
    /// The connection to the app was lost. A game that has started plays on without it, except a
    /// replay being analyzed, which nobody could see to close.
    AppDisconnected,
    /// Debug/verification control surface command (see `crate::debug_control`); absent from
    /// release builds.
    #[cfg(debug_assertions)]
    DebugControl(crate::debug_control::DebugControlCommand),
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum GameInitError {
        InitInProgress {
            display("Game init is already in progress")
        }
        SettingsNotSet {
            display("Settings not set")
        }
        LocalUserNotSet {
            display("Local user not set")
        }
        Closed {
            display("Game is being closed")
        }
        GameInitNotInProgress {
            display("Game isn't being inited")
        }
        NotAReplay {
            display("Only replays can be launched")
        }
        UnknownGameType(ty: crate::app_messages::GameType, sub: Option<u8>) {
            display("Unknown game type '{:?}', {:?}", ty, sub)
        }
        Bw(e: bw::LobbyCreateError) {
            display("BW error: {}", e)
        }
        NonAnsiPath(path: PathBuf) {
            display("Path '{}' cannot be passed to BW", path.display())
        }
        MissingMapInfo(desc: &'static str) {
            display("Missing map info '{}'", desc)
        }
        NullInPath(path: String) {
            display("Path '{}' contains null character", path)
        }
    }
}

impl GameState {
    fn set_settings(&mut self, settings: &Settings) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            forge::init(&settings.local, &settings.scr, settings.monitor_bounds);
            crate::replay_name::set_template(settings.replay_name_template.clone());
            get_bw().set_settings(settings);
            state.settings_set = true;
        } else {
            error!("Received settings after game was started");
        }
    }

    fn set_local_user(&mut self, user: SbUser) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            state.local_user = Some(user);
        } else {
            error!("Received local user after game was started");
        }
    }

    fn set_blocked_users(&mut self, users: Vec<SbUserId>) {
        if let InitState::WaitingForInput(ref mut state) = self.init_state {
            state.blocked_users = users;
        } else {
            error!("Received blocked users after game was started");
        }
    }

    fn send_game_request(
        &mut self,
        request_type: GameThreadRequestType,
    ) -> impl Future<Output = ()> + use<> {
        send_game_request(&self.send_main_thread_requests, request_type)
    }

    /// On success, returns once game is ready to be started & shown.
    fn init_game(
        &mut self,
        info: GameSetupInfo,
    ) -> impl Future<Output = Result<(), GameInitError>> + use<> {
        if !info.is_replay() {
            return future::err(GameInitError::NotAReplay).boxed();
        }
        let game_type = match info.bw_game_type() {
            Some(s) => s,
            None => {
                let err = GameInitError::UnknownGameType(info.game_type, info.game_sub_type);
                return future::err(err).boxed();
            }
        };

        let info = Arc::new(info);
        // The complete initialization logic is split between the future in this function and
        // InitInProgress, both places poking bw's state as well.. It may probably be better to move
        // everything to InitInProgress and have this function just initialize it?
        let init_state = match self.init_state {
            InitState::WaitingForInput(ref mut state) => match state.init_if_ready(&info) {
                Ok(o) => o,
                Err(e) => return future::err(e).boxed(),
            },
            InitState::Started(_) => {
                return future::err(GameInitError::InitInProgress).boxed();
            }
        };
        let local_user = init_state.local_user.clone();
        self.init_state = InitState::Started(init_state);

        let send_messages_to_state = self.internal_send.clone();
        let game_request_send = self.send_main_thread_requests.clone();

        self.init_main_thread
            .send(())
            .expect("Main thread should be waiting for a wakeup");
        async move {
            let sbat_replay_data = read_sbat_replay_data(Path::new(&info.map_path));
            // We tell BW thread to init, and then it'll stay in forge's WndProc until we're
            // ready to start the game - remaining initialization is done from other threads.
            // Could possibly aim to keep all of BW initialization in the main thread, but this
            // system has worked fine so far.
            let req = send_game_request(
                &game_request_send,
                GameThreadRequestType::SetupInfo(info.clone()),
            );
            req.await;
            let req = send_game_request(&game_request_send, GameThreadRequestType::Initialize);
            req.await;

            let latency = if let Some(latency) = info.user_latency {
                match latency {
                    0 => UserLatency::Low,
                    1 => UserLatency::High,
                    2 => UserLatency::ExtraHigh,
                    val => {
                        warn!("Invalid user latency value: {val}");
                        UserLatency::Low
                    }
                }
            } else {
                UserLatency::Low
            };

            unsafe {
                // Writes the local player name, brings up the SNP provider (choose_snp) and sets
                // is_multiplayer. A replay plays back through a local Storm session created here
                // (it is always its own host), with its user latency from the setup info.
                get_bw().remaining_game_init(&local_user.name);
                create_lobby(&info)?;
                debug!("Setting initial user latency: {latency:?}");
                get_bw().set_user_latency(latency);
            }

            start_game_request(&game_request_send, GameThreadRequestType::RunWndProc)
                .map_err(|()| GameInitError::Closed)?;

            // A replay plays back from its recorded command stream: there are no peers to join.
            // Its local Storm session was already created above; here it lays out slots, loads any
            // ShieldBattery replay extension, and readies the lobby.
            game_thread::step_lobby_init();
            let bw = get_bw();

            // create_lobby assigns this client's storm id (almost certainly 0, since a replay's
            // local session has no one else to share it with) — read it rather than assume.
            // `players[].storm_id` must carry this real value by the time `ready_lobby_for_start`
            // runs `update_nation_and_human_ids`, which asserts every human/observer slot's storm
            // id is a valid (< 16) id.
            let local_storm = unsafe { bw.local_storm_id() };

            // Native `create_lobby` flips this client's storm flag on asynchronously; wait a
            // bounded, short while for it before pulling the local player into net_player_info.
            unsafe {
                let mut attempts = 0;
                while bw
                    .storm_player_flags()
                    .get(local_storm as usize)
                    .copied()
                    .unwrap_or(0)
                    == 0
                    && attempts < 20
                {
                    game_thread::step_lobby_init();
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    attempts += 1;
                }
                if bw
                    .storm_player_flags()
                    .get(local_storm as usize)
                    .copied()
                    .unwrap_or(0)
                    == 0
                {
                    warn!(
                        "replay: local storm id {local_storm}'s flag never went nonzero after \
                         {attempts} attempts; proceeding anyway"
                    );
                }
                // Native init_net_player's name lookup only resolves the local player, which is
                // the only net player a replay has, so this alone populates the net_player_info
                // entry the game needs.
                bw.init_network_player_info(local_storm);
            }

            // The lone participant is this client's own viewer, at its real storm id, so slots are
            // laid out with a valid storm id.
            let storm_id_map: HashMap<SbUserId, u8> =
                std::iter::once((local_user.id, local_storm as u8)).collect();
            unsafe {
                setup_slots(&info.slots, &info.users, game_type, &storm_id_map);
            }

            match sbat_replay_data.await {
                Ok(Some(o)) => {
                    debug!("Loaded shieldbattery replay extension");
                    game_thread::set_sbat_replay_data(o);
                }
                Ok(None) => (),
                Err(e) => {
                    // A failure to read the extra replay data is usually not fatal, so log
                    // it and continue.
                    error!("Failed to read shieldbattery replay data: {e}");
                }
            }

            unsafe {
                bw.ready_lobby_for_start();
            }

            // The replay's local session is fully readied above, with no peer to wait on. Lobby
            // init completes later on the game thread in the StartGame handler (which synthesizes
            // the 0x48 and steps to completion).
            forge::start_process_events_dispatch();

            send_messages_to_state
                .send(GameStateMessage::GameSetupDone)
                .await
                .map_err(|_| GameInitError::Closed)?;
            Ok(())
        }
        .boxed()
    }

    /// Future finishes after the game has ended and the app has been told
    fn run_game(&mut self) -> impl Future<Output = Result<(), GameInitError>> + use<> {
        if !matches!(self.init_state, InitState::Started(_)) {
            return future::err(GameInitError::GameInitNotInProgress).boxed();
        }

        let ws_send = self.ws_send.clone();
        let game_request_send = self.send_main_thread_requests.clone();
        async move {
            forge::end_wnd_proc();
            let start_game_request = GameThreadRequestType::StartGame;
            let game_done = send_game_request(&game_request_send, start_game_request);

            game_done.await;

            app_socket::send_message(&ws_send, "/game/finished", ())
                .await
                .map_err(|_| GameInitError::Closed)?;

            Ok(())
        }
        .boxed()
    }

    // Message handler, so ideally only return futures that are about sending
    // messages to other tasks.
    fn handle_message(&mut self, message: GameStateMessage) -> impl Future<Output = ()> + '_ {
        use self::GameStateMessage::*;

        match message {
            SetSettings(settings) => {
                self.set_settings(&settings);
            }
            SetLocalUser(user) => {
                self.set_local_user(user);
            }
            SetBlockedUsers(users) => {
                self.set_blocked_users(users);
            }
            SetupGame(info) => {
                let ws_send = self.ws_send.clone();
                let async_stop = self.async_stop.clone();
                let game_ready = self.init_game(*info);
                let task = async move {
                    if let Err(e) = game_ready.await {
                        let msg = format!("Failed to init game: {e}");
                        error!("{msg}");

                        let message = SetupProgress {
                            status: crate::app_messages::SetupProgressInfo {
                                state: GAME_STATUS_ERROR,
                                extra: Some(msg),
                            },
                        };
                        let _ = app_socket::send_message(&ws_send, "/game/setupProgress", message)
                            .await;
                        expect_quit(&async_stop).await;
                    }
                };
                let (cancel_token, canceler) = CancelToken::new();
                self.running_game = Some(canceler);
                tokio::spawn(async move {
                    let task = pin!(task);
                    cancel_token.bind(task).await
                });
            }
            GameSetupDone => {
                let game_done = self.run_game();
                let async_stop = self.async_stop.clone();
                let task = async move {
                    if let Err(e) = game_done.await {
                        error!("Error on running game: {e}");
                    }
                    debug!("Game play task ended");
                    expect_quit(&async_stop).await;
                };
                let (cancel_token, canceler) = CancelToken::new();
                self.running_game = Some(canceler);
                tokio::spawn(async move {
                    let task = pin!(task);
                    cancel_token.bind(task).await
                });
            }
            GameThread(msg) => {
                return self.handle_game_thread_message(msg);
            }
            CleanupQuit => {
                let cleanup_request = GameThreadRequestType::ExitCleanup;
                let async_stop = self.async_stop.clone();
                let cleanup_done = self.send_game_request(cleanup_request);
                let task = async move {
                    cleanup_done.await;
                    debug!("BW cleanup done, exiting..");
                    async_stop.cancel();
                };
                tokio::spawn(task);
            }
            QuitIfNotStarted => {
                if !get_bw().has_game_started() {
                    debug!("Exiting since game has not started");
                    // Not cleaning up (that is, saving user settings or anything)
                    // since we didn't start in the first place
                    self.async_stop.cancel();
                }
            }
            AppDisconnected => {
                if crate::game_thread::is_replay_analysis() {
                    debug!("Exiting replay analysis since the app went away");
                    self.async_stop.cancel();
                } else if !get_bw().has_game_started() {
                    debug!("Exiting since game has not started");
                    self.async_stop.cancel();
                }
            }
            #[cfg(debug_assertions)]
            DebugControl(cmd) => {
                use crate::debug_control::DebugControlCommand;
                match cmd {
                    DebugControlCommand::Crash { kind } => {
                        // Faults right here on the async runtime thread; the process won't
                        // survive to reply.
                        crate::debug_control::crash(kind);
                    }
                    DebugControlCommand::Screenshot => {
                        let ws_send = self.ws_send.clone();
                        return async move {
                            let response = match tokio::task::spawn_blocking(
                                crate::debug_control::capture_screenshot,
                            )
                            .await
                            {
                                Ok(response) => response,
                                Err(e) => crate::debug_control::DebugScreenshotResponse {
                                    screenshot: None,
                                    error: Some(format!("screenshot task failed: {e}")),
                                },
                            };
                            let _ = app_socket::send_message(
                                &ws_send,
                                "/game/debug/screenshot",
                                response,
                            )
                            .await;
                        }
                        .boxed();
                    }
                }
            }
        }
        future::ready(()).boxed()
    }

    fn handle_game_thread_message<'s>(
        &'s mut self,
        message: GameThreadMessage,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 's>> {
        use crate::game_thread::GameThreadMessage::*;
        match message {
            WindowMove(..) => (),
            ReplaySaved(..) => (),
            GameStats(..) | GameStatsFailed => (),
            MinimapSettings { color_mode } => {
                // The game thread queues this after the game loop ends, before it completes the
                // StartGame request whose completion sends `/game/finished`. The two reach the app
                // over different tasks, so this isn't strictly ordered before `/game/finished`.
                return app_socket::send_message(
                    &self.ws_send,
                    "/game/minimapSettings",
                    crate::app_messages::MinimapSettings { color_mode },
                )
                .map(|_| ())
                .boxed();
            }
            PlayersRandomized => {
                if let InitState::Started(ref mut state) = self.init_state {
                    // The launch config only carries the local viewer, so the players come from
                    // the SB user ids recorded in the replay's Sbat section. This is what lets the
                    // chat manager hide blocked players' chat.
                    state.joined_players = build_replay_joined_players();

                    get_bw().init_chat_manager(
                        &state.joined_players,
                        state.local_user.id,
                        &state.blocked_users,
                        state.setup_info.is_chat_restricted.unwrap_or_default(),
                    );

                    let mapping = state
                        .joined_players
                        .iter()
                        .map(|player| game_thread::PlayerIdMapping {
                            game_id: player.player_id,
                            sb_user_id: player.sb_user_id,
                        })
                        .collect();
                    game_thread::set_player_id_mapping(mapping, state.local_user.id);
                } else {
                    warn!("Player randomization received too early");
                }
            }
            GameStarting => {
                return app_socket::send_message(&self.ws_send, "/game/start", ())
                    .map(|_| ())
                    .boxed();
            }
        }
        future::ready(()).boxed()
    }
}

async fn expect_quit(async_stop: &SharedCanceler) {
    tokio::time::sleep(Duration::from_millis(10000)).await;
    // The app is supposed to send a CleanupQuit command to acknowledge
    // that it received /game/end, or simple quit on error, but maybe it died?
    //
    // TODO(neive): Would be nice to do CleanupQuit if we finished game
    // succesfully even if the app didn't end up replying to us?
    warn!("Didn't receive close command, exiting automatically");
    async_stop.cancel();
}

struct InitInProgress {
    setup_info: Arc<GameSetupInfo>,
    local_user: SbUser,
    blocked_users: Vec<SbUserId>,

    joined_players: Vec<JoinedPlayer>,
}

#[derive(Clone, Debug)]
pub struct JoinedPlayer {
    pub name: String,
    pub player_id: Option<BwPlayerId>,
    pub sb_user_id: SbUserId,
}

impl InitInProgress {
    fn new(
        setup_info: Arc<GameSetupInfo>,
        local_user: SbUser,
        blocked_users: Vec<SbUserId>,
    ) -> InitInProgress {
        InitInProgress {
            setup_info,
            local_user,
            blocked_users,

            joined_players: Vec::new(),
        }
    }
}

unsafe fn create_lobby(info: &GameSetupInfo) -> Result<(), GameInitError> {
    unsafe {
        let map_path = Path::new(&info.map_path);
        get_bw()
            .create_lobby(map_path, &info.map, &info.name, info.into())
            .map_err(GameInitError::Bw)
    }
}

unsafe fn setup_slots(
    slots: &[PlayerInfo],
    users: &[SbUser],
    game_type: BwGameType,
    // The real storm id per user, used to lay out slots directly.
    storm_ids: &HashMap<SbUserId, u8>,
) {
    let id_to_name = users
        .iter()
        .map(|u| (u.id, u.name.as_str()))
        .collect::<HashMap<_, _>>();

    unsafe {
        let bw = get_bw();
        let is_ums = game_type.is_ums();
        let players = bw.players();
        // Observers are seated at 12..16 and are the one part of `slots` whose count varies with
        // who showed up, so the seeding of the regular range has to be based on the non-observer
        // count for the same lobby to always produce the same layout.
        let non_observer_slots = slots.iter().filter(|slot| !slot.is_observer()).count();
        for i in 0..12 {
            *players.add(i) = bw::Player {
                id: i as u32,
                storm_id: u32::MAX,
                player_type: match non_observer_slots < i {
                    true => bw::PLAYER_TYPE_OPEN,
                    false => bw::PLAYER_TYPE_NONE,
                },
                race: bw::RACE_RANDOM,
                team: 0,
                name: [0; 25],
            };
        }

        for i in 12..16 {
            *players.add(i) = bw::Player {
                id: 128 + (i - 12) as u32,
                storm_id: u32::MAX,
                player_type: bw::PLAYER_TYPE_OBSERVER_NONE,
                race: bw::RACE_RANDOM,
                team: 0,
                name: [0; 25],
            };
        }

        let mut num_observers = 0;
        for (i, slot) in slots.iter().enumerate() {
            // Observers take the native observer slots (12..16) in every game type. This has to be
            // checked before UMS handling: an observer isn't one of the map's slots, so their
            // `player_id` is meaningless and must not be used to place them.
            let slot_id = if slot.is_observer() {
                num_observers += 1;
                if num_observers > 4 {
                    panic!("Slots had more than 4 observers!");
                }

                11 + num_observers
            } else if is_ums {
                slot.player_id.unwrap_or(0) as usize
            } else {
                i
            };

            // This player_type_id check is completely ridiculous and doesn't make sense, but that gives
            // the same behaviour as normal bw. Not that any maps use those slot types as Scmdraft
            // doesn't allow setting them anyways D:
            let team = if !is_ums || (slot.player_type_id != 1 && slot.player_type_id != 2) {
                slot.team_id
            } else {
                0
            };
            let storm_id = match slot.is_human() || slot.is_observer() {
                // `update_nation_and_human_ids` builds the storm/game id maps from these, so they
                // must be the real storm ids. The lookup covers players and observers alike. A miss
                // falls through to `u32::MAX`, which that builder asserts against.
                true => slot
                    .user_id
                    .and_then(|uid| storm_ids.get(&uid).copied())
                    .map_or(u32::MAX, |storm| storm as u32),
                false => u32::MAX,
            };
            if slot.is_observer() {
                // BW's game-start path renumbers occupied observer slots to its own out-of-band
                // storm-id convention; record what this slot's storm id is supposed to be so it
                // can be re-asserted after game init.
                game_thread::OBSERVER_STORM_IDS[slot_id - 12]
                    .store(storm_id, std::sync::atomic::Ordering::Relaxed);
            }
            *players.add(slot_id) = bw::Player {
                id: if slot.is_observer() {
                    128 + (slot_id - 12) as u32
                } else {
                    slot_id as u32
                },
                storm_id,
                race: slot.bw_race(),
                player_type: if is_ums && !slot.is_human() && !slot.is_observer() {
                    // The type of UMS computers is set in the map file, and we have no reason to
                    // worry about the various possibilities there are, so just pass the integer
                    // onwards. Observers aren't map slots, so they're excluded: they get the same
                    // type as in any other game type.
                    slot.player_type_id
                } else {
                    slot.bw_player_type()
                },
                team,
                name: [0; 25],
            };
            bw.set_player_name(
                slot_id as u8,
                id_to_name
                    .get(&slot.user_id.unwrap_or(SbUserId(0)))
                    .copied()
                    .unwrap_or("Unknown Player"),
            );
        }
    }
}

/// Builds the joined-player list for a replay from the SB user ids recorded in its Sbat section,
/// so the chat manager can hide blocked players' chat. The launch config only names the local
/// viewer, but the replay records each player's SB user id keyed by BW player id, which is exactly
/// the id the chat manager matches incoming chat against.
///
/// Note we deliberately don't use the storm player list here: in a replay the only storm player is
/// the local viewer, not the recorded players. `user_ids` is indexed by BW player id (and covers
/// only the 8 playing slots), so we map it straight across — observers and empty slots (which have
/// a 0 user id) are skipped and won't have their chat hidden.
///
/// Returns an empty list for replays without the Sbat section (e.g. non-ShieldBattery replays), in
/// which case no chat is hidden.
fn build_replay_joined_players() -> Vec<JoinedPlayer> {
    let Some(replay_data) = game_thread::sbat_replay_data() else {
        return Vec::new();
    };
    let players = unsafe { get_bw().players() };
    let joined_players = replay_data
        .user_ids
        .iter()
        .enumerate()
        .filter_map(|(player_id, &sb_user_id)| {
            if sb_user_id.0 == 0 {
                return None;
            }
            // The BW player array is indexed by BW player id too, so it lines up with user_ids.
            let name = unsafe {
                CStr::from_ptr((*players.add(player_id)).name.as_ptr() as *const i8)
                    .to_str()
                    .unwrap_or("")
                    .to_string()
            };
            Some(JoinedPlayer {
                name,
                player_id: Some(BwPlayerId(player_id as u8)),
                sb_user_id,
            })
        })
        .collect::<Vec<_>>();
    debug!("Built replay joined players: {joined_players:?}");
    joined_players
}

pub async fn create_future(
    ws_send: app_socket::SendMessages,
    async_stop: SharedCanceler,
    mut messages: mpsc::Receiver<GameStateMessage>,
    init_main_thread: std::sync::mpsc::Sender<()>,
    send_main_thread_requests: std::sync::mpsc::Sender<GameThreadRequest>,
) {
    let (internal_send, mut internal_recv) = mpsc::channel(8);
    let mut game_state = GameState {
        init_state: InitState::WaitingForInput(IncompleteInit {
            local_user: None,
            blocked_users: Vec::new(),
            settings_set: false,
        }),
        ws_send,
        internal_send,
        init_main_thread,
        send_main_thread_requests,
        running_game: None,
        async_stop,
    };
    loop {
        let message = select! {
            x = messages.recv() => x,
            x = internal_recv.recv() => x,
        };
        match message {
            Some(m) => game_state.handle_message(m).await,
            None => break,
        }
    }
    debug!("Game state task ended");
}

/// Sends a request to game thread and waits for it to finish
fn send_game_request(
    sender: &std::sync::mpsc::Sender<GameThreadRequest>,
    request_type: GameThreadRequestType,
) -> impl Future<Output = ()> + use<> {
    // (Error means that game thread closed)
    let result = start_game_request(sender, request_type);
    async move {
        if let Ok(wait_done) = result {
            let _ = wait_done.await;
        };
    }
}

/// Sends a request to game thread and only waits until it has been sent,
/// resolves to a receiver that can be used to wait for finish.
fn start_game_request(
    sender: &std::sync::mpsc::Sender<GameThreadRequest>,
    request_type: GameThreadRequestType,
) -> Result<oneshot::Receiver<()>, ()> {
    let (request, wait_done) = GameThreadRequest::new(request_type);

    sender.send(request).map_err(|_| ())?;
    Ok(wait_done)
}

async fn read_sbat_replay_data(path: &Path) -> Result<Option<replay::SbatReplayData>, io::Error> {
    use byteorder::{ByteOrder, LittleEndian};
    use tokio::fs;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut file = fs::File::open(path).await?;
    let mut buffer = [0u8; 0x14];
    file.read_exact(&mut buffer).await?;
    let magic = LittleEndian::read_u32(&buffer[0xc..]);
    let scr_extension_offset = LittleEndian::read_u32(&buffer[0x10..]);
    if magic != 0x53526573 {
        return Ok(None);
    }
    let end_pos = file.seek(io::SeekFrom::End(0)).await?;
    file.seek(io::SeekFrom::Start(scr_extension_offset as u64))
        .await?;
    let length = end_pos.saturating_sub(scr_extension_offset as u64) as usize;
    let mut buffer = vec![0u8; length];
    file.read_exact(&mut buffer).await?;
    let mut pos = 0;
    while pos < length {
        let header = match buffer.get(pos..(pos + 8)) {
            Some(s) => s,
            None => break,
        };
        let id = LittleEndian::read_u32(header);
        let section_length = LittleEndian::read_u32(&header[4..]) as usize;
        if id == replay::SECTION_ID {
            let data = Some(())
                .and_then(|()| buffer.get(pos.checked_add(8)?..)?.get(..section_length))
                .and_then(replay::parse_shieldbattery_data);
            return match data {
                Some(o) => Ok(Some(o)),
                None => Err(io::Error::other("Failed to parse shieldbattery section")),
            };
        } else {
            pos = pos.saturating_add(section_length).saturating_add(8);
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lobby_game_init_record_has_the_expected_13_byte_layout() {
        // 0x48, u32 seed (LE), then 8 player bytes each = 8 (the empty/no-remapping sentinel for a
        // fresh game).
        assert_eq!(
            bw::lobby_game_init_record(0x1234_5678),
            [0x48, 0x78, 0x56, 0x34, 0x12, 8, 8, 8, 8, 8, 8, 8, 8]
        );
    }
}
