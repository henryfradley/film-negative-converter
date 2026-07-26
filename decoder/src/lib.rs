pub mod invert;

pub struct DecodeResult {
    pub width: u32,
    pub height: u32,
    /// Linear RGB, interleaved (R G B …), normalised to [0, 1].
    pub pixels: Vec<f32>,
}

// ── Native: libraw via rsraw ────────────────────────────────────────────────
#[cfg(all(not(target_arch = "wasm32"), feature = "native"))]
mod decode_native;
#[cfg(all(not(target_arch = "wasm32"), feature = "native"))]
pub use decode_native::decode_raw;

// ── WASM: rawler + bilinear demosaic ────────────────────────────────────────
#[cfg(target_arch = "wasm32")]
mod decode_wasm;
#[cfg(target_arch = "wasm32")]
pub use decode_wasm::decode_raw;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmDecodeResult {
    pub width: u32,
    pub height: u32,
    pixels: Vec<f32>,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmDecodeResult {
    /// Returns the interleaved RGB linear pixels as a copy for JS.
    #[wasm_bindgen(getter)]
    pub fn pixels(&self) -> Vec<f32> {
        self.pixels.clone()
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn decode(data: &[u8]) -> Result<WasmDecodeResult, JsValue> {
    console_error_panic_hook::set_once();
    let r = decode_raw(data).map_err(|e| JsValue::from_str(&e))?;
    Ok(WasmDecodeResult {
        width: r.width,
        height: r.height,
        pixels: r.pixels,
    })
}
