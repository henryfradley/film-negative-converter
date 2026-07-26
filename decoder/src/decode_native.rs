/// Native decode path — uses system libraw (via rsraw).
/// Handles every RAW format libraw supports; NOT compiled for WASM.

use rsraw::{BIT_DEPTH_16, RawImage};

use crate::DecodeResult;

pub fn decode_raw(data: &[u8]) -> Result<DecodeResult, String> {
    let mut raw = RawImage::open(data).map_err(|e| format!("open: {e}"))?;
    raw.unpack().map_err(|e| format!("unpack: {e}"))?;

    raw.set_use_camera_wb(true);
    raw.set_use_camera_matrix(false);

    {
        let p = &mut raw.as_mut().params;
        p.use_auto_wb    = 0;
        p.output_color   = 0; // camera native
        p.no_auto_bright = 1;
        p.gamm[0]        = 1.0;
        p.gamm[1]        = 1.0;
    }

    let img = raw.process::<BIT_DEPTH_16>().map_err(|e| format!("process: {e}"))?;

    let width  = img.width();
    let height = img.height();
    let pixels = img.iter().map(|&v| v as f32 / 65535.0).collect();

    Ok(DecodeResult { width, height, pixels })
}
