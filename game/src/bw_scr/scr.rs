//! SC:R types we use.
//! Somewhat confusingly separate from `crate::bw::scr` which is alias to `bw_dat::structs::scr`.

use libc::c_void;

use crate::bw::SnpFunctions;
use crate::bw_scr::{bw_free, bw_malloc};

use super::thiscall::Thiscall;

#[repr(C)]
pub struct SnpLoadFuncs {
    pub identify: unsafe extern "system" fn(
        u32,            // snp index
        *mut u32,       // id
        *mut *const i8, // name
        *mut *const i8, // description
        *mut *const crate::bw::SnpCapabilities,
    ) -> u32,
    pub bind: unsafe extern "system" fn(u32, *mut *const SnpFunctions) -> u32,
}

#[repr(C)]
pub struct LobbyDialogVtable {
    pub functions: [usize; 0x50],
}

#[repr(C)]
pub struct GameInput {
    pub name: BwString,
    pub password: BwString,
    pub speed: u8,
    pub game_type_subtype: u32,
    pub turn_rate: u32,
    pub game_flag1: u8,
    pub old_limits: u8,
    pub eud: u8,
    pub safety_padding: [u8; 0x21],
}

#[repr(C)]
pub struct MapDirEntry {
    pub key: u32,
    pub unk4: [u8; 0x1c],
    pub filename: BwString,
    pub title: BwString,
    pub description: BwString,
    pub error_message: BwString,
    pub unk90: BwString,
    pub unkac: BwString,
    pub unkc8: BwString,
    pub unk_linked_list: [usize; 0x3],
    pub loaded: u8,
    pub error: u32,
    pub unk104: [u8; 0x8],
    pub flags: u8,
    pub unk10d: u8,
    pub map_width_tiles: u16,
    pub map_height_tiles: u16,
    pub unk112: [u8; 0xd2],
    pub path_directory: BwString,
    pub path_filename: BwString,
}

#[repr(C)]
pub struct BwString {
    /// A pointer to the current memory containing the characters in the string.
    pub pointer: *mut u8,
    /// Current length of the string, not including the null terminator.
    pub length: usize,
    /// Total size of the memory pointed to by [`pointer`], not including the null terminator.
    /// The sign bit of the capacity signifies whether or not the inline buffer is being used
    /// (sign bit set = internal buffer).
    pub capacity: usize,
    /// A buffer that will be used if the string fits within it.
    pub inline_buffer: [u8; 0x10],
}

impl BwString {
    /// Returns the capacity (with the bit signifying internal/external buffer removed).
    pub fn get_capacity(&self) -> usize {
        self.capacity & (usize::MAX >> 1)
    }

    pub fn is_using_inline_buffer(&self) -> bool {
        self.capacity & !(usize::MAX >> 1) != 0
    }

    /// Replaces the entire contents of the string, allocating new memory if necessary.
    pub fn replace_all(&mut self, replace_with: &str) {
        if replace_with.len() > self.get_capacity() {
            // New value doesn't fit, reallocate
            if !self.is_using_inline_buffer() {
                unsafe {
                    let pointer = std::mem::replace(&mut self.pointer, std::ptr::null_mut());
                    bw_free(pointer);
                }
            }

            // TODO(tec27): Increase this size a bit to avoid reallocations?
            let new_capacity = replace_with.len();
            unsafe {
                self.pointer = bw_malloc(new_capacity + 1);
                self.capacity = new_capacity;
            }
        }

        unsafe {
            let text_slice = std::slice::from_raw_parts_mut(self.pointer, self.get_capacity() + 1);
            text_slice[..replace_with.len()].copy_from_slice(replace_with.as_bytes());
            text_slice[replace_with.len()] = 0;
            self.length = replace_with.len();
        }
    }
}

/// A safe wrapper around [BwString]. Uses BW's malloc/free functions to manage memory so its
/// inner pointer can be safely passed to BW functions that expect to free the [BwString].
pub struct SafeBwString(*mut BwString);

#[allow(dead_code)]
impl SafeBwString {
    pub fn new() -> Self {
        unsafe {
            let s = bw_malloc(std::mem::size_of::<BwString>()) as *mut BwString;
            (*s).pointer = (*s).inline_buffer.as_mut_ptr();
            (*s).capacity = 0x15 | (isize::MIN as usize); // Use inline buffer
            (*s).length = 0;
            (*s).inline_buffer[0] = 0;
            Self(s)
        }
    }

    /// Returns a new, empty [SafeBwString] with at least the specified capacity. Note that the
    /// capacity may be larger.
    pub fn with_capacity(capacity: usize) -> Self {
        if capacity <= 15 {
            Self::new()
        } else {
            unsafe {
                let s = bw_malloc(std::mem::size_of::<BwString>()) as *mut BwString;
                (*s).pointer = bw_malloc(capacity + 1);
                (*(*s).pointer) = 0;
                (*s).capacity = capacity;
                (*s).length = 0;
                (*s).inline_buffer[0] = 0;
                Self(s)
            }
        }
    }

    /// Consumes the [SafeBwString], returning the wrapped [BwString] pointer.
    pub unsafe fn into_inner(mut self) -> *mut BwString {
        std::mem::replace(&mut self.0, std::ptr::null_mut())
    }

    pub fn len(&self) -> usize {
        unsafe { (*self.0).length }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn capacity(&self) -> usize {
        unsafe { (*self.0).get_capacity() }
    }

    /// Replaces the entire contents of the string.
    pub fn replace_all(&mut self, replace_with: &str) {
        unsafe {
            (*self.0).replace_all(replace_with);
        }
    }
}

impl From<&str> for SafeBwString {
    fn from(value: &str) -> Self {
        let mut s = SafeBwString::with_capacity(value.len());
        s.replace_all(value);
        s
    }
}

impl From<&String> for SafeBwString {
    fn from(value: &String) -> Self {
        let mut s = SafeBwString::with_capacity(value.len());
        s.replace_all(value);
        s
    }
}

impl Drop for SafeBwString {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                if !(*self.0).is_using_inline_buffer() {
                    let pointer = std::mem::replace(&mut (*self.0).pointer, std::ptr::null_mut());
                    bw_free(pointer);
                }
                bw_free(self.0 as *mut u8);
            }
        }
    }
}

#[repr(C)]
pub struct BwVector {
    pub data: *mut c_void,
    pub length: usize,
    pub capacity: usize,
}

#[repr(C)]
pub struct FileHandle {
    pub vtable: *const V_FileHandle1,
    pub vtable2: *const V_FileHandle2,
    pub vtable3: *const V_FileHandle3,
    pub metadata: *mut FileMetadata,
    pub peek: *mut FilePeek,
    pub read: *mut FileRead,
    pub file_ok: u32,
    //pub dc18: [u8; 0x10],
    pub close_callback: Function, // 0x1 = pointer, else inline
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct OpenParams {
    pub extension: *const u8,
    pub _unk4: u32,
    pub file_type: u32,
    pub locale: u32,
    pub flags: u32,
    pub casc_buffer_size: u32,
    pub safety_padding: [u32; 4],
}

#[repr(C)]
pub struct FileRead {
    pub vtable: *const V_FileRead,
    pub inner: *mut c_void,
}

#[repr(C)]
pub struct FilePeek {
    pub vtable: *const V_FilePeek,
    pub inner: *mut c_void,
}

#[repr(C)]
pub struct FileMetadata {
    pub vtable: *const V_FileMetadata,
    pub inner: *mut c_void,
}

/// This seems to be a std::function implementation
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Function {
    pub vtable: *const V_Function,
    pub inner: *mut c_void,
}

#[repr(C)]
#[allow(non_camel_case_types)]
pub struct V_FileHandle1 {
    pub destroy: Thiscall<unsafe extern "C" fn(*mut FileHandle, u32)>,
    pub read: Thiscall<unsafe extern "C" fn(*mut FileHandle, *mut u8, u32) -> u32>,
    pub skip: Thiscall<unsafe extern "C" fn(*mut FileHandle, u32)>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
#[allow(non_camel_case_types)]
pub struct V_FileHandle2 {
    pub unk0: [usize; 1],
    pub peek: Thiscall<unsafe extern "C" fn(*mut c_void, *mut u8, u32) -> u32>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
#[allow(non_camel_case_types)]
pub struct V_FileHandle3 {
    pub unk0: [usize; 1],
    pub tell: Thiscall<unsafe extern "C" fn(*mut c_void) -> u32>,
    pub seek: Thiscall<unsafe extern "C" fn(*mut c_void, u32)>,
    pub file_size: Thiscall<unsafe extern "C" fn(*mut c_void) -> u32>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
#[allow(non_camel_case_types)]
pub struct V_FileMetadata {
    pub unk0: [usize; 1],
    pub tell: Thiscall<unsafe extern "C" fn(*mut FileMetadata) -> u32>,
    pub seek: Thiscall<unsafe extern "C" fn(*mut FileMetadata, u32)>,
    pub file_size: Thiscall<unsafe extern "C" fn(*mut FileMetadata) -> u32>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
#[allow(non_camel_case_types)]
pub struct V_FileRead {
    pub destroy: usize,
    pub read: Thiscall<unsafe extern "C" fn(*mut FileRead, *mut u8, u32) -> u32>,
    pub skip: Thiscall<unsafe extern "C" fn(*mut FileRead, u32)>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
#[allow(non_camel_case_types)]
pub struct V_FilePeek {
    pub destroy: usize,
    pub peek: Thiscall<unsafe extern "C" fn(*mut FilePeek, *mut u8, u32) -> u32>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
#[allow(non_camel_case_types)]
pub struct V_Function {
    pub destroy_inner: Thiscall<unsafe extern "C" fn(*mut Function, u32)>,
    pub invoke: Thiscall<unsafe extern "C" fn(*mut Function)>,
    pub get_sizes: Thiscall<unsafe extern "C" fn(*mut Function, *mut usize)>,
    pub copy: Thiscall<unsafe extern "C" fn(*mut Function, *mut Function)>,
    pub copy2: Thiscall<unsafe extern "C" fn(*mut Function, *mut Function)>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
pub struct Allocator {
    pub vtable: *mut AllocatorVtable,
}

#[repr(C)]
pub struct AllocatorVtable {
    pub delete: usize,
    pub alloc: Thiscall<unsafe extern "C" fn(*mut Allocator, usize, usize) -> *mut u8>,
    pub fn2: usize,
    pub fn3: usize,
    pub free: Thiscall<unsafe extern "C" fn(*mut Allocator, *mut u8)>,
}

#[repr(C)]
pub struct ReplayBfix {
    pub flags: u32,
}

#[repr(C)]
pub struct ReplayGcfg {
    pub unk0: [u8; 4],
    pub build: u32,
    pub unk8: [u8; 8],
    pub unk10: u8,
}

#[repr(C)]
pub struct AntiTroll {
    pub active: u8,
}

#[test]
fn struct_sizes() {
    use std::mem::size_of;
    assert_eq!(
        size_of::<SnpFunctions>(),
        (0x3c / 4 + 0x10) * size_of::<usize>()
    );
}
