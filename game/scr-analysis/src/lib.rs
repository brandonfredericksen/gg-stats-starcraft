//! This is a crate that just instantiates samase_scarf analysis explicitly to x86
//! implementation. (Not that the x64 even works yet)
//! Having it be a separate from rest of the game helps with compile times, as the main
//! crate can just link directly with this when not optimizing for release, and is also
//! required for the main crate to build this as optimized for faster SC:R launching with
//! otherwise unoptimized builds.
//!
//! All the code in this crate is pretty much uninteresting boilerplate that declares
//! whatever the main crate's BwScr::new wants.
//!
//! IMPORTANT: this crate intentionally wraps only the subset of samase_scarf's `Analysis`
//! surface that the main crate actually uses. An analysis "missing" here is often already
//! implemented in samase_scarf â€” check the pinned samase_scarf rev's `Analysis` API before
//! concluding new binary analysis is needed; if it exists there, adding a one-line wrapper
//! method in this file is the whole job.

pub use samase_scarf::scarf;
pub use samase_scarf::{DatTablePtr, DatType};

use scarf::exec_state::VirtualAddress as _;
use scarf::{BinaryFile, Operand, OperandCtx};

#[cfg(target_arch = "x86")]
use scarf::ExecutionStateX86 as ExecutionState;

#[cfg(target_arch = "x86_64")]
use scarf::ExecutionStateX86_64 as ExecutionState;

#[cfg(target_arch = "x86")]
pub use scarf::VirtualAddress;

#[cfg(target_arch = "x86_64")]
pub use scarf::VirtualAddress64 as VirtualAddress;

pub type Patch = samase_scarf::Patch<VirtualAddress>;

pub struct Analysis<'e>(
    samase_scarf::Analysis<'e, ExecutionState<'e>>,
    &'e BinaryFile<VirtualAddress>,
    OperandCtx<'e>,
);

impl<'e> Analysis<'e> {
    pub fn new(binary: &'e BinaryFile<VirtualAddress>, ctx: OperandCtx<'e>) -> Analysis<'e> {
        Analysis(samase_scarf::Analysis::new(binary, ctx), binary, ctx)
    }

    fn eud(&mut self, address: u32) -> Option<Operand<'e>> {
        let euds = self.0.eud_table();
        let index = euds
            .euds
            .binary_search_by_key(&address, |x| x.address)
            .ok()?;
        Some(euds.euds.get(index)?.operand)
    }

    pub fn game(&mut self) -> Option<Operand<'e>> {
        self.0.game()
    }

    pub fn players(&mut self) -> Option<Operand<'e>> {
        self.0.players()
    }

    pub fn rng_seed(&mut self) -> Option<Operand<'e>> {
        self.0.rng_seed()
    }

    pub fn init_net_player(&mut self) -> Option<VirtualAddress> {
        self.0.init_net_player()
    }

    pub fn net_player_flags(&mut self) -> Option<Operand<'e>> {
        self.0.net_player_flags()
    }

    pub fn step_network(&mut self) -> Option<VirtualAddress> {
        self.0.step_network()
    }

    pub fn lobby_state(&mut self) -> Option<Operand<'e>> {
        self.0.lobby_state()
    }

    pub fn is_multiplayer(&mut self) -> Option<Operand<'e>> {
        self.0.is_multiplayer()
    }

    // Storm session internals for the netcode-v2 native-lobby join replacement.

    pub fn select_map_entry(&mut self) -> Option<VirtualAddress> {
        self.0.select_map_entry()
    }

    pub fn game_state(&mut self) -> Option<Operand<'e>> {
        self.0.scmain_state()
    }

    pub fn mainmenu_entry_hook(&mut self) -> Option<VirtualAddress> {
        self.0.mainmenu_entry_hook()
    }

    pub fn game_loop(&mut self) -> Option<VirtualAddress> {
        self.0.game_loop()
    }

    pub fn load_images(&mut self) -> Option<VirtualAddress> {
        self.0.load_images()
    }

    pub fn images_loaded(&mut self) -> Option<Operand<'e>> {
        self.0.images_loaded()
    }

    pub fn init_game_network(&mut self) -> Option<VirtualAddress> {
        self.0.init_game_network()
    }

    pub fn process_lobby_commands(&mut self) -> Option<VirtualAddress> {
        self.0.process_lobby_commands()
    }

    pub fn send_command(&mut self) -> Option<VirtualAddress> {
        self.0.send_command()
    }

    pub fn local_player_id(&mut self) -> Option<Operand<'e>> {
        self.0.local_player_id()
    }

    pub fn local_storm_player_id(&mut self) -> Option<Operand<'e>> {
        self.0.local_storm_player_id()
    }

    pub fn local_unique_player_id(&mut self) -> Option<Operand<'e>> {
        self.0.local_unique_player_id()
    }

    pub fn net_player_to_game(&mut self) -> Option<Operand<'e>> {
        self.0.net_player_to_game()
    }

    pub fn net_player_to_unique(&mut self) -> Option<Operand<'e>> {
        self.0.net_player_to_unique()
    }

    pub fn choose_snp(&mut self) -> Option<VirtualAddress> {
        self.0.choose_snp()
    }

    pub fn local_player_name(&mut self) -> Option<Operand<'e>> {
        self.0.local_player_name()
    }

    pub fn init_storm_networking(&mut self) -> Option<VirtualAddress> {
        self.0.init_storm_networking()
    }

    pub fn load_snp_list(&mut self) -> Option<VirtualAddress> {
        self.0.load_snp_list()
    }

    pub fn create_game_dialog_vtbl_on_multiplayer_create(&mut self) -> Option<usize> {
        self.0.create_game_dialog_vtbl_on_multiplayer_create()
    }

    pub fn process_commands(&mut self) -> Option<VirtualAddress> {
        self.0.process_commands()
    }

    pub fn process_events(&mut self) -> Option<VirtualAddress> {
        self.0.process_events()
    }

    pub fn command_lengths(&mut self) -> Vec<u32> {
        (*self.0.command_lengths()).clone()
    }

    pub fn snet_send_packets(&mut self) -> Option<VirtualAddress> {
        self.0.snet_send_packets()
    }

    pub fn snet_recv_packets(&mut self) -> Option<VirtualAddress> {
        self.0.snet_recv_packets()
    }

    pub fn step_io(&mut self) -> Option<VirtualAddress> {
        let scheduler_vtable = Some(self.0.vtables_for_class(b".?AVSchedulerService@services"))
            // There is only 1 matching vtable for now, hopefully it won't change
            .filter(|x| x.len() == 1)
            .map(|x| x[0])?;
        self.1
            .read_address(scheduler_vtable + VirtualAddress::SIZE * 3)
            .ok()
    }

    pub fn init_game(&mut self) -> Option<VirtualAddress> {
        self.0.init_game()
    }

    pub fn init_units(&mut self) -> Option<VirtualAddress> {
        self.0.init_units()
    }

    pub fn file_hook(&mut self) -> Option<VirtualAddress> {
        self.0.open_file()
    }

    pub fn get_tls_index(&self) -> Option<*mut u32> {
        let binary = self.1;
        let base = binary.base();
        let pe_start = binary.read_u32(base + 0x3c).ok()?;
        let tls_offset_in_header = match VirtualAddress::SIZE == 4 {
            true => 0xc0,
            false => 0xd0,
        };
        let tls_offset = binary
            .read_u32(base + pe_start + tls_offset_in_header)
            .ok()
            .filter(|&offset| offset != 0)?;
        let tls_address = base + tls_offset;
        let tls_ptr = binary
            .read_address(tls_address + 2 * VirtualAddress::SIZE)
            .ok()?;
        Some(tls_ptr.as_u64() as *mut u32)
    }

    pub fn first_active_unit(&mut self) -> Option<Operand<'e>> {
        self.0.first_active_unit()
    }

    pub fn step_game(&mut self) -> Option<VirtualAddress> {
        self.0.step_objects()
    }

    pub fn step_replay_commands(&mut self) -> Option<VirtualAddress> {
        self.0.step_replay_commands()
    }

    pub fn replay_data(&mut self) -> Option<Operand<'e>> {
        self.0.replay_data()
    }

    pub fn command_user(&mut self) -> Option<Operand<'e>> {
        self.0.command_user()
    }

    pub fn unique_command_user(&mut self) -> Option<Operand<'e>> {
        self.0.unique_command_user()
    }

    pub fn storm_command_user(&mut self) -> Option<Operand<'e>> {
        self.0.storm_command_user()
    }

    pub fn enable_rng(&mut self) -> Option<Operand<'e>> {
        self.0.rng_enable()
    }

    pub fn init_real_time_lighting(&mut self) -> Option<VirtualAddress> {
        self.0.init_real_time_lighting()
    }

    pub fn dat_table(&mut self, dat: DatType) -> Option<DatTablePtr<'e>> {
        self.0.dat(dat)
    }

    pub fn allocator(&mut self) -> Option<Operand<'e>> {
        self.0.allocator()
    }

    pub fn start_udp_server(&mut self) -> Option<VirtualAddress> {
        self.0.start_udp_server()
    }

    pub fn order_limit(&mut self) -> Option<Operand<'e>> {
        let limits = self.0.limits();
        limits
            .arrays
            .get(5)
            .filter(|x| x.len() == 1)
            .and_then(|x| x.first())
            .filter(|x| x.1 == 0 && x.2 == 0)
            .map(|x| self.2.mem32(x.0, u64::from(VirtualAddress::SIZE)))
    }

    pub fn first_free_order(&mut self) -> Option<Operand<'e>> {
        self.0.first_free_order()
    }

    pub fn last_free_order(&mut self) -> Option<Operand<'e>> {
        self.0.last_free_order()
    }

    pub fn allocated_order_count(&mut self) -> Option<Operand<'e>> {
        self.0.allocated_order_count()
    }

    pub fn replay_bfix(&mut self) -> Option<Operand<'e>> {
        self.0.replay_bfix()
    }

    pub fn replay_gcfg(&mut self) -> Option<Operand<'e>> {
        self.0.replay_gcfg()
    }

    pub fn prepare_issue_order(&mut self) -> Option<VirtualAddress> {
        self.0.prepare_issue_order()
    }

    pub fn replay_header(&mut self) -> Option<Operand<'e>> {
        self.eud(0x006D0F30)
    }

    pub fn create_game_multiplayer(&mut self) -> Option<VirtualAddress> {
        self.0.create_game_multiplayer()
    }

    pub fn anti_troll(&mut self) -> Option<Operand<'e>> {
        self.0.anti_troll()
    }

    pub fn game_data(&mut self) -> Option<Operand<'e>> {
        self.0.game_data()
    }

    pub fn spawn_dialog(&mut self) -> Option<VirtualAddress> {
        self.0.spawn_dialog()
    }

    pub fn step_game_logic(&mut self) -> Option<VirtualAddress> {
        self.0.step_game_logic()
    }

    pub fn units(&mut self) -> Option<Operand<'e>> {
        // This function returns pointer to unit array `vector<bw::Unit>`,
        // samase_scarf units analysis returns pointer to the actual array
        // (So the analysis works with older versions which had hardcoded unit limits
        // and as such had just a global array instead of vector),
        // so extract `x` from samase_scarf result `Mem32[x]` and assume that is correct.
        self.0
            .units()
            .and_then(|x| x.if_memory())
            .map(|mem| mem.address_op(self.2))
    }

    pub fn net_user_latency(&mut self) -> Option<Operand<'e>> {
        self.0.net_user_latency()
    }

    // --- Netcode v2 turn/command seam (see scr-netcode-replacement-guide.md Â§5.1). ---
    // These expose the turn-send / turn-receive / latency-pipe surface so the rally-point2
    // QUIC transport can be interposed above Storm. samase_scarf resolves each of these; they
    // were simply not surfaced through this wrapper before.

    /// `Mem16` countdown the trigger step decrements once per game frame; every player's triggers
    /// run on the frame it is read as zero, after which it is reset to 30. Native code writes 1
    /// into it to force a trigger pass on the following frame (a player leaving does this).
    pub fn trigger_execution_timer(&mut self) -> Option<Operand<'e>> {
        self.0.trigger_execution_timer()
    }

    pub fn map_width_pixels(&mut self) -> Option<Operand<'e>> {
        self.0.map_width_pixels()
    }

    pub fn map_height_pixels(&mut self) -> Option<Operand<'e>> {
        self.0.map_height_pixels()
    }

    pub fn is_replay(&mut self) -> Option<Operand<'e>> {
        self.0.is_replay()
    }

    pub fn render_screen(&mut self) -> Option<VirtualAddress> {
        self.0.render_screen()
    }

    pub fn main_palette(&mut self) -> Option<Operand<'e>> {
        self.0.main_palette()
    }

    pub fn order_harvest_gas(&mut self) -> Option<VirtualAddress> {
        self.0.order_function(0x53)
    }

    pub fn move_unit(&mut self) -> Option<VirtualAddress> {
        self.0.move_unit()
    }

    pub fn pathing(&mut self) -> Option<Operand<'e>> {
        self.0.pathing()
    }

    pub fn snet_local_player_list(&mut self) -> Option<Operand<'e>> {
        self.0.snet_local_player_list()
    }

    pub fn sc_main(&mut self) -> Option<VirtualAddress> {
        self.0.sc_main()
    }

    /// Kills a unit, with the unit as `this`.
    pub fn kill_unit(&mut self) -> Option<VirtualAddress> {
        self.0.kill_unit()
    }

    /// Each of the map's tiles as the map made them, a u16 each, the map's width to a row: the
    /// tile group in the high 12 bits and the tile in the group in the low 4.
    pub fn tileset_indexed_map_tiles(&mut self) -> Option<Operand<'e>> {
        self.0.tileset_indexed_map_tiles()
    }

    /// What each of the map's tiles was before creep covered it, laid out like
    /// [`tileset_indexed_map_tiles`](Self::tileset_indexed_map_tiles), or 0 for tiles without
    /// creep.
    pub fn creep_original_tiles(&mut self) -> Option<Operand<'e>> {
        self.0.creep_original_tiles()
    }

    /// The tileset's tile groups (its .cv5), each with the megatile of each of its 16 tiles.
    pub fn tileset_cv5(&mut self) -> Option<Operand<'e>> {
        self.0.tileset_cv5()
    }

    /// The tileset's megatiles, 16 u32 minitile references each: the minitile's index shifted
    /// left by 1, with the low bit set when it's flipped.
    pub fn tileset_vx4ex(&mut self) -> Option<Operand<'e>> {
        self.0.tileset_vx4ex()
    }

    /// The tileset's minitiles (its .vr4), 8x8 palette indexes each.
    pub fn minitile_graphics(&mut self) -> Option<Operand<'e>> {
        self.0.minitile_graphics()
    }
}
