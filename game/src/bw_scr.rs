use std::cell::Cell;
use std::ffi::OsString;
use std::marker::PhantomData;
use std::mem;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::time::Instant;

use byteorder::{ByteOrder, LittleEndian};
use libc::c_void;
use parking_lot::{Mutex, RwLock};
use winapi::shared::minwindef::FILETIME;
use winapi::um::errhandlingapi::{GetLastError, SetLastError};
use winapi::um::fileapi::INVALID_FILE_ATTRIBUTES;
use winapi::um::libloaderapi::GetModuleHandleW;
use winapi::um::winnt::FILE_ATTRIBUTE_DIRECTORY;

use scr_analysis::{DatType, VirtualAddress, scarf};
pub use thiscall::Thiscall;

use crate::app_messages::{MapInfo, Settings};
use crate::bw::players::{BwPlayerId, StormPlayerId};
use crate::bw::unit::{Unit, UnitIterator};
use crate::bw::{self, Bw, LobbyOptions, SnpFunctions};
use crate::bw::{UserLatency, commands};
use crate::game_stats::{self, GameStatsTracker};
use crate::game_thread::{self};
use crate::minimap::Terrain;
use crate::offline_cookie;
use crate::recurse_checked_mutex::Mutex as RecurseCheckedMutex;
use crate::snp;
use crate::sync::DumbSpinLock;
use crate::windows;

pub mod scr;

mod dialog_hook;
mod file_hook;
mod game;
mod pe_image;
mod thiscall;

const NET_PLAYER_COUNT: usize = 12;

pub struct BwScr {
    game: Value<*mut bw::Game>,
    game_data: Value<*mut bw::BwGameData>,
    players: Value<*mut bw::Player>,
    pathing: Value<*mut bw::Pathing>,
    storm_player_flags: Value<*mut u32>,
    lobby_state: Value<u8>,
    is_multiplayer: Value<u8>,
    game_state: Value<u8>,
    sprites_inited: Value<u8>,
    local_player_id: Value<u32>,
    local_unique_player_id: Value<u32>,
    local_storm_id: Value<u32>,
    command_user: Value<u32>,
    unique_command_user: Value<u32>,
    storm_command_user: Value<u32>,
    rng_seed: Value<u32>,
    /// User latency setting, 0 = Low, 1 = High, 2 = Extra High
    net_user_latency: Value<u32>,
    net_player_to_game: Value<*mut u32>,
    net_player_to_unique: Value<*mut u32>,
    local_player_name: Value<*mut u8>,
    first_active_unit: Value<*mut bw::Unit>,
    replay_data: Value<*mut bw::ReplayData>,
    replay_header: Value<*mut bw::ReplayHeader>,
    /// Countdown the trigger step decrements once per frame: triggers run on the frame it reads
    /// as zero, then it resets to 30. The native player-leave handler forces it to 1 in live games
    /// but not when the recorded leave command plays back, so replay playback restores that write
    /// itself (see [`process_replay_commands`](Self::process_replay_commands)).
    trigger_execution_timer: Value<u16>,
    enable_rng: Value<u32>,
    allocator: Value<*mut scr::Allocator>,
    allocated_order_count: Value<u32>,
    order_limit: Value<u32>,
    /// [[u8; 4]; 256], mostly unused in SC:R, but still gets used for player colors at least.
    main_palette: Value<*mut u8>,
    units: Value<*mut scr::BwVector>,
    /// Hooked to see where units die. `None` if unlocated, which leaves deaths off the minimap.
    kill_unit: Option<VirtualAddress>,
    /// What the minimap's picture of the map is made from. `None` if any of it is unlocated,
    /// which leaves the minimap without one.
    terrain: Option<TerrainValues>,
    replay_bfix: Option<Value<*mut scr::ReplayBfix>>,
    replay_gcfg: Option<Value<*mut scr::ReplayGcfg>>,
    anti_troll: Option<Value<*mut scr::AntiTroll>>,
    snet_local_player_list: Option<Value<*mut bw::StormListHead<bw::SNetPlayerConnection>>>,
    free_orders: LinkedList<bw::Order>,

    init_network_player_info: unsafe extern "C" fn(u32, u32, u32, u32),
    step_network: unsafe extern "C" fn() -> usize,
    select_map_entry: unsafe extern "C" fn(
        *mut scr::GameInput,
        *mut *const scr::LobbyDialogVtable,
        *mut scr::MapDirEntry,
    ) -> u32,
    game_loop: unsafe extern "C" fn(),
    init_sprites: unsafe extern "C" fn(),
    init_real_time_lighting: Option<unsafe extern "C" fn()>,
    // Setting the argument to nonzero seems to be used by the new bnet lobbies/mm?
    // Skips over some player initialization and lobby map downloads.
    // It may be slightly more ideal for us to call init_game_network(1) as well, but
    // it would at least require the host to call init_team_game_playable_slots(), and
    // as there may be other similar data that would not be inited, it's going to do
    // init_game_network(0) for now. And that's closer to 1161 behaviour.
    init_game_network: unsafe extern "C" fn(u32),
    process_lobby_commands: unsafe extern "C" fn(*const u8, usize, u32),
    choose_snp: unsafe extern "C" fn(u32) -> u32,
    init_storm_networking: unsafe extern "C" fn(),
    send_command: unsafe extern "C" fn(*const u8, usize),
    snet_recv_packets: unsafe extern "C" fn(),
    snet_send_packets: unsafe extern "C" fn(),
    process_events: unsafe extern "C" fn(u32),
    process_game_commands: unsafe extern "C" fn(*const u8, usize, u32),
    move_unit: Thiscall<unsafe extern "C" fn(*mut bw::Unit, i32, i32)>,
    render_screen: unsafe extern "C" fn(*mut c_void, usize),
    sc_main: Option<VirtualAddress>,
    mainmenu_entry_hook: VirtualAddress,
    load_snp_list: VirtualAddress,
    start_udp_server: VirtualAddress,
    step_io: VirtualAddress,
    init_game_data: VirtualAddress,
    init_unit_data: VirtualAddress,
    step_game: VirtualAddress,
    step_replay_commands: VirtualAddress,
    order_harvest_gas: VirtualAddress,
    game_command_lengths: Vec<u32>,
    open_file: VirtualAddress,
    prepare_issue_order: VirtualAddress,
    create_game_multiplayer: VirtualAddress,
    spawn_dialog: VirtualAddress,
    step_game_logic: VirtualAddress,
    lobby_create_callback_offset: usize,
    starcraft_tls_index: SendPtr<*mut u32>,

    // State
    disable_hd: AtomicBool,
    is_replay_seeking: AtomicBool,
    lobby_game_init_command_seen: AtomicBool,
    is_carbot: AtomicBool,
    show_skins: AtomicBool,
    is_processing_game_commands: AtomicBool,
    /// Avoid reporting the same player being dropped multiple times.
    /// Bit 0x1 = Net id 0, 0x2 = net id 1, etc.
    dropped_players: AtomicU32,
    // Path that reads/writes of CSettings.json will be redirected to
    settings_file_path: RwLock<String>,
    detection_status_copy: Mutex<Vec<u32>>,
    game_stats: RecurseCheckedMutex<Option<GameStatsTracker>>,
    /// Whether the game has been started (e.g. we're done loading in)
    game_started: AtomicBool,
    /// Whether the end of the game has been reported (see [`game_thread::report_game_end`])
    game_end_reported: AtomicBool,
    /// Used to have step_game_logic_hook do things once at start of the game, after initial
    /// units are spawned and game logic is ready to run normally.
    /// Will be reset on replay rewinds.
    first_game_logic_frame_done: AtomicBool,
    /// Ensures that things that qualify as "event processing" (e.g. process_events,
    /// maybe_receive_turns) don't execute from multiple threads at the same time (which may happen
    /// at certain points during game init).
    event_processing_lock: DumbSpinLock,
}

/// The globals [`Terrain`] is read from.
struct TerrainValues {
    map_tiles: Value<*mut u16>,
    creep_original_tiles: Value<*mut u16>,
    tileset_cv5: Value<*mut u8>,
    tileset_vx4ex: Value<*mut u32>,
    minitile_graphics: Value<*mut u8>,
}

struct SendPtr<T>(T);
unsafe impl<T> Send for SendPtr<T> {}
unsafe impl<T> Sync for SendPtr<T> {}

// Actually thiscall, but that isn't available in stable Rust (._.)
// Luckily we don't care about ecx
// Argument is a pointer to some BnetCreatePopup class
unsafe extern "system" fn lobby_create_callback(_popup: *mut c_void) -> u32 {
    // Return 1001 = Error, 1003 = Ok but needs proxy, 1004 = Other error
    0
}

/// scarf::Operand is a type describing arbitrary expression returned by
/// analysis. For example, it can be a constant memory address 0x123456,
/// pointer indirection Mem32[0x123456], or even arbitrary arithmetic
/// expressions combined with previous examples.
///
/// We cannot resolve the analysis results immediately to concrete pointers
/// after analysis, as the objects can be located in memory that BW has yet
/// to allocate. Instead resolving is done whenever the object is requested.
/// (It isn't that slow performance-wise, and who knows if a future patch
/// moves data around even in middle of game to be a nuisance)
///
/// Note: It is fine to over/underestimate size of an integer type, e.g.
/// using Value<u32> instead of Value<u8> won't corrupt unrelated values.
/// Though using a smaller size than what the value internally is will
/// truncate any read data to that size.
/// (So maybe using Value<u32> always would be fine?)
#[derive(Copy, Clone)]
struct Value<T> {
    op: scarf::Operand<'static>,
    phantom: PhantomData<T>,
}

impl<T> Value<T> {
    fn new(ctx: scarf::OperandCtx<'static>, op: scarf::Operand<'_>) -> Value<T> {
        Value {
            op: ctx.copy_operand(op),
            phantom: Default::default(),
        }
    }
}

trait BwValue {
    fn from_usize(val: usize) -> Self;
    fn to_usize(val: Self) -> usize;
}

impl<T> BwValue for *mut T {
    fn from_usize(val: usize) -> Self {
        val as *mut T
    }
    fn to_usize(val: Self) -> usize {
        val as usize
    }
}

impl BwValue for u8 {
    fn from_usize(val: usize) -> Self {
        val as u8
    }
    fn to_usize(val: Self) -> usize {
        val as usize
    }
}

impl BwValue for u16 {
    fn from_usize(val: usize) -> Self {
        val as u16
    }
    fn to_usize(val: Self) -> usize {
        val as usize
    }
}

impl BwValue for u32 {
    fn from_usize(val: usize) -> Self {
        val as u32
    }
    fn to_usize(val: Self) -> usize {
        val as usize
    }
}

impl BwValue for f32 {
    fn from_usize(val: usize) -> Self {
        f32::from_bits(val as u32)
    }
    fn to_usize(val: Self) -> usize {
        val.to_bits() as usize
    }
}

impl<T: BwValue> Value<T> {
    unsafe fn resolve(&self) -> T {
        unsafe { T::from_usize(resolve_operand(self.op, &[])) }
    }

    /// Resolves the value as a pointer so it can be read/written as needed.
    ///
    /// Will panic if it is not possible to form a pointer to the value.
    /// (For example, if the value is defined as `Mem32[addr] ^ 0x12341234`)
    /// Because of that, it is preferable to use resolve/write instead of this
    /// where possible. (Write is not that much more flexible either at the moment,
    /// as it isn't necessary, but it could be improved if needed)
    unsafe fn resolve_as_ptr(&self) -> *mut T {
        unsafe {
            use scr_analysis::scarf::{MemAccessSize, OperandType};
            match self.op.ty() {
                OperandType::Memory(mem) => {
                    let expected_size = match mem::size_of::<T>() {
                        1 => MemAccessSize::Mem8,
                        2 => MemAccessSize::Mem16,
                        3..=4 => MemAccessSize::Mem32,
                        5..=8 => MemAccessSize::Mem64,
                        _ => panic!("Cannot form pointer to {}", self.op),
                    };
                    if mem.size != expected_size {
                        panic!("Cannot form pointer to {}", self.op);
                    }
                    let (base, offset) = mem.address();
                    let base = resolve_operand(base, &[]);
                    base.wrapping_add(offset as usize) as *mut T
                }
                _ => panic!("Cannot form pointer to {}", self.op),
            }
        }
    }

    /// Writes over the value.
    ///
    /// Note that most `Value`s that contain pointers point to statically
    /// allocated data in BW's memory, which cannot be overwritten.
    /// But the pointers obviously let writing over the pointed-to data,
    /// so it isn't necessary to use this function for them.
    ///
    /// (Unlike in 1.16.1, the Game/Player structures are dynamically allocated
    /// so their pointer could technically be changed. But there still isn't
    /// any reason to.)
    unsafe fn write(&self, value: T) {
        unsafe {
            use scr_analysis::scarf::{MemAccessSize, OperandType};
            let value = T::to_usize(value);
            match self.op.ty() {
                OperandType::Memory(mem) => {
                    let (base, offset) = mem.address();
                    let addr = resolve_operand(base, &[]).wrapping_add(offset as usize);
                    match mem.size {
                        MemAccessSize::Mem8 => *(addr as *mut u8) = value as u8,
                        MemAccessSize::Mem16 => (addr as *mut u16).write_unaligned(value as u16),
                        MemAccessSize::Mem32 => (addr as *mut u32).write_unaligned(value as u32),
                        MemAccessSize::Mem64 => (addr as *mut u64).write_unaligned(value as u64),
                    };
                }
                _ => panic!("Cannot write to {}", self.op),
            };
        }
    }
}

unsafe impl<T> Send for Value<T> {}
unsafe impl<T> Sync for Value<T> {}

unsafe fn resolve_operand(op: scarf::Operand<'_>, custom: &[usize]) -> usize {
    unsafe {
        use scr_analysis::scarf::{ArithOpType, MemAccessSize, OperandType};
        match *op.ty() {
            OperandType::Constant(c) => c as usize,
            OperandType::Memory(ref mem) => {
                let (base, offset) = mem.address();
                let addr = resolve_operand(base, custom).wrapping_add(offset as usize);
                if addr < 0x80 {
                    let val = read_fs_gs(addr);
                    match mem.size {
                        MemAccessSize::Mem8 => val & 0xff,
                        MemAccessSize::Mem16 => val & 0xffff,
                        #[allow(clippy::identity_op)] // only identity_op on x86
                        MemAccessSize::Mem32 => val & 0xffff_ffff,
                        MemAccessSize::Mem64 => val,
                    }
                } else {
                    match mem.size {
                        MemAccessSize::Mem8 => (addr as *const u8).read_unaligned() as usize,
                        MemAccessSize::Mem16 => (addr as *const u16).read_unaligned() as usize,
                        MemAccessSize::Mem32 => (addr as *const u32).read_unaligned() as usize,
                        MemAccessSize::Mem64 => (addr as *const u64).read_unaligned() as usize,
                    }
                }
            }
            OperandType::Arithmetic(ref arith) => {
                let left = resolve_operand(arith.left, custom);
                let right = resolve_operand(arith.right, custom);
                match arith.ty {
                    ArithOpType::Add => left.wrapping_add(right),
                    ArithOpType::Sub => left.wrapping_sub(right),
                    ArithOpType::Mul => left.wrapping_mul(right),
                    ArithOpType::Div => left / right,
                    ArithOpType::Modulo => left % right,
                    ArithOpType::And => left & right,
                    ArithOpType::Or => left | right,
                    ArithOpType::Xor => left ^ right,
                    ArithOpType::Lsh => left.wrapping_shl(right as u32),
                    ArithOpType::Rsh => left.wrapping_shr(right as u32),
                    ArithOpType::Equal => (left == right) as usize,
                    ArithOpType::GreaterThan => (left > right) as usize,
                    _ => panic!("Unimplemented resolve: {op}"),
                }
            }
            OperandType::Custom(id) => custom
                .get(id as usize)
                .copied()
                .unwrap_or_else(|| panic!("Resolve needs custom id {id}")),
            _ => panic!("Unimplemented resolve: {op}"),
        }
    }
}

struct LinkedList<T> {
    start: Value<*mut T>,
    end: Value<*mut T>,
}

impl<T> LinkedList<T> {
    pub unsafe fn resolve(&self) -> bw::list::LinkedList<T> {
        unsafe {
            bw::list::LinkedList {
                start: self.start.resolve_as_ptr(),
                end: self.end.resolve_as_ptr(),
            }
        }
    }
}

pub enum BwInitError {
    AnalysisFail(&'static str),
    UnsupportedVersion(u32),
}

impl From<&'static str> for BwInitError {
    fn from(val: &'static str) -> BwInitError {
        BwInitError::AnalysisFail(val)
    }
}

impl BwScr {
    /// On failure returns a description of address that couldn't be found
    pub fn new() -> Result<BwScr, BwInitError> {
        let binary = unsafe {
            let base = GetModuleHandleW(null()) as *const u8;
            let text = pe_image::get_section(base, b".text\0\0\0").unwrap();
            let rdata = pe_image::get_section(base, b".rdata\0\0").unwrap();
            let data = pe_image::get_section(base, b".data\0\0\0").unwrap();
            let reloc = pe_image::get_section(base, b".reloc\0\0").unwrap();
            #[cfg(target_arch = "x86_64")]
            let pdata = pe_image::get_section(base, b".pdata\0\0").unwrap();

            #[cfg(target_arch = "x86")]
            let sections = vec![pe_image::get_pe_header(base), text, rdata, data, reloc];
            #[cfg(target_arch = "x86_64")]
            let sections = vec![
                pe_image::get_pe_header(base),
                text,
                rdata,
                data,
                pdata,
                reloc,
            ];

            let base = VirtualAddress(base as _);
            #[allow(unused_mut)] // As mutation is needed only on the cfg(x86) part
            let mut binary = scarf::raw_bin(base, sections);
            #[cfg(target_arch = "x86")]
            {
                let relocs =
                    scarf::analysis::find_relocs::<scarf::ExecutionStateX86<'_>>(&binary).unwrap();
                binary.set_relocs(relocs);
            }
            binary
        };
        let exe_build = get_exe_build();
        info!("StarCraft build {exe_build}");
        // We probably would be able to support some older versions too, but require at least the
        // initial 1.23.9 patch (1.23.9.9899, from July 2021).
        if exe_build < 9899 {
            return Err(BwInitError::UnsupportedVersion(exe_build));
        }

        let analysis_ctx = scarf::OperandContext::new();
        let mut analysis = scr_analysis::Analysis::new(&binary, &analysis_ctx);

        let ctx: scarf::OperandCtx<'static> = Box::leak(Box::new(scarf::OperandContext::new()));
        let game = analysis.game().ok_or("Game")?;
        let game_data = analysis.game_data().ok_or("Game Data")?;
        let players = analysis.players().ok_or("Players")?;
        let pathing = analysis.pathing().ok_or("Pathing")?;
        let init_network_player_info = analysis
            .init_net_player()
            .ok_or("init_network_player_info")?;
        let storm_player_flags = analysis.net_player_flags().ok_or("Storm player flags")?;
        let step_network = analysis.step_network().ok_or("step_network")?;
        let lobby_state = analysis.lobby_state().ok_or("Lobby state")?;
        let is_multiplayer = analysis.is_multiplayer().ok_or("is_multiplayer")?;
        let select_map_entry = analysis.select_map_entry().ok_or("select_map_entry")?;
        let game_state = analysis.game_state().ok_or("Game state")?;
        let rng_seed = analysis.rng_seed().ok_or("RNG seed")?;
        let sc_main = analysis.sc_main();
        let mainmenu_entry_hook = analysis.mainmenu_entry_hook().ok_or("Entry hook")?;
        let game_loop = analysis.game_loop().ok_or("Game loop")?;
        let init_sprites = analysis.load_images().ok_or("Init sprites")?;
        let init_real_time_lighting = analysis.init_real_time_lighting();
        let sprites_inited = analysis.images_loaded().ok_or("Sprites inited")?;
        let init_game_network = analysis.init_game_network().ok_or("Init game network")?;
        let process_lobby_commands = analysis
            .process_lobby_commands()
            .ok_or("Process lobby commands")?;
        let send_command = analysis.send_command().ok_or("send_command")?;
        let local_player_id = analysis.local_player_id().ok_or("Local player id")?;
        let local_storm_id = analysis.local_storm_player_id().ok_or("Local storm id")?;
        let local_unique_player_id = analysis
            .local_unique_player_id()
            .ok_or("Local unique player id")?;
        let command_user = analysis.command_user().ok_or("Command user")?;
        let unique_command_user = analysis
            .unique_command_user()
            .ok_or("Unique command user")?;
        let storm_command_user = analysis.storm_command_user().ok_or("Storm command user")?;
        let net_user_latency = analysis.net_user_latency().ok_or("Net user latency")?;
        let net_player_to_game = analysis.net_player_to_game().ok_or("Net player to game")?;
        let net_player_to_unique = analysis
            .net_player_to_unique()
            .ok_or("Net player to unique")?;
        let choose_snp = analysis.choose_snp().ok_or("choose_snp")?;
        let local_player_name = analysis.local_player_name().ok_or("Local player name")?;
        let first_active_unit = analysis.first_active_unit().ok_or("first_active_unit")?;
        let init_storm_networking = analysis
            .init_storm_networking()
            .ok_or("init_storm_networking")?;
        let load_snp_list = analysis.load_snp_list().ok_or("load_snp_list")?;
        let start_udp_server = analysis.start_udp_server().ok_or("start_udp_server")?;
        let lobby_create_callback_offset = analysis
            .create_game_dialog_vtbl_on_multiplayer_create()
            .ok_or("Lobby create callback vtable offset")?;
        let process_events = analysis.process_events().ok_or("process_events")?;
        let process_game_commands = analysis.process_commands().ok_or("process_game_commands")?;
        let game_command_lengths = analysis.command_lengths();
        let snet_recv_packets = analysis.snet_recv_packets().ok_or("snet_recv_packets")?;
        let snet_send_packets = analysis.snet_send_packets().ok_or("snet_send_packets")?;
        let step_io = analysis.step_io().ok_or("step_io")?;
        let init_game_data = analysis.init_game().ok_or("init_game_data")?;
        let init_unit_data = analysis.init_units().ok_or("init_unit_data")?;
        let step_replay_commands = analysis
            .step_replay_commands()
            .ok_or("step_replay_commands")?;
        let order_harvest_gas = analysis.order_harvest_gas().ok_or("order_harvest_gas")?;

        let step_game = analysis.step_game().ok_or("step_game")?;
        let free_orders = LinkedList {
            start: Value::new(ctx, analysis.first_free_order().ok_or("first_free_order")?),
            end: Value::new(ctx, analysis.last_free_order().ok_or("last_free_order")?),
        };

        let replay_data = analysis.replay_data().ok_or("replay_data")?;
        let replay_header = analysis.replay_header().ok_or("replay_header")?;
        let trigger_execution_timer = analysis
            .trigger_execution_timer()
            .ok_or("trigger_execution_timer")?;
        let enable_rng = analysis.enable_rng().ok_or("Enable RNG")?;
        let allocator = analysis.allocator().ok_or("allocator")?;
        let allocated_order_count = analysis
            .allocated_order_count()
            .ok_or("allocated_order_count")?;
        let order_limit = analysis.order_limit().ok_or("order_limit")?;
        let replay_bfix = analysis.replay_bfix();
        let replay_gcfg = analysis.replay_gcfg();
        let prepare_issue_order = analysis
            .prepare_issue_order()
            .ok_or("prepare_issue_order")?;
        let create_game_multiplayer = analysis
            .create_game_multiplayer()
            .ok_or("create_game_multiplayer")?;
        let spawn_dialog = analysis.spawn_dialog().ok_or("spawn_dialog")?;
        let step_game_logic = analysis.step_game_logic().ok_or("step_game_logic")?;
        let anti_troll = analysis.anti_troll();
        let snet_local_player_list = analysis.snet_local_player_list();
        let units = analysis.units().ok_or("units")?;
        // Non-fatal, like the terrain below: both only add to the minimap on the stats page.
        let kill_unit = analysis.kill_unit();
        if kill_unit.is_none() {
            warn!("Could not find kill_unit");
        }
        let terrain = match (
            analysis.tileset_indexed_map_tiles(),
            analysis.creep_original_tiles(),
            analysis.tileset_cv5(),
            analysis.tileset_vx4ex(),
            analysis.minitile_graphics(),
        ) {
            (
                Some(map_tiles),
                Some(creep_original_tiles),
                Some(tileset_cv5),
                Some(tileset_vx4ex),
                Some(minitile_graphics),
            ) => Some(TerrainValues {
                map_tiles: Value::new(ctx, map_tiles),
                creep_original_tiles: Value::new(ctx, creep_original_tiles),
                tileset_cv5: Value::new(ctx, tileset_cv5),
                tileset_vx4ex: Value::new(ctx, tileset_vx4ex),
                minitile_graphics: Value::new(ctx, minitile_graphics),
            }),
            _ => {
                warn!("Could not find the terrain globals");
                None
            }
        };

        let main_palette = analysis.main_palette().ok_or("main_palette")?;
        let move_unit = analysis.move_unit().ok_or("move_unit")?;
        let render_screen = analysis.render_screen().ok_or("render_screen")?;

        let starcraft_tls_index = analysis.get_tls_index().ok_or("TLS index")?;

        let open_file = analysis
            .file_hook()
            .ok_or("open_file (Required due to SB_NO_HD)")?;

        init_bw_dat(&mut analysis)?;

        debug!("Found all necessary BW data");

        Ok(BwScr {
            game: Value::new(ctx, game),
            game_data: Value::new(ctx, game_data),
            players: Value::new(ctx, players),
            pathing: Value::new(ctx, pathing),
            storm_player_flags: Value::new(ctx, storm_player_flags),
            lobby_state: Value::new(ctx, lobby_state),
            is_multiplayer: Value::new(ctx, is_multiplayer),
            game_state: Value::new(ctx, game_state),
            sprites_inited: Value::new(ctx, sprites_inited),
            local_player_id: Value::new(ctx, local_player_id),
            local_unique_player_id: Value::new(ctx, local_unique_player_id),
            local_storm_id: Value::new(ctx, local_storm_id),
            command_user: Value::new(ctx, command_user),
            unique_command_user: Value::new(ctx, unique_command_user),
            storm_command_user: Value::new(ctx, storm_command_user),
            rng_seed: Value::new(ctx, rng_seed),
            net_user_latency: Value::new(ctx, net_user_latency),
            net_player_to_game: Value::new(ctx, net_player_to_game),
            net_player_to_unique: Value::new(ctx, net_player_to_unique),
            local_player_name: Value::new(ctx, local_player_name),
            first_active_unit: Value::new(ctx, first_active_unit),
            replay_data: Value::new(ctx, replay_data),
            replay_header: Value::new(ctx, replay_header),
            trigger_execution_timer: Value::new(ctx, trigger_execution_timer),
            enable_rng: Value::new(ctx, enable_rng),
            allocator: Value::new(ctx, allocator),
            allocated_order_count: Value::new(ctx, allocated_order_count),
            order_limit: Value::new(ctx, order_limit),
            units: Value::new(ctx, units),
            main_palette: Value::new(ctx, main_palette),
            kill_unit,
            terrain,
            replay_bfix: replay_bfix.map(move |x| Value::new(ctx, x)),
            replay_gcfg: replay_gcfg.map(move |x| Value::new(ctx, x)),
            anti_troll: anti_troll.map(move |x| Value::new(ctx, x)),
            snet_local_player_list: snet_local_player_list.map(move |x| Value::new(ctx, x)),
            free_orders,
            init_network_player_info: unsafe { mem::transmute(init_network_player_info.0) },
            step_network: unsafe { mem::transmute(step_network.0) },
            select_map_entry: unsafe { mem::transmute(select_map_entry.0) },
            game_loop: unsafe { mem::transmute(game_loop.0) },
            init_sprites: unsafe { mem::transmute(init_sprites.0) },
            init_real_time_lighting: unsafe {
                init_real_time_lighting.map(|x| mem::transmute(x.0))
            },
            init_game_network: unsafe { mem::transmute(init_game_network.0) },
            process_lobby_commands: unsafe { mem::transmute(process_lobby_commands.0) },
            send_command: unsafe { mem::transmute(send_command.0) },
            choose_snp: unsafe { mem::transmute(choose_snp.0) },
            init_storm_networking: unsafe { mem::transmute(init_storm_networking.0) },
            snet_recv_packets: unsafe { mem::transmute(snet_recv_packets.0) },
            snet_send_packets: unsafe { mem::transmute(snet_send_packets.0) },
            process_events: unsafe { mem::transmute(process_events.0) },
            process_game_commands: unsafe { mem::transmute(process_game_commands.0) },
            move_unit: Thiscall::foreign(move_unit.0 as usize),
            render_screen: unsafe { mem::transmute(render_screen.0) },
            load_snp_list,
            start_udp_server,
            sc_main,
            mainmenu_entry_hook,
            open_file,
            lobby_create_callback_offset,
            step_replay_commands,
            order_harvest_gas,
            step_game,
            step_io,
            init_game_data,
            init_unit_data,
            game_command_lengths,
            prepare_issue_order,
            create_game_multiplayer,
            spawn_dialog,
            step_game_logic,
            starcraft_tls_index: SendPtr(starcraft_tls_index),
            is_replay_seeking: AtomicBool::new(false),
            lobby_game_init_command_seen: AtomicBool::new(false),
            disable_hd: AtomicBool::new(false),
            is_carbot: AtomicBool::new(false),
            show_skins: AtomicBool::new(false),
            is_processing_game_commands: AtomicBool::new(false),
            dropped_players: AtomicU32::new(0),
            settings_file_path: RwLock::new(String::new()),
            detection_status_copy: Mutex::new(Vec::new()),
            game_stats: RecurseCheckedMutex::new(None),
            game_started: AtomicBool::new(false),
            game_end_reported: AtomicBool::new(false),
            first_game_logic_frame_done: AtomicBool::new(false),
            event_processing_lock: DumbSpinLock::new(),
        })
    }

    pub unsafe fn patch_game(&'static self, image: *mut u8) {
        unsafe {
            use self::hooks::*;
            debug!("Patching SCR");
            let base = GetModuleHandleW(null()) as *mut _;
            let mut active_patcher = crate::PATCHER.lock();
            let mut exe = active_patcher.patch_memory(image as *mut _, base, 0);
            let base = base as usize;

            if let Some(sc_main) = self.sc_main {
                // This is a hook at early point during program startup, some initial
                // settings have been done already though.
                // Just used for checking if documents path is somehow unaccessible,
                // as this is right after BW does it's own checks for it.
                // mainmenu_entry_hook is further into this same function.
                //
                // Update: Now that we hook SHGetFolderPathW anyway maybe this hook
                // is pretty redundant, probably should be deleted once we're sure it
                // won't give any extra information.
                let address = sc_main.0 as usize - base;
                exe.hook_closure_address(
                    ScMain,
                    move |orig| {
                        check_documents_starcraft_path_accessibility();
                        orig();
                    },
                    address,
                );
            }

            let address = self.mainmenu_entry_hook.0 as usize - base;
            exe.call_hook_closure_address(
                GameInit,
                move |_| {
                    debug!("SCR game init hook");
                    crate::process_init_hook();
                },
                address,
            );

            let address = self.load_snp_list.0 as usize - base;
            exe.hook_closure_address(LoadSnpList, load_snp_list_hook, address);
            // The UDP server seems to be just Bonjour stuff, which we don't use.
            let address = self.start_udp_server.0 as usize - base;
            exe.hook_closure_address(StartUdpServer, |_, _| 1, address);

            let address = self.process_game_commands as usize - base;
            exe.hook_closure_address(
                ProcessGameCommands,
                move |data, len, are_recorded_replay_commands, orig| {
                    let command_user = self.command_user.resolve();
                    let unique_command_user = self.unique_command_user.resolve();
                    let is_replay = game_thread::is_replay();
                    let is_observer = command_user >= 128;
                    let slice = std::slice::from_raw_parts(data, len);
                    let slice = commands::filter_invalid_commands(
                        slice,
                        are_recorded_replay_commands != 0,
                        is_observer,
                        &self.game_command_lengths,
                    );
                    let mut sync_seen = false;
                    let mut alliance_or_vision_seen = false;
                    {
                        for command in commands::iter_commands(&slice, &self.game_command_lengths) {
                            if !is_replay || are_recorded_replay_commands != 0 {
                                crate::game_stats::record_command(
                                    unique_command_user as u8,
                                    command,
                                );
                            }
                            match command {
                                [commands::id::REPLAY_SEEK, rest @ ..] if rest.len() == 4
                                    && are_recorded_replay_commands == 0 => {
                                        let frame = LittleEndian::read_u32(rest);
                                        let game = self.game();
                                        if (*game).frame_count > frame {
                                            self.is_replay_seeking.store(true, Ordering::Relaxed);
                                        }
                                    }
                                [commands::id::SYNC, ..] | [commands::id::NOP, ..]
                                    if are_recorded_replay_commands == 0 => {
                                        sync_seen = true;
                                    }
                                // Vision/alliance toggles are rare, and whether the native
                                // handlers accept them depends on guards that differ between
                                // live games and replay playback (a rejected toggle still gets
                                // recorded). Log each one plus the state it leaves behind so
                                // that difference is visible in the logs of both.
                                [commands::id::VISION, ..] | [commands::id::ALLIANCE, ..] => {
                                    alliance_or_vision_seen = true;
                                    debug!(
                                        "Alliance/vision command from game player \
                                        {command_user} (unique {unique_command_user}, \
                                        already-recorded {are_recorded_replay_commands}, \
                                        replay {is_replay}): {command:02x?}"
                                    );
                                }
                                _ => (),
                            }
                        }
                    }

                    if !is_replay
                        && let Some(players) = self.check_player_drops() {
                            let frame = (*self.game()).frame_count;
                            let turn_seq = self.snet_next_turn_sequence_number().wrapping_sub(1);
                            info!(
                                "Dropped players {:?} at some point between last check and before \
                            handling commands for game player {} net {}. Game frame 0x{:x}, \
                            turn seq {}",
                                players,
                                command_user,
                                self.storm_command_user.resolve(),
                                frame,
                                turn_seq,
                            );
                        }
                    // There should be no way this is called recursively, but even still
                    // handle that case by keeping track of was_processing.
                    let was_processing = self.is_processing_game_commands.load(Ordering::Relaxed);
                    self.is_processing_game_commands
                        .store(true, Ordering::Relaxed);
                    orig(slice.as_ptr(), slice.len(), are_recorded_replay_commands);
                    self.is_processing_game_commands
                        .store(was_processing, Ordering::Relaxed);
                    if alliance_or_vision_seen && (command_user as usize) < 12 {
                        let game = self.game();
                        debug!(
                            "Post-command alliances for player {command_user}: {:?}, \
                            visions {:#x}",
                            (*game).alliances[command_user as usize],
                            (*game).visions[command_user as usize],
                        );
                    }
                    if !is_replay {
                        if !sync_seen {
                            if is_observer {
                                // Observers don't send sync commands correctly.
                                // Send no-op command 0x05 which counts as a correct sync to
                                // prevent them from dropping.
                                //
                                // SC:R's setup has observers with storm id >= 128,
                                // for which process_game_commands is not called at all.
                                // Our setup uses "normal" storm ids for observers, as that
                                // makes allocating storm ids during launch simpler, but will
                                // require doing this (As well as filtering out almost all
                                // commands the observer sends)
                                orig(&5u8, 1, 0);
                            } else {
                                let storm_user = self.storm_command_user.resolve();
                                // The mask has one bit per storm player; an out-of-range id here
                                // means sender identity is corrupt, which shifting by it would
                                // turn into an overflow panic on top of the actual problem.
                                if storm_user < bw::MAX_STORM_PLAYERS as u32 {
                                    self.dropped_players.store(
                                        self.dropped_players.load(Ordering::Relaxed)
                                            | (1 << storm_user),
                                        Ordering::Relaxed,
                                    );
                                }
                                info!(
                                    "Didn't see sync command for game player {command_user} net {storm_user}, {slice:02x?}, \
                                they will be dropped",
                                );
                            }
                        }
                        if let Some(players) = self.check_player_drops() {
                            let frame = (*self.game()).frame_count;
                            let turn_seq = self.snet_next_turn_sequence_number().wrapping_sub(1);
                            info!(
                                "Dropped players {:?} while handling commands for game player {} \
                            net {}, {:02x?}. Game frame 0x{:x}, turn seq {}",
                                players,
                                command_user,
                                self.storm_command_user.resolve(),
                                slice,
                                frame,
                                turn_seq,
                            );
                        }
                    }
                },
                address,
            );
            let address = self.step_io.0 as usize - base;
            exe.hook_closure_address(
                StepIo,
                move |scheduler, orig| {
                    orig(scheduler);
                    // BW actually only calls these in a case which would be equivalent with our SNP
                    // code calling receive_callback() (Which is nop in SCR for now), but these
                    // are cheap enough to always call. It may also be slightly better on
                    // unreliable networks as this sends packets every frame instead of every
                    // time a packets are received in a frame.
                    //
                    // Still need to check that the SNP is ready BW side.
                    //
                    // A replay still creates a local Storm session, so the chosen SNP provider
                    // initializes and Storm's own lobby tick keeps running: this pump drives that
                    // tick's flush + receive. The SNP provider itself only ever moves bytes into
                    // the inert stubs.
                    if SNP_INITIALIZED.load(Ordering::Relaxed) {
                        (self.snet_recv_packets)();
                        (self.snet_send_packets)();
                    }
                },
                address,
            );
            let address = self.process_lobby_commands as usize - base;
            exe.hook_closure_address(
                ProcessLobbyCommands,
                move |data, len, player, orig| {
                    let slice = std::slice::from_raw_parts(data, len);
                    // Anything other than a bare 1-byte 0x05 keep-alive is rare during lobby, so
                    // log it: the command byte, sender, and the lobby_state it arrives into (a
                    // 0x69 slot-setup resets lobby_state to 4, stomping a hand-written 8).
                    if slice.len() > 1 || slice.first() != Some(&5) {
                        debug!(
                            "Lobby command {:02x?} from player {} at lobby_state {}",
                            &slice[..slice.len().min(16)],
                            player,
                            self.lobby_state.resolve(),
                        );
                    }
                    if let Some(&byte) = slice.first()
                        && byte == bw::LOBBY_GAME_INIT_COMMAND
                        && player == 0
                    {
                        let seq = self.snet_next_turn_sequence_number();
                        // I think that the sequence number for next turn gets incremented
                        // before reaching this point, so subtract one to get current
                        // turn.
                        debug!(
                            "Lobby game init command seen at turn seq {}",
                            seq.wrapping_sub(1),
                        );
                        self.lobby_game_init_command_seen
                            .store(true, Ordering::Relaxed);
                    }
                    orig(data, len, player);
                },
                address,
            );
            let address = self.step_game.0 as usize - base;
            exe.hook_closure_address(
                StepGame,
                move |orig| {
                    orig();
                    game_thread::after_step_game();
                },
                address,
            );
            let address = self.init_game_data.0 as usize - base;
            exe.hook_closure_address(
                InitGameData,
                move |orig| {
                    let ok = log_time("init_game_data", || orig());
                    if ok == 0 {
                        error!("init_game_data failed");
                        return 0;
                    }
                    if let Some(anti_troll) = self.anti_troll {
                        (*anti_troll.resolve()).active = 0;
                    }
                    self.restore_observer_id_mappings();
                    game_thread::after_init_game_data();
                    1
                },
                address,
            );
            let address = self.init_unit_data.0 as usize - base;
            exe.hook_closure_address(
                InitUnitData,
                move |orig| {
                    game_thread::before_init_unit_data(self);
                    log_time("init_unit_data", || orig());
                },
                address,
            );
            let address = self.step_replay_commands.0 as usize - base;
            exe.hook_closure_address(
                StepReplayCommands,
                |orig| {
                    game_thread::step_replay_commands(orig);
                },
                address,
            );
            let address = self.order_harvest_gas.0 as usize - base;
            exe.hook_closure_address(
                OrderFn,
                |unit, orig| {
                    game_thread::order_harvest_gas(self, unit, orig);
                },
                address,
            );
            if let Some(kill_unit) = self.kill_unit {
                let address = kill_unit.0 as usize - base;
                exe.hook_closure_address(
                    KillUnit,
                    |unit, orig| {
                        if let Some(unit) = Unit::from_ptr(unit) {
                            game_stats::unit_killed(unit);
                        }
                        orig(unit);
                    },
                    address,
                );
            }

            let address = self.open_file.0 as usize - base;
            exe.hook_closure_address(
                OpenFile,
                move |a, b, c, orig| file_hook::open_file_hook(self, a, b, c, orig),
                address,
            );

            #[cfg(target_arch = "x86")]
            let prepare_issue_order_hook =
                move |unit, order, xy, target, fow, clear_queue, _orig| {
                    let unit = match Unit::from_ptr(unit) {
                        Some(s) => s,
                        None => return,
                    };
                    let order = bw_dat::OrderId(order as u8);
                    let x = xy as i16;
                    let y = (xy >> 16) as i16;
                    let target = Unit::from_ptr(target);
                    let fow = fow as u16;
                    let clear_queue = clear_queue != 0;

                    game::prepare_issue_order(self, unit, order, x, y, target, fow, clear_queue);
                };

            #[cfg(target_arch = "x86_64")]
            let prepare_issue_order_hook =
                move |unit, order, target: *mut bw::PointAndUnit, fow, clear_queue, _orig| {
                    let unit = match Unit::from_ptr(unit) {
                        Some(s) => s,
                        None => return,
                    };
                    let order = bw_dat::OrderId(order as u8);
                    let x = (*target).pos.x;
                    let y = (*target).pos.y;
                    let target = Unit::from_ptr((*target).unit);
                    let fow = fow as u16;
                    let clear_queue = clear_queue != 0;

                    game::prepare_issue_order(self, unit, order, x, y, target, fow, clear_queue);
                };

            let address = self.prepare_issue_order.0 as usize - base;
            exe.hook_closure_address(PrepareIssueOrder, prepare_issue_order_hook, address);

            let address = self.create_game_multiplayer.0 as usize - base;
            exe.hook_closure_address(
                CreateGameMultiplayer,
                move |info, name, password, map_path, a5, a6, a7, a8, orig| {
                    // Logging these params just to have some more context if ever needed.
                    // (This is a 16-byte struct passed by value)
                    let unk0 = a5;
                    let turn_rate = a6;
                    let is_bnet_matchmaking = a7 & 0xff;
                    let unk9 = (a7 >> 8) & 0xff;
                    let old_game_limits = (a7 >> 16) & 0xff;
                    let eud = (a7 >> 24) & 0xff;
                    let dynamic_turn_rate = a8;
                    info!(
                        "Called create_game_multiplayer, game params {unk0} {turn_rate} {is_bnet_matchmaking} {unk9} {old_game_limits} {eud} {dynamic_turn_rate}",
                    );
                    // This value is originally set to how many human player starting locations
                    // there are; set it to the slot count so observers fit too.
                    (*info).max_player_count = game_thread::setup_info().unwrap().slots.len() as u8;
                    orig(info, name, password, map_path, a5, a6, a7, a8)
                },
                address,
            );

            let address = self.spawn_dialog.0 as usize - base;
            exe.hook_closure_address(
                SpawnDialog,
                |a, b, c, o| dialog_hook::spawn_dialog_hook(a, b, c, o),
                address,
            );

            let address = self.step_game_logic.0 as usize - base;
            exe.hook_closure_address(
                StepGameLogic,
                move |a, o| step_game_logic_hook(self, a, o),
                address,
            );

            let create_file_hook_closure =
                move |a, b, c, d, e, f, g, o| create_file_hook(self, a, b, c, d, e, f, g, o);
            let get_file_attributes_closure = move |a, o| get_file_attributes_hook(self, a, o);

            let init_time = Instant::now();
            let init_tick_count = winapi::um::sysinfoapi::GetTickCount();
            let get_tick_count_hook = move |_orig: unsafe extern "C" fn() -> u32| {
                // BW uses GetTickCount for a lot of things that should really have better than
                // 16ms resolution, so we hook this to give them a better timer. In practice this
                // improves the reliability of turn timing, and maybe other things

                // We add the initial tick count here because some other Windows APIs
                // (notably GetMessageTime) return values that are expected to be in the same range.
                // Without doing this, SC:R will discard some otherwise valid events and make it so
                // things like keypresses take multiple presses to achieve one action.
                (init_time.elapsed().as_millis() as u32).wrapping_add(init_tick_count)
            };
            drop(exe);
            hook_winapi_exports!(&mut active_patcher, "kernel32",
                "CreateEventW", CreateEventW, create_event_hook;
                "CreateFileW", CreateFileW, create_file_hook_closure;
                "GetFileAttributesW", GetFileAttributesW, get_file_attributes_closure;
                "GetTickCount", GetTickCount, get_tick_count_hook;
                "GetSystemTimePreciseAsFileTime", GetSystemTimePreciseAsFileTime, get_system_time_precise_as_file_time_hook;
            );
            hook_winapi_exports!(&mut active_patcher, "shell32",
                "SHGetFolderPathW", SHGetFolderPathW, sh_get_folder_path_w_hook;
            );

            // SCR wants to update gamepad state every frame, but in the end it
            // won't do any with it anyway. The query isn't completely free,
            // so dummy it out to let game spend time on better things.
            //
            // Note: This patch gets only applied if the DLL is already loaded,
            // so that we don't end up loading the DLL for no reason if a future
            // patch stops using this function.
            if windows::module_handle("xinput9_1_0").is_some() {
                let xinput_get_state_hook =
                    |_, _, _| winapi::shared::winerror::ERROR_DEVICE_NOT_CONNECTED;
                hook_winapi_exports!(&mut active_patcher, "xinput9_1_0",
                    "XInputGetState", XInputGetState, xinput_get_state_hook;
                );
            }
            crate::forge::init_hooks_scr(&mut active_patcher);
            debug!("Patched.");
        }
    }

    /// Seeks the replay being played to `frame`, the way dragging the replay timeline does. Does
    /// nothing outside of a replay, where running a command for only this client would desync it.
    pub unsafe fn seek_replay(&self, frame: u32) {
        if !game_thread::is_replay() {
            return;
        }
        let mut command = [commands::id::REPLAY_SEEK, 0, 0, 0, 0];
        command[1..].copy_from_slice(&frame.to_le_bytes());
        unsafe { (self.process_game_commands)(command.as_ptr(), command.len(), 0) }
    }

    /// Stats tracked over the current game; see [`game_stats`](crate::game_stats).
    pub fn game_stats(&self) -> &RecurseCheckedMutex<Option<GameStatsTracker>> {
        &self.game_stats
    }

    /// Resolves a BW storm id to its `players[]` index: player slots `0..8` and observer slots
    /// `12..16` (ids 0x80-0x83). The intervening `8..12` are neutral/special slots that never carry
    /// a session storm id and are deliberately skipped. This is the mapping used to attribute a
    /// command — chat or replayed — to its author. Returns `None` if no slot currently holds the
    /// storm id (e.g. the player already left).
    unsafe fn unique_player_for_storm(&self, storm_player: StormPlayerId) -> Option<u8> {
        unsafe {
            let players = self.players();
            (0..8)
                .chain(12..16)
                .find(|&i| (*players.add(i)).storm_id as u8 == storm_player.0)
                .map(|s| s as u8)
        }
    }

    /// The value to write to `command_user` for a command injected under the sender's `players[]`
    /// index (from [`unique_player_for_storm`](Self::unique_player_for_storm)). In a team game a
    /// normal player's commands run under that team's main player; otherwise it is the sender's own
    /// `players[]` index.
    ///
    /// For an observer this stays the raw `players[]` index (12..15), NOT the out-of-band game
    /// player id (0x80..0x83): the [`ProcessGameCommands`] hook classifies any `command_user >= 128`
    /// as an observer turn and strips all but a few command ids from it (chat among those removed),
    /// so writing the 0x80-ranged id here would drop the very command being injected. Attribution
    /// still uses the 0x80-ranged id where it belongs — the chat *record's* sender byte, which the
    /// native renderer reads — via [`game_player_id_for_slot`] in
    /// [`inject_chat_message`](Self::inject_chat_message).
    unsafe fn command_game_player(&self, unique_player: u8) -> u8 {
        unsafe {
            if game_thread::is_team_game() && !BwPlayerId(unique_player).is_observer() {
                let players = self.players();
                // Teams start from 1
                let team = (*players.add(unique_player as usize)).team;
                (*self.game()).team_game_main_player[team as usize - 1]
            } else {
                unique_player
            }
        }
    }

    /// Triggers the game to process any events (such as Windows messages, sound playback, etc.).
    /// Typically the game will call this itself as part of stepping the game loop, but this may
    /// need to be manually called during initialization/shutdown.
    pub unsafe fn process_events(&self) {
        self.event_processing_lock.lock();
        unsafe {
            (self.process_events)(3);
        }
        self.event_processing_lock.unlock();
    }

    /// Unlocks the event processing lock when Windows has taken over our wndproc (i.e. for
    /// resizing or a context menu). Once that completes, `lock_event_processing_for_subwndproc`
    /// must be called to re-acquire the lock.
    pub unsafe fn unlock_event_processing_for_size_move_menu(&self) {
        self.event_processing_lock.unlock();
    }

    /// Locks the event processing lock when Windows has stopped taking over our wndproc (i.e. for
    /// resizing or a context menu), since afterwards we'll be back inside `process_events`.
    pub unsafe fn lock_event_processing_for_size_move_menu(&self) {
        self.event_processing_lock.lock();
    }

    /// Forces a redraw of the graphic layers. This should only be used during game initialization,
    /// as we don't provide the necessary extra functions to properly render an ingame UI.
    pub unsafe fn force_redraw_during_init(&self) {
        unsafe {
            (self.render_screen)(std::ptr::null_mut(), 0);
        }
    }

    /// Returns whether the game has started. This is thread-safe.
    pub fn has_game_started(&self) -> bool {
        self.game_started.load(Ordering::Acquire)
    }

    /// Sets that the game has started. This is thread-safe.
    pub fn set_game_started(&self) {
        self.game_started.store(true, Ordering::Release);
    }

    pub unsafe fn move_unit(&self, unit: Unit, pos: &bw::Point) {
        self.move_unit.call3(*unit, pos.x as i32, pos.y as i32)
    }

    unsafe fn update_nation_and_human_ids(&self) {
        unsafe {
            let net_player_to_game = self.net_player_to_game.resolve();
            let net_player_to_unique = self.net_player_to_unique.resolve();
            let local_storm_id = self.local_storm_id.resolve();
            let players = self.players.resolve();
            for i in 0..NET_PLAYER_COUNT {
                *net_player_to_unique.add(i) = 8;
                *net_player_to_game.add(i) = 8;
            }
            // 0..8 are normal player slots, 8..12 can be used by UMS, 12..16 are observers
            for i in 0..16 {
                let player = players.add(i);
                let storm_id = (*player).storm_id;

                debug!(
                    "Slot {} has id {}, player_type {}, storm_id {}",
                    i,
                    (*player).id,
                    (*player).player_type,
                    (*player).storm_id
                );
                if matches!(
                    (*player).player_type,
                    bw::PLAYER_TYPE_HUMAN | bw::PLAYER_TYPE_OBSERVER
                ) {
                    assert!(storm_id < 16);
                    let game_id = match i < 12 {
                        true => i,
                        false => 128 + (i - 12),
                    };
                    *net_player_to_game.add(storm_id as usize) = game_id as u32;
                    *net_player_to_unique.add(storm_id as usize) = game_id as u32;
                    if storm_id == local_storm_id {
                        self.local_player_id.write(game_id as u32);
                        self.local_unique_player_id.write(game_id as u32);
                    }
                }
            }
        }
    }

    /// Re-asserts the observer slots' storm ids, the storm↔game id table entries derived from
    /// them, and the local ids, after game init.
    ///
    /// Observers hold ordinary storm ids, but BW's own convention gives observers out-of-band storm
    /// ids `0x80 + n`, and its game-start path renumbers an occupied observer slot (and, on the
    /// observer's own client, the local storm id) to that convention. Team-game init additionally
    /// rebuilds the storm↔game tables from per-team lobby data that describes only the 8 team
    /// slots, losing the observer entries written during the lobby phase. Either way the result is
    /// the same: an observer's commands resolve to the no-player id on everyone else, and the
    /// observer's own client loses its observer-ranged unique id and starts participating in sync
    /// as if it were a player. The storm ids each slot is supposed to hold are recorded at seating
    /// time in [`game_thread::OBSERVER_STORM_IDS`]; inits that change nothing get identical values
    /// rewritten, so this runs unconditionally.
    unsafe fn restore_observer_id_mappings(&self) {
        unsafe {
            let net_player_to_game = self.net_player_to_game.resolve();
            let net_player_to_unique = self.net_player_to_unique.resolve();
            let players = self.players.resolve();
            for (n, storm_id) in game_thread::OBSERVER_STORM_IDS.iter().enumerate() {
                let storm_id = storm_id.load(Ordering::Relaxed);
                let player = players.add(12 + n);
                if (*player).player_type != bw::PLAYER_TYPE_OBSERVER {
                    continue;
                }
                if storm_id >= NET_PLAYER_COUNT as u32 {
                    continue;
                }
                let game_id = 128 + n as u32;
                debug!(
                    "Restoring observer id mapping: storm {} -> game {} (slot had storm {}, table had {})",
                    storm_id,
                    game_id,
                    (*player).storm_id,
                    *net_player_to_game.add(storm_id as usize),
                );
                (*player).storm_id = storm_id;
                *net_player_to_game.add(storm_id as usize) = game_id;
                *net_player_to_unique.add(storm_id as usize) = game_id;
                let local_storm_id = self.local_storm_id.resolve();
                // The local client is this observer if its storm id matches — either still the
                // real one, or the renumbered value when init got to the local id too.
                if local_storm_id == storm_id || local_storm_id == game_id {
                    self.local_storm_id.write(storm_id);
                    self.local_player_id.write(game_id);
                    self.local_unique_player_id.write(game_id);
                }
            }
        }
    }

    unsafe fn storm_last_error_ptr(&self) -> *mut u32 {
        unsafe {
            // This just is starcraft.exe errno
            // dword [[fs:[2c] + tls_index * 4] + 4]
            let tls_index = *self.starcraft_tls_index.0;
            let table = read_fs_gs(0xb * mem::size_of::<usize>()) as *mut *mut u32;
            let tls_data = *table.add(tls_index as usize);
            tls_data.add(1)
        }
    }

    unsafe fn check_player_drops(&self) -> Option<Vec<u8>> {
        unsafe {
            let mut result = None;
            let mut dropped_players = self.dropped_players.load(Ordering::Relaxed);
            for (i, _) in self
                .storm_player_flags()
                .iter()
                .enumerate()
                .filter(|x| *x.1 == 0x1_0000)
            {
                if dropped_players & (1 << i) == 0 {
                    dropped_players |= 1 << i;
                    result.get_or_insert_with(Vec::new).push(i as u8);
                    self.dropped_players
                        .store(dropped_players, Ordering::Relaxed);
                }
            }
            result
        }
    }

    /// This function should reset any state that affects synced gameplay logic to what
    /// it is on game init.
    ///
    /// This is currently being called on as early as possible, before game_loop() call,
    /// but if any later additions need to initialize state based on BW state, it could
    /// be moved to be called at init_game_data, init_unit_data, or other later initialization
    /// hooks too.
    ///
    /// The only case where this may be called more than once is when the user
    /// seeks replay backwards and it has to be simulated from start over again, so
    /// we don't need to and shouldn't reset any network state.
    fn reset_state_for_game_init(&self) {
        self.detection_status_copy.lock().clear();
        self.first_game_logic_frame_done
            .store(false, Ordering::Relaxed);
        if let Some(mut game_stats) = self.game_stats.lock() {
            *game_stats = None;
        }
    }

    /// Sets [`game_end_reported`](Self::game_end_reported) atomically, returning whether the
    /// caller is the first to report the end of the game.
    pub fn trigger_game_end_reported(&self) -> bool {
        !self.game_end_reported.swap(true, Ordering::Relaxed)
    }

    pub fn pathing(&self) -> *mut bw::Pathing {
        unsafe { self.pathing.resolve() }
    }

    /// What the loaded map's terrain looks like, if it could be found.
    pub fn terrain(&self) -> Option<Terrain> {
        let values = self.terrain.as_ref()?;
        unsafe {
            let terrain = Terrain {
                tiles: values.map_tiles.resolve(),
                original_tiles: values.creep_original_tiles.resolve(),
                cv5: values.tileset_cv5.resolve(),
                vx4ex: values.tileset_vx4ex.resolve(),
                minitiles: values.minitile_graphics.resolve(),
                palette: self.main_palette.resolve(),
            };
            let found = !terrain.tiles.is_null()
                && !terrain.original_tiles.is_null()
                && !terrain.cv5.is_null()
                && !terrain.vx4ex.is_null()
                && !terrain.minitiles.is_null()
                && !terrain.palette.is_null();
            found.then_some(terrain)
        }
    }

    pub fn rng_seed(&self) -> u32 {
        unsafe {
            // TODO(tec27): add analysis for this instead
            let seed = self.rng_seed.resolve_as_ptr();
            seed.add(1).read_unaligned()
        }
    }

    pub fn snet_next_turn_sequence_number(&self) -> u16 {
        unsafe {
            if let Some(list) = self.snet_local_player_list {
                let list = list.resolve();
                let player = (*list).node.next;
                if player.addr() & 0x1 != 0 || player.addr() == 0 {
                    warn!("No local player connection for SNet???");
                    return u16::MAX;
                }
                // Class 2 are synced game commands
                (*player).next_seq_for_class[2]
            } else {
                u16::MAX
            }
        }
    }
}

impl bw::Bw for BwScr {
    fn set_settings(&self, settings: &Settings) {
        let is_carbot = settings
            .scr
            .get("selectedSkin")
            .and_then(|x| x.as_str())
            .unwrap_or_else(|| {
                warn!("settings.scr.selectedSkin was not set");
                ""
            })
            == "carbot";
        let show_skins = settings
            .scr
            .get("showBonusSkins")
            .and_then(|x| x.as_bool())
            .unwrap_or_else(|| {
                warn!("settings.scr.showBonusSkins was not set");
                true
            });
        let disable_hd = settings
            .local
            .get("disableHd")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);

        self.is_carbot.store(is_carbot, Ordering::Release);
        self.show_skins.store(show_skins, Ordering::Release);
        self.disable_hd.store(disable_hd, Ordering::Release);
        if disable_hd && settings.scr.get("hdGraphicsOn").and_then(|x| x.as_bool()) == Some(true) {
            // Obviously would be nice to have to have the app settings to notice this but
            // this check is trivial to add, and better than spending time on wondering why the
            // game crashed.
            panic!("Cannot disable HD and have HD graphics enabled at the same time");
        }

        let mut settings_file_path = self.settings_file_path.write();
        settings_file_path.clear();
        settings_file_path.push_str(&settings.settings_file_path);
    }

    unsafe fn run_game_loop(&self) {
        let turn_seq = self.snet_next_turn_sequence_number();
        debug!("Game loop running, turn seq {turn_seq}");
        unsafe {
            loop {
                self.reset_state_for_game_init();
                self.game_state.write(3); // Playing
                // SC:R warps the cursor to the renderer center as its game loop starts and again
                // (to the internal mouse position) when it processes the faked minimize from
                // `fix_clip_cursor`; both land inside game-loop init, after the loading screen has
                // handed off. Drop them until the first game-logic step (`step_game_logic_hook`
                // closes the gate); SB already placed the cursor at the handoff.
                crate::forge::suppress_scr_cursor_moves(true);
                (self.game_loop)();
                crate::forge::suppress_scr_cursor_moves(false);
                // Replay seeking exits game loop and sets a bool for it to restart,
                // we don't have access to that bool but we hook the replay seek
                // command and set our own
                if !self.is_replay_seeking.load(Ordering::Relaxed) {
                    break;
                }
                self.is_replay_seeking.store(false, Ordering::Relaxed);
            }
        }
    }

    unsafe fn clean_up_for_exit(&self) {
        // TODO
    }

    unsafe fn init_sprites(&self) {
        unsafe {
            log_time("init_sprites", || (self.init_sprites)());
            self.sprites_inited.write(1);
            if let Some(init_rtl) = self.init_real_time_lighting {
                log_time("init_real_time_lighting", || init_rtl());
            }
        }
    }

    /// Sends/receives packets and steps the network, returning whether or not the network could
    /// be stepped (i.e. false => no new turns available/network stall).
    unsafe fn maybe_receive_turns(&self) -> bool {
        self.event_processing_lock.lock();

        let ret = unsafe {
            // NOTE: This is actually not the same function that 1161 calls, but one
            // level higher that also ends up handling any received commands.
            // I think there was an issue where maybe_receive_turns was being inlined
            // in some patches, making it not ideal function for SCR.
            // Due to this being a function that does more, we have to do extra synchronization
            // with do_lobby_game_init + try_finish_lobby_game_init that 1161 doesn't need to do.
            //
            // For SCR-1161 crossplay we'd have to make this part consistent across games.
            // I think using 1161's function here is hard, but it would be better for load times,
            // as this synchronization can add extra few hundred milliseconds to loads.

            // Also call snet recv/send functions which we usually call in step_io hook.
            // In some points where we expect maybe_receive_turns to advance networking state
            // during lobby init, the main thread isn't running it's usual event loop that
            // would call step_io.
            // Hopefully this doesn't have thread safety issues when called from the async thread..
            // Since the main thread isn't running it's normal loop at all, it's probably fine.
            if SNP_INITIALIZED.load(Ordering::Relaxed) {
                (self.snet_recv_packets)();
                (self.snet_send_packets)();
                (self.step_network)() != 0
            } else {
                // The SNP provider initializes once native create/join runs (create_lobby /
                // create_game_multiplayer), which hasn't necessarily happened yet at every point
                // this is called — report progress rather than treat a not-yet-initialized SNP as
                // a stall.
                true
            }
        };

        self.event_processing_lock.unlock();
        ret
    }

    unsafe fn init_network_player_info(&self, storm_player_id: u32) {
        unsafe {
            (self.init_network_player_info)(storm_player_id, 0, 1, 5);
        }
    }

    unsafe fn ready_lobby_for_start(&self) {
        debug!("Readying lobby for start");
        unsafe {
            self.update_nation_and_human_ids();
            self.lobby_state.write(8);
        }
    }

    unsafe fn do_lobby_game_init(&self, seed: u32) {
        unsafe {
            // TODO(tec27): deal with player bytes if we ever allow save games
            let data = bw::lobby_game_init_record(seed);

            // handle_lobby_init_0x48 only accepts the lobby-init `0x48` record from storm id 0
            // (with lobby_state 8), and a replay's local session is always its own host, so it is
            // storm id 0. The ProcessLobbyCommands hook then trips lobby_game_init_command_seen,
            // and try_finish_lobby_game_init drives lobby_state → 9. Any other storm id would have
            // its record ignored, so lobby init could never finish.
            let local_storm_id = self.local_storm_id.resolve();
            if local_storm_id == 0 {
                debug!(
                    "Sending lobby game init data: {data:02x?} (seed {seed:#x}, lobby_state {})",
                    self.lobby_state.resolve(),
                );
                (self.send_command)(data.as_ptr(), data.len());
            } else {
                error!(
                    "Local storm id is {local_storm_id}, not 0, so BW would ignore the lobby game \
                    init record; lobby init can't finish"
                );
            }
        }
    }

    unsafe fn try_finish_lobby_game_init(&self) -> bool {
        unsafe {
            if self.lobby_game_init_command_seen.load(Ordering::Relaxed) {
                self.lobby_state.write(9);
                true
            } else {
                false
            }
        }
    }

    unsafe fn create_lobby(
        &self,
        map_path: &Path,
        map_info: &MapInfo,
        lobby_name: &str,
        options: LobbyOptions,
    ) -> Result<(), bw::LobbyCreateError> {
        unsafe {
            let mut game_input: scr::GameInput = mem::zeroed();
            init_bw_string(&mut game_input.name, lobby_name.as_bytes());
            init_bw_string(&mut game_input.password, b"");
            game_input.speed = 6;
            game_input.game_type_subtype = options.game_type.as_u32();
            game_input.turn_rate = options.turn_rate;
            if options.use_legacy_limits {
                game_input.old_limits = 1;
            }

            if options.game_type.is_ums() {
                let is_eud = match map_info {
                    MapInfo::Replay(_) => false,
                    MapInfo::Game(game_map) => game_map.map_data.is_eud,
                };
                if is_eud {
                    game_input.old_limits = 1;
                    game_input.eud = 1;
                }
            }

            let map_dir = match map_path.parent() {
                Some(s) => s.into(),
                None => {
                    warn!(
                        "Assuming map '{}' is in current working directory",
                        map_path.display()
                    );
                    match std::env::current_dir() {
                        Ok(o) => o,
                        Err(_) => return Err(bw::LobbyCreateError::MapNotFound),
                    }
                }
            };
            let map_dir = match map_dir.to_str() {
                Some(s) => s,
                None => return Err(bw::LobbyCreateError::MapNotFound),
            };
            let map_file = match map_path.file_name().and_then(|x| x.to_str()) {
                Some(s) => s,
                None => return Err(bw::LobbyCreateError::MapNotFound),
            };

            let mut map_dir: Vec<u8> = map_dir.as_bytes().into();
            if map_dir.last().cloned() != Some(b'\\') {
                // BW does just dir.append(filename), so dir must have a trailing backslash
                map_dir.push(b'\\');
            }

            let mut entry: scr::MapDirEntry = mem::zeroed();
            init_bw_string(&mut entry.filename, map_file.as_bytes());
            init_bw_string(&mut entry.title, b"");
            init_bw_string(&mut entry.description, b"");
            init_bw_string(&mut entry.error_message, b"");
            init_bw_string(&mut entry.unk90, b"");
            init_bw_string(&mut entry.unkac, b"");
            init_bw_string(&mut entry.unkc8, b"");
            init_bw_string(&mut entry.path_directory, &map_dir);
            init_bw_string(&mut entry.path_filename, map_file.as_bytes());
            entry.unk_linked_list[1] = entry.unk_linked_list.as_ptr() as usize;
            let is_replay = map_path
                .extension()
                .and_then(|ext| ext.to_str())
                .filter(|&ext| ext == "rep")
                .is_some();

            entry.flags = if is_replay {
                0x4
            } else {
                // Map
                0x2
            };

            let mut vtable = scr::LobbyDialogVtable {
                functions: [0usize; 0x50],
            };
            vtable.functions[self.lobby_create_callback_offset / mem::size_of::<usize>()] =
                lobby_create_callback as *const () as usize;

            let mut object: *const scr::LobbyDialogVtable = &vtable;
            let result = log_time("select_map_entry", || {
                (self.select_map_entry)(&mut game_input, &mut object, &mut entry)
            });
            if entry.error != 0 {
                let error = std::ffi::CStr::from_ptr(entry.error_message.pointer as *const i8)
                    .to_string_lossy();
                return Err(bw::LobbyCreateError::Other(error.into()));
            }
            if result != 0 {
                // The error check above should have already failed, but check return code
                // as well, struct offsets may change and we may miss the error.
                return Err(bw::LobbyCreateError::from_error_code(result));
            }
            log_time("init_game_network", || (self.init_game_network)(0));
            Ok(())
        }
    }

    unsafe fn remaining_game_init(&self, name_in: &str) {
        unsafe {
            let local_player_name = self.local_player_name.resolve();
            let local_player_name = std::slice::from_raw_parts_mut(local_player_name, 25);
            let name = name_in.as_bytes();
            for (&input, out) in name.iter().zip(local_player_name.iter_mut()) {
                *out = input;
            }
            // This kind of init_storm_networking call wasn't needed (Did it even exist?) in 1.16.1,
            // would be interesting to know/verify what code loaded the SNP list there.
            (self.init_storm_networking)();
            let ok = (self.choose_snp)(crate::snp::PROVIDER_ID);
            if ok == 0 {
                panic!("Failed to select SNP");
            }
            self.is_multiplayer.write(1);
        }
    }

    unsafe fn local_storm_id(&self) -> u32 {
        unsafe { self.local_storm_id.resolve() }
    }

    unsafe fn game(&self) -> *mut bw::Game {
        unsafe { self.game.resolve() }
    }

    unsafe fn game_data(&self) -> *mut bw::BwGameData {
        unsafe { self.game_data.resolve() }
    }

    unsafe fn players(&self) -> *mut bw::Player {
        unsafe { self.players.resolve() }
    }

    unsafe fn replay_data(&self) -> *mut bw::ReplayData {
        unsafe { self.replay_data.resolve() }
    }

    unsafe fn replay_header(&self) -> *mut bw::ReplayHeader {
        unsafe { self.replay_header.resolve() }
    }

    fn game_command_lengths(&self) -> &[u32] {
        &self.game_command_lengths
    }

    unsafe fn process_replay_commands(&self, commands: &[u8], storm_player: StormPlayerId) {
        unsafe {
            let Some(unique_player) = self.unique_player_for_storm(storm_player) else {
                return;
            };
            let game_player = self.command_game_player(unique_player);
            self.command_user.write(game_player as u32);
            self.unique_command_user.write(unique_player as u32);
            self.enable_rng.write(1);
            (self.process_game_commands)(commands.as_ptr(), commands.len(), 1);
            if commands.first() == Some(&commands::id::LEAVE_GAME) {
                // A live game applies a player's departure through the pending-leave drain, which
                // besides removing the player also forces the trigger step to run on the next
                // frame. The leave command it records into the replay reproduces the removal on
                // playback but not that forced trigger pass, leaving playback's 30-frame trigger
                // cycle out of phase with the live game's from the departure onward; any later
                // trigger-driven elimination then lands on a different frame and the replay
                // diverges. Restoring the write here keeps playback on the live schedule (both
                // run the command handling before the trigger step, so the pass fires on the same
                // frame either way).
                self.trigger_execution_timer.write(1);
                let game = self.game();
                let frame = if game.is_null() {
                    0
                } else {
                    (*game).frame_count
                };
                debug!(
                    "Replay: storm player {} left at frame {}; forcing the next trigger pass",
                    storm_player.0, frame,
                );
            }
            self.command_user.write(self.local_player_id.resolve());
            self.unique_command_user
                .write(self.local_unique_player_id.resolve());
            self.enable_rng.write(0);
        }
    }

    unsafe fn set_player_name(&self, id: u8, name: &str) {
        unsafe {
            let mut buffer = [0; 0x60];
            for (i, &byte) in name.as_bytes().iter().take(0x5f).enumerate() {
                buffer[i] = byte;
            }
            // SCR has longer player names after the bw::Player array,
            // which are ones that it (mostly?) uses.
            let players = self.players();
            (*players.add(id as usize))
                .name
                .copy_from_slice(&buffer[..25]);
            let player_names = players.add(0x10) as *mut u8;
            let long_name = player_names.add(id as usize * 0x60);
            let long_name = std::slice::from_raw_parts_mut(long_name, 0x60);
            long_name.copy_from_slice(&buffer[..0x60]);
        }
    }

    unsafe fn active_units(&self) -> UnitIterator {
        unsafe { UnitIterator::new(Unit::from_ptr(self.first_active_unit.resolve())) }
    }

    unsafe fn unit_array(&self) -> bw_dat::UnitArray {
        unsafe {
            let units = self.units.resolve();
            bw_dat::UnitArray::new((*units).data as *mut bw::Unit, (*units).length)
        }
    }

    unsafe fn storm_player_flags(&self) -> Vec<u32> {
        unsafe {
            let ptr = self.storm_player_flags.resolve() as *const u32;
            std::slice::from_raw_parts(ptr, NET_PLAYER_COUNT).into()
        }
    }

    unsafe fn storm_set_last_error(&self, error: u32) {
        unsafe {
            *self.storm_last_error_ptr() = error;
        }
    }

    unsafe fn alloc(&self, size: usize) -> *mut u8 {
        unsafe {
            let allocator = self.allocator.resolve();
            (*(*allocator).vtable).alloc.call3(allocator, size, 8)
        }
    }

    unsafe fn free(&self, ptr: *mut u8) {
        unsafe {
            let allocator = self.allocator.resolve();
            (*(*allocator).vtable).free.call2(allocator, ptr)
        }
    }

    unsafe fn set_user_latency(&self, latency: UserLatency) {
        unsafe {
            self.net_user_latency.write(match latency {
                UserLatency::Low => 0,
                UserLatency::High => 1,
                UserLatency::ExtraHigh => 2,
            });
        }
    }
}

fn init_bw_dat(analysis: &mut scr_analysis::Analysis<'_>) -> Result<(), &'static str> {
    unsafe fn copy_dat_table(
        table: &scr_analysis::DatTablePtr<'_>,
        out: &mut Vec<bw::DatTable>,
        entries: usize,
    ) {
        unsafe {
            // Dat tables in SC:R memory have at least one extra field, bw_dat expects
            // 1.16.1 compatible format.
            let mut value = resolve_operand(table.address, &[]) as *const u8;
            for _ in 0..entries {
                let bw_table = value as *mut bw::DatTable;
                out.push(bw::DatTable {
                    data: (*bw_table).data,
                    entry_size: (*bw_table).entry_size,
                    entries: (*bw_table).entries,
                });
                value = value.add(table.entry_size as usize);
            }
        }
    }

    let units = analysis.dat_table(DatType::Units).ok_or("units.dat")?;
    let weapons = analysis.dat_table(DatType::Weapons).ok_or("weapons.dat")?;
    let upgrades = analysis
        .dat_table(DatType::Upgrades)
        .ok_or("upgrades.dat")?;
    let techdata = analysis
        .dat_table(DatType::TechData)
        .ok_or("techdata.dat")?;
    let orders = analysis.dat_table(DatType::Orders).ok_or("orders.dat")?;
    let mut out = Vec::with_capacity(0x36 + 0x18 + 0xc + 0xb + 0x13);
    unsafe {
        copy_dat_table(&units, &mut out, 0x36);
        copy_dat_table(&weapons, &mut out, 0x18);
        copy_dat_table(&upgrades, &mut out, 0xc);
        copy_dat_table(&techdata, &mut out, 0xb);
        copy_dat_table(&orders, &mut out, 0x13);
        let mut table = out.leak().as_ptr();
        bw_dat::init_units(table, 0x36);
        table = table.add(0x36);
        bw_dat::init_weapons(table, 0x18);
        table = table.add(0x18);
        bw_dat::init_upgrades(table, 0xc);
        table = table.add(0xc);
        bw_dat::init_techdata(table, 0xb);
        table = table.add(0xb);
        bw_dat::init_orders(table, 0x13);
        bw_dat::set_is_scr(true);
        bw_dat::set_bw_malloc(bw_malloc, bw_free);
    }
    Ok(())
}

unsafe extern "C" fn bw_malloc(size: usize) -> *mut u8 {
    unsafe { bw::get_bw().alloc(size) }
}

unsafe extern "C" fn bw_free(ptr: *mut u8) {
    unsafe { bw::get_bw().free(ptr) }
}

fn get_exe_build() -> u32 {
    let exe_path = windows::module_name(std::ptr::null_mut()).expect("Couldn't get exe path");
    match windows::version::get_version(Path::new(&exe_path)) {
        Some(s) => s.3 as u32,
        None => 0,
    }
}

fn create_event_hook(
    security: *mut c_void,
    init_state: u32,
    manual_reset: u32,
    name: *const u16,
    orig: unsafe extern "C" fn(*mut c_void, u32, u32, *const u16) -> *mut c_void,
) -> *mut c_void {
    unsafe {
        if !name.is_null() {
            let name_len = (0..).find(|&i| *name.add(i) == 0).unwrap();
            let name = std::slice::from_raw_parts(name, name_len);
            if ascii_compare_u16_u8(name, b"Starcraft Check For Other Instances") {
                // BW just checks last error to be ERROR_ALREADY_EXISTS
                SetLastError(0);
                return null_mut();
            }
        }
        orig(security, init_state, manual_reset, name)
    }
}

fn get_file_attributes_hook(
    bw: &BwScr,
    filename: *const u16,
    orig: unsafe extern "C" fn(*const u16) -> u32,
) -> u32 {
    // Using functions that call orig to both not trigger more hooks
    // and avoid the fact that rust Path functions actually call CreateFileW which
    // may be slightly different.
    // This matches what bw does.
    let is_dir = move |path: &Path| {
        let buf = windows::winapi_str(path);
        let ret = unsafe { orig(buf.as_ptr()) };
        ret != INVALID_FILE_ATTRIBUTES && ret & FILE_ATTRIBUTE_DIRECTORY != 0
    };
    let is_file = move |path: &Path| {
        let buf = windows::winapi_str(path);
        let ret = unsafe { orig(buf.as_ptr()) };
        ret != INVALID_FILE_ATTRIBUTES && ret & FILE_ATTRIBUTE_DIRECTORY == 0
    };
    unsafe {
        if !filename.is_null() {
            let name_len = (0..).find(|&i| *filename.add(i) == 0).unwrap();
            let filename = std::slice::from_raw_parts(filename, name_len);
            if check_filename(filename, b"CSettings.json") {
                let replacement = bw.settings_file_path.read();
                if replacement.is_empty() {
                    error!("Replacement settings file path not set")
                } else {
                    debug!("Mapping CSettings.json GetFileAttributesW call to {replacement}");
                    return orig(windows::winapi_str(&*replacement).as_ptr());
                }
            } else if check_dir_filename(filename, b"Battle.net") {
                stop_precise_system_time_hook();
            } else if check_dir_filename(filename, b"Maps") {
                // SC:R determines location of CASC data by first finding a directory
                // which has either
                //      - subdirectory "Maps"
                //      - file ".build.info"
                // The lookup order , where "." is exe directory, is:
                // 1) "."
                // 2) ".."
                // 3) "../Data"
                // 4) "../../Data"
                // 5) "../../../Data"
                // Since exe is in x86/ or x86_64/ subdir, 1) is something that is not supposed
                // to match, and if it does then the game won't find the actual data that
                // is supposed to be in 2).
                //
                // If for some(*) reason, there is a directory that contains Maps, StarCraft.exe,
                // but not .build.info, we will just say that such directory doesn't exist at all.
                //
                // (*) SHGetFolderPathW may fail for some users for reasons not understood,
                // which causes game to fallback into using exe dir as documents path, creating
                // Maps directory there.
                let mut path = PathBuf::from(OsString::from_wide(filename));
                if is_dir(&path) {
                    path.set_file_name("StarCraft.exe");
                    if is_file(&path) {
                        path.set_file_name(".build.info");
                        if !is_file(&path) {
                            warn!("Maps dir found relative to game exe");
                            return INVALID_FILE_ATTRIBUTES;
                        }
                    }
                }
            }
        }

        orig(filename)
    }
}

fn create_file_hook(
    bw: &BwScr,
    filename_ptr: *const u16,
    access: u32,
    share: u32,
    security: *mut c_void,
    creation_disposition: u32,
    flags: u32,
    template: *mut c_void,
    orig: unsafe extern "C" fn(
        *const u16,
        u32,
        u32,
        *mut c_void,
        u32,
        u32,
        *mut c_void,
    ) -> *mut c_void,
) -> *mut c_void {
    use winapi::um::fileapi::{CREATE_ALWAYS, CREATE_NEW, OPEN_EXISTING};
    use winapi::um::winnt::{DELETE, GENERIC_WRITE};
    unsafe {
        let mut needs_time_hook = false;
        let filename = match filename_ptr.is_null() {
            true => None,
            false => {
                let name_len = (0..).find(|&i| *filename_ptr.add(i) == 0).unwrap();
                Some(std::slice::from_raw_parts(filename_ptr, name_len))
            }
        };
        if let Some(filename) = filename {
            // Check if this is for CSettings.json and redirect it to our own file instead
            if check_filename(filename, b"CSettings.json") {
                let replacement = bw.settings_file_path.read();
                if replacement.is_empty() {
                    error!("Replacement settings file path not set")
                } else {
                    debug!("Mapping CSettings.json CreateFile call to {replacement}");
                    return orig(
                        windows::winapi_str(&*replacement).as_ptr(),
                        access,
                        share,
                        security,
                        creation_disposition,
                        flags,
                        template,
                    );
                }
            }

            // Redirect CASC log to our log directory.
            if check_filename(filename, b"SCR-NGDP-DiagnosticLog.txt") {
                let args = crate::parse_args();
                let replacement = args.user_data_path.join("logs/SCR-NGDP-DiagnosticLog.txt");
                return orig(
                    windows::winapi_str(&replacement).as_ptr(),
                    access,
                    share,
                    security,
                    creation_disposition,
                    flags,
                    template,
                );
            }

            // Check for CASC repair marker. If trying to read, just pretend it doesn't
            // exits. If trying to create (SC:R thought that the installation is broken),
            // exit without creating the file (Hopefully the crash dump will have some
            // information on the issue if it is our fault).
            if check_filename(filename, b"CascRepair.mrk") {
                if matches!(creation_disposition, CREATE_ALWAYS | CREATE_NEW) {
                    panic!("Unable to read CASC archive, may have to repair installation");
                } else {
                    SetLastError(winapi::shared::winerror::ERROR_FILE_NOT_FOUND);
                    return -1isize as *mut c_void;
                }
            } else if check_filename(filename, b"cookie.bin") && !offline_cookie::is_inspecting() {
                needs_time_hook = true;
                debug!(
                    "CreateFileW for cookie.bin with params {access:x} {share:x} \
                        {creation_disposition:x} {flags:x}"
                );
                // Only plain reads are pointed elsewhere; anything that could write goes to
                // the SDK's own file.
                if access & (GENERIC_WRITE | DELETE) == 0 && creation_disposition == OPEN_EXISTING {
                    let real_path = PathBuf::from(windows::os_string_from_winapi(filename));
                    if let Some(target) = offline_cookie::redirect_target(&real_path) {
                        let handle = orig(
                            windows::winapi_str(&target).as_ptr(),
                            access,
                            share,
                            security,
                            creation_disposition,
                            flags,
                            template,
                        );
                        if handle != -1isize as *mut c_void {
                            start_precise_system_time_hook();
                        } else {
                            let error = GetLastError();
                            warn!("Opening the offline cookie copy failed with code {error}");
                            SetLastError(error);
                        }
                        return handle;
                    }
                }
            } else if check_filename(filename, b"Agent.dat") {
                // Should happen earlier, but just in case
                stop_precise_system_time_hook();
            }
        }
        let handle = orig(
            filename_ptr,
            access,
            share,
            security,
            creation_disposition,
            flags,
            template,
        );
        if handle == -1isize as *mut c_void
            && let Some(filename) = filename
        {
            // Log failures outside few expected cases, as CreateFileW failing is
            // mostly unexpected, even if the caller is able to handle them.
            // Expected errors that show up still in logging are telemetry & replay saving
            // related, skipping those gets too inconvenient to do.
            let error = GetLastError();
            let skip =
                check_filename(filename, b"CONOUT$") || check_filename(filename, b"cookie.bin");
            if !skip {
                debug!(
                    "CreateFileW for '{}' with params {access:x} {share:x} \
                        {creation_disposition:x} {flags:x} failed with code {error}",
                    windows::os_string_from_winapi(filename).display(),
                );
                // Logging may have written over last error, so set it again
                SetLastError(error);
            }
        }
        if handle != -1isize as *mut c_void && needs_time_hook {
            start_precise_system_time_hook();
        }

        handle
    }
}

fn check_filename(filename: &[u16], compare: &[u8]) -> bool {
    let ending =
        Some(()).and_then(|()| filename.get(filename.len().checked_sub(compare.len() + 1)?..));
    if let Some(ending) = ending {
        (ending[0] == b'\\' as u16 || ending[0] == b'/' as u16)
            && ascii_compare_u16_u8_casei(&ending[1..], compare)
    } else {
        ascii_compare_u16_u8_casei(filename, compare)
    }
}

/// check_filename but ignores trailing slash / backslash
fn check_dir_filename(filename: &[u16], compare: &[u8]) -> bool {
    if let Some((&last, rest)) = filename.split_last()
        && (last == b'/' as u16 || last == b'\\' as u16)
    {
        check_filename(rest, compare)
    } else {
        check_filename(filename, compare)
    }
}

fn ascii_compare_u16_u8_casei(a: &[u16], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for i in 0..a.len() {
        if a[i] >= 0x80 || !(a[i] as u8).eq_ignore_ascii_case(&b[i]) {
            return false;
        }
    }
    true
}

fn ascii_compare_u16_u8(a: &[u16], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for i in 0..a.len() {
        if a[i] >= 0x80 || a[i] != b[i] as u16 {
            return false;
        }
    }
    true
}

thread_local! {
    /// A counter for how many GetSystemTimePreciseAsFileTime hooks to modify on this thread.
    static PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT: Cell<u32> = const { Cell::new(0) };

    /// Avoids hooking our own time retrieval during logging
    pub static IS_LOGGING_TIME_CALL: Cell<bool> = const { Cell::new(false) };
}

pub fn start_precise_system_time_hook() {
    // Experimentally derived to be a good value
    PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.set(1);
}

fn stop_precise_system_time_hook() {
    PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.set(0);
}

fn get_system_time_precise_as_file_time_hook(
    time: *mut FILETIME,
    orig: unsafe extern "C" fn(*mut FILETIME),
) {
    unsafe {
        orig(time);

        if PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.get() > 0 && !IS_LOGGING_TIME_CALL.get() {
            debug!("Modifying GetSystemTimePreciseAsFileTime result");
            // Making StarCraft feel young again makes it initialize a bit faster
            (*time).dwHighDateTime = 0x01BF53B7;
            (*time).dwLowDateTime = 0x8F200000;

            PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.with(|count| {
                count.update(|c| c.saturating_sub(1));
            });
        }
    }
}

fn load_snp_list_hook(
    callbacks: *mut scr::SnpLoadFuncs,
    count: u32,
    orig: unsafe extern "C" fn(*mut scr::SnpLoadFuncs, u32) -> u32,
) -> u32 {
    let mut funcs = scr::SnpLoadFuncs {
        identify: snp_load_identify,
        bind: snp_load_bind,
    };

    unsafe {
        // Call bind for SCR's LAN funcs to determine function count
        // and to get pointer to its initialize function, which we'll
        // have to call at our SNP initialize.
        assert!(count != 0);
        let mut orig_scr_funcs = null();
        let ok = ((*callbacks).bind)(1, &mut orig_scr_funcs);
        assert!(ok != 0);
        SCR_SNP_INITIALIZE.store((*orig_scr_funcs).initialize as usize, Ordering::Relaxed);
        orig(&mut funcs, 1)
    }
}

static SNP_FUNCTIONS: SnpFunctions = SnpFunctions {
    unk0: 0,
    free_packet: snp::free_packet,
    initialize: snp_initialize,
    unk0c: 0,
    receive_packet: snp::receive_packet,
    send_packet: snp::send_packet,
    unk18: 0,
    broadcast_game: snp::broadcast_game,
    stop_broadcasting_game: snp::stop_broadcasting_game,
    unk24: 0,
    unk28: 0,
    joined_game: None,
    unk30: 0,
    unk34: 0,
    start_listening_for_games: None,
    future_padding: [0; 0x10],
};

unsafe extern "system" fn snp_load_identify(
    snp_index: u32,
    id: *mut u32,
    name: *mut *const i8,
    description: *mut *const i8,
    caps: *mut *const crate::bw::SnpCapabilities,
) -> u32 {
    unsafe {
        if snp_index > 0 {
            return 0;
        }

        *id = snp::PROVIDER_ID;
        *name = c"Shieldbattery".as_ptr();
        *description = c"=)".as_ptr();
        *caps = &snp::CAPABILITIES;
        1
    }
}

unsafe extern "system" fn snp_initialize(
    client_info: *const bw::ClientInfo,
    user_data: *mut c_void,
    battle_info: *mut c_void,
    module_data: *mut c_void,
) -> i32 {
    unsafe {
        // No ShieldBattery packet transport is set up here, but SCR's own LAN SNP init still runs:
        // it initializes a global SCR accesses when joining a game, and it won't initialize
        // anything else we don't want. Storm's own lobby session tick (the StepIo pump,
        // `maybe_receive_turns`) only runs once this has completed, so its result is latched into
        // `SNP_INITIALIZED` for those to gate on.
        let scr_init: unsafe extern "system" fn(
            *const bw::ClientInfo,
            *mut c_void,
            *mut c_void,
            *mut c_void,
        ) -> i32 = mem::transmute(SCR_SNP_INITIALIZE.load(Ordering::Relaxed));
        let result = scr_init(client_info, user_data, battle_info, module_data);
        SNP_INITIALIZED.store(result != 0, Ordering::Relaxed);
        result
    }
}

static SCR_SNP_INITIALIZE: AtomicUsize = AtomicUsize::new(0);
static SNP_INITIALIZED: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn snp_load_bind(snp_index: u32, funcs: *mut *const SnpFunctions) -> u32 {
    unsafe {
        if snp_index > 0 {
            return 0;
        }
        *funcs = &SNP_FUNCTIONS;
        1
    }
}

#[allow(bad_style)]
mod hooks {
    use libc::c_void;
    use winapi::shared::minwindef::FILETIME;

    use crate::bw;

    use super::scr;

    whack_hooks!(0, // cdecl
        !0 => ScMain();
        !0 => GameInit();
        !0 => OpenFile(*mut scr::FileHandle, *const u8, *const scr::OpenParams) ->
            *mut scr::FileHandle;
        !0 => ProcessGameCommands(*const u8, usize, u32);
        !0 => ProcessLobbyCommands(*const u8, usize, u32);
        !0 => SendCommand(*const u8, usize);
        !0 => InitGameData() -> u32;
        !0 => InitUnitData();
        !0 => StepGame();
        !0 => StepReplayCommands();
        !0 => CreateGameMultiplayer(
            *mut bw::BwGameData, // Note: 1.16.1 struct
            *const u8, // Game name
            *const u8, // Password (null)
            *const u8, // Map path?
            usize, usize, usize, usize, // 0x10 byte struct passed by value
        ) -> u32;
        !0 => SpawnDialog(*mut bw::Dialog, usize, usize) -> usize;
        !0 => StepGameLogic(usize) -> usize;
    );

    system_hooks!(
        !0 => LoadSnpList(*mut scr::SnpLoadFuncs, u32) -> u32;
        !0 => CreateEventW(*mut c_void, u32, u32, *const u16) -> *mut c_void;
        !0 => GetTickCount() -> u32;
        !0 => CreateFileW(
            *const u16,
            u32,
            u32,
            *mut c_void,
            u32,
            u32,
            *mut c_void,
        ) -> *mut c_void;
        !0 => GetFileAttributesW(*const u16) -> u32;
        !0 => XInputGetState(u32, *mut c_void) -> u32;
        !0 => GetSystemTimePreciseAsFileTime(*mut FILETIME);
        !0 => SHGetFolderPathW(*mut c_void, i32, *mut c_void, u32, *mut u16) -> i32;
    );

    thiscall_hooks!(
        !0 => StartUdpServer(*mut c_void) -> u32;
        !0 => StepIo(*mut c_void);
        !0 => OrderFn(*mut bw::Unit);
        !0 => KillUnit(*mut bw::Unit);
    );

    #[cfg(target_arch = "x86")]
    thiscall_hooks!(
        !0 => PrepareIssueOrder(*mut bw::Unit, u32, u32, *mut bw::Unit, u32, u32);
    );

    #[cfg(target_arch = "x86_64")]
    thiscall_hooks!(
        !0 => PrepareIssueOrder(*mut bw::Unit, u32, *mut bw::PointAndUnit, u32, u32);
    );
}

// Inline asm was only on nightly rust when this was written..
// mov eax, [esp + 4]; mov eax, fs:[eax]; ret
#[cfg(target_arch = "x86")]
#[unsafe(link_section = ".text")]
#[unsafe(no_mangle)] // Workaround for linker errors on opt-level 1 ??
static READ_FS_GS: [u8; 8] = [0x8b, 0x44, 0xe4, 0x04, 0x64, 0x8b, 0x00, 0xc3];

// mov rax, gs:[rcx]; ret
#[cfg(target_arch = "x86_64")]
#[unsafe(link_section = ".text")]
#[unsafe(no_mangle)] // Workaround for linker errors on opt-level 1 ??
static READ_FS_GS: [u8; 5] = [0x65, 0x48, 0x8b, 0x01, 0xc3];

unsafe fn read_fs_gs(offset: usize) -> usize {
    unsafe {
        let func: extern "C" fn(usize) -> usize = mem::transmute(READ_FS_GS.as_ptr());
        func(offset)
    }
}

/// Value is assumed to not have null terminator.
/// Leaks memory and BW should not be let to deallocate the buffer
/// if value doesn't fit inline.
unsafe fn init_bw_string(out: *mut scr::BwString, value: &[u8]) {
    unsafe {
        if value.len() < 16 {
            let inline_buffer: *mut [u8; 16] = &raw mut (*out).inline_buffer;
            (&mut *inline_buffer)[..value.len()].copy_from_slice(value);
            (&mut *inline_buffer)[value.len()] = 0;
            (*out).pointer = inline_buffer.cast();
            (*out).length = value.len();
            (*out).capacity = 15 | (isize::MIN as usize);
        } else {
            let mut vec = mem::ManuallyDrop::new(Vec::with_capacity(value.len() + 1));
            vec.extend(value.iter().cloned());
            vec.push(0);
            (*out).pointer = vec.as_mut_ptr();
            (*out).length = value.len();
            (*out).capacity = value.len();
        }
    }
}

fn log_time<F: FnOnce() -> R, R>(name: &str, func: F) -> R {
    let time = Instant::now();
    let ret = func();
    debug!("{} took {:?}", name, time.elapsed());
    ret
}

/// This is the main function for progressing synced game logic, including
/// receiving handling of network commands, and replay commands if this is replay.
///
/// If replay is being seeked (replay_seek_frame global), this function will
/// run several steps before returning, otherwise it progresses a single step.
unsafe fn step_game_logic_hook(
    bw: &'static BwScr,
    param: usize, // Always 0, nonzero would affect replay playback somehow
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    if !bw.first_game_logic_frame_done.load(Ordering::Relaxed) {
        bw.first_game_logic_frame_done
            .store(true, Ordering::Relaxed);
        // Game-loop init is over (this runs after the loop's first message pump, stalled network
        // or not, and in replays), so SC:R's cursor moves are the player's again.
        crate::forge::suppress_scr_cursor_moves(false);
    }
    // Observer / replay UI in SC:R has a bug with toggling player visions:
    // In order to immediately update un/detected sprite to match what players see,
    // BW calls update_detection_status(unit) that in addition to updating sprite
    // (not expected to be synced), will write to unit.detection_status (expected to be synced).
    //
    // Fixing this by reverting any changes to unit.detection_status outside step_game_logic,
    // this simpler to implement than adding analysis for the obs UI functions.
    //
    // That vision-toggle UI only exists on replay and observer clients; a playing client's
    // vision changes all go through synced commands handled inside step_game_logic, so nothing
    // can corrupt detection_status between steps there and the save/restore passes are skipped.
    // A low-rate fingerprint of the synced state, logged in live games and replay playback
    // alike: any simulation divergence perturbs the RNG draw sequence and resource flow almost
    // immediately, so diffing these lines between a live game's log and its replay's log finds
    // the first diverged interval without any special tooling. The `rng` words are the u32s
    // around the operand the analysis resolves as the RNG seed — the block holds the seed and
    // the advancing rand state/draw counters, so some of the words move with every synced draw.
    // `trigger_timer` is the trigger step's countdown: a live-vs-playback difference in it
    // means the two run their trigger passes on different frames (a player leave restarts it).
    {
        let game = bw.game();
        if !game.is_null() {
            let frame = (*game).frame_count;
            static LAST_PROBE_FRAME: AtomicU32 = AtomicU32::new(u32::MAX);
            if frame.is_multiple_of(240) && LAST_PROBE_FRAME.swap(frame, Ordering::Relaxed) != frame
            {
                let seed_ptr = bw.rng_seed.resolve_as_ptr();
                let mut rng_words = [0u32; 6];
                for (i, out) in rng_words.iter_mut().enumerate() {
                    *out = seed_ptr.add(i).read_unaligned();
                }
                let minerals = (*game).minerals;
                let gas = (*game).gas;
                let trigger_timer = bw.trigger_execution_timer.resolve();
                debug!(
                    "Sync probe: frame {} rng {:x?} minerals {:?} gas {:?} trigger_timer {}",
                    frame,
                    rng_words,
                    &minerals[..4],
                    &gas[..4],
                    trigger_timer,
                );
            }
        }
    }
    let has_obs_vision_ui = game_thread::is_replay()
        || BwPlayerId(bw.local_unique_player_id.resolve() as u8).is_observer();
    if !has_obs_vision_ui {
        return orig(param);
    }
    let units = bw.units.resolve();
    {
        // For first call of this function detection_status_copy should be empty
        // and this loop before orig will not write to anything.
        //
        // FWIW, it is be fine to rely on (*units).length and (*units).data being
        // constant for the all step_game_logic calls across single game.
        let detection_status = bw.detection_status_copy.lock();
        let unit_ptr = (*units).data as *mut bw::Unit;
        for (i, value) in detection_status.iter().copied().enumerate() {
            (*unit_ptr.add(i)).detection_status = value;
        }
    }
    let ret = orig(param);
    {
        let mut detection_status = bw.detection_status_copy.lock();
        let unit_count = (*units).length;
        let unit_ptr = (*units).data as *mut bw::Unit;
        detection_status.clear();
        detection_status.extend((0..unit_count).map(|i| (*unit_ptr.add(i)).detection_status));
    }
    ret
}

unsafe fn check_documents_starcraft_path_accessibility() {
    use winapi::um::fileapi::GetFileAttributesW;
    use winapi::um::shlobj::{CSIDL_PERSONAL, SHGetFolderPathW};
    // Using same functions what BW uses to see if something weird goes wrong there.
    let mut buffer = [0u16; 0x104];
    let result = SHGetFolderPathW(
        null_mut(),
        CSIDL_PERSONAL,
        null_mut(),
        0,
        buffer.as_mut_ptr(),
    );
    if result != 0 {
        warn!(
            "SHGetFolderPathW(CSIDL_PERSONAL) failed: {:08x} {}",
            result,
            std::io::Error::from_raw_os_error(result),
        );
        return;
    }
    let mut path = windows::os_string_from_winapi_with_nul(&buffer);
    path.push("\\StarCraft\\");
    let result = GetFileAttributesW(windows::winapi_str(&path).as_ptr());
    if result == 0xffff_ffff {
        // Note: BW is able to handle this folder not existing, but our call point
        // is after the point in which it should have been created already.
        let error = std::io::Error::last_os_error();
        warn!("BW documents path '{path:?}' is not usable: {error}");
    } else if result & FILE_ATTRIBUTE_DIRECTORY == 0 {
        warn!("BW documents path '{path:?}' is not a directory, file attributes are {result:08x}");
    }
}

fn sh_get_folder_path_w_hook(
    hwnd: *mut c_void,
    csidl: i32,
    token: *mut c_void,
    flags: u32,
    out_path: *mut u16,
    orig: unsafe extern "C" fn(*mut c_void, i32, *mut c_void, u32, *mut u16) -> i32,
) -> i32 {
    #[cold]
    fn write_dir_out(out: &mut [u16], path: &Path) {
        warn!("Fallback SHGetFolderPathW set to {}", path.display());
        let mut u16_path = windows::winapi_str(path);
        // Sanity check that there is null terminator
        assert!(*u16_path.last().unwrap() == 0);
        // Remove trailing slash / backslash, if it exists,
        // since SHGetFolderPathW documents it not being included
        while let Some(&last) = u16_path.get(u16_path.len() - 2) {
            if last == b'/' as u16 || last == b'\\' as u16 {
                u16_path.pop();
                *u16_path.last_mut().unwrap() = 0;
            } else {
                break;
            }
        }
        if u16_path.len() > out.len() {
            // Shouldn't happen, as the buffer must be MAX_PATH (260) characters long
            panic!("Documents dir path too long");
        }
        out[..u16_path.len()].copy_from_slice(&u16_path);
    }

    unsafe {
        use winapi::um::shlobj::CSIDL_PERSONAL;
        let ret = orig(hwnd, csidl, token, flags, out_path);
        // Bw uses SHGetFolderPathW to figure out documents dir and has unfortunate
        // fallbacks where it creates maps directory next to starcraft.exe if it fails
        // So if we detect the arguments that bw uses, and the function fails, we try to
        // find the result from another way.
        if ret != 0 && csidl == CSIDL_PERSONAL && hwnd.is_null() && token.is_null() && flags == 0 {
            let out = std::slice::from_raw_parts_mut(out_path, 260);
            warn!(
                "SHGetFolderPathW(CSIDL_PERSONAL) failed: {ret:x}; trying directories crate fallback"
            );
            // Not sure if the directories crate gives any different results; it still
            // calls SHGetKnownFolderPath without any user tokens or such,
            // so unless it has different results it would fail as well.
            if let Some(dirs) = directories::UserDirs::new()
                && let Some(documents) = dirs.document_dir()
            {
                write_dir_out(out, documents);
                return 0;
            }
            warn!("directories crate fallback failed; trying std::env::home_dir");
            if let Some(home_dir) = std::env::home_dir() {
                let documents = home_dir.join("Documents");
                if documents.is_dir() {
                    write_dir_out(out, &documents);
                    return 0;
                } else {
                    warn!("{} is not a directory", documents.display());
                }
            } else {
                warn!("std::env::home_dir failed");
            }
        }
        ret
    }
}
