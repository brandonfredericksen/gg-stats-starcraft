use crate::bw;
use crate::game_thread::report_game_end;

pub unsafe fn spawn_dialog_hook(
    raw: *mut bw::Dialog,
    unk: usize,
    event_handler: usize,
    orig: unsafe extern "C" fn(*mut bw::Dialog, usize, usize) -> usize,
) -> usize {
    unsafe {
        let ctrl = bw_dat::dialog::Dialog::new(raw).as_control();
        let name = ctrl.string();
        // A permanent, cheap record of every dialog BW spawns — the safety net for identifying a
        // dialog by its real template name from a live run.
        debug!("spawn_dialog: {name:?}");
        if name == "WMission" || name == "LMission" {
            report_game_end();
        }
        orig(raw, unk, event_handler)
    }
}
