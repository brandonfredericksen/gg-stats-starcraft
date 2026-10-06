//! Fonts, colors and base style for the DLL's egui overlays.
//!
//! Kept free of BW / samase / Windows dependencies so it builds and tests on any host.

pub mod colors;
pub mod fonts;
mod style;

pub use style::install_fonts_and_style;
