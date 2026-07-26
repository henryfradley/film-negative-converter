/// WASM decode path — pure Rust (rawler) + bilinear demosaic.
/// Handles DNG (which is what we get from Adobe DNG Converter for HE* NEFs).

use rawler::decoders::RawDecodeParams;
use rawler::rawsource::RawSource;

use crate::DecodeResult;

pub fn decode_raw(data: &[u8]) -> Result<DecodeResult, String> {
    let source = RawSource::new_from_slice(data);
    let raw = rawler::decode(&source, &RawDecodeParams::default())
        .map_err(|e| format!("decode: {e}"))?;

    let width  = raw.width;
    let height = raw.height;
    let cfa    = raw.camera.cfa.name.clone();

    // Normalise Bayer to [0, 1]. as_f32() returns unscaled sensor counts.
    let white = raw
        .whitelevel
        .as_vec()
        .into_iter()
        .reduce(f32::max)
        .unwrap_or(65535.0);

    let black = raw
        .blacklevel
        .as_vec()
        .into_iter()
        .reduce(f32::min)
        .unwrap_or(0.0);

    let denom = (white - black).max(1.0);
    let bayer: Vec<f32> = raw
        .data
        .as_f32()
        .iter()
        .map(|&v| ((v - black) / denom).clamp(0.0, 1.0))
        .collect();

    let rgb = demosaic_bilinear(&bayer, width, height, &cfa);

    Ok(DecodeResult {
        width: width as u32,
        height: height as u32,
        pixels: rgb,
    })
}

/// Return channel index (0=R, 1=G, 2=B) at (row, col) for the given 4-char CFA.
/// Pattern layout is [p0 p1 / p2 p3] repeating in 2×2 blocks.
fn cfa_channel(row: usize, col: usize, pattern: &[u8]) -> usize {
    let idx = (row & 1) * 2 + (col & 1);
    match pattern[idx] {
        b'R' => 0,
        b'B' => 2,
        _ => 1, // G (both greens map to 1)
    }
}

/// Simple bilinear Bayer demosaic → interleaved RGB f32.
/// Edges use clamped sampling; not the fanciest algorithm but fast & correct.
fn demosaic_bilinear(bayer: &[f32], width: usize, height: usize, cfa_name: &str) -> Vec<f32> {
    let pat = cfa_name.as_bytes();
    let pat = if pat.len() >= 4 { &pat[..4] } else { b"RGGB" };

    let mut rgb = vec![0.0f32; width * height * 3];
    let get = |r: i32, c: i32| -> f32 {
        let r = r.clamp(0, height as i32 - 1) as usize;
        let c = c.clamp(0, width as i32 - 1) as usize;
        bayer[r * width + c]
    };

    for r in 0..height {
        for c in 0..width {
            let ch = cfa_channel(r, c, pat);
            let out = (r * width + c) * 3;
            let r_ = r as i32;
            let c_ = c as i32;

            // Captured channel: direct
            rgb[out + ch] = bayer[r * width + c];

            // Two missing channels: interpolate from nearest same-channel neighbours.
            // Layout depends on the CFA position of the current pixel.
            match ch {
                0 | 2 => {
                    // R or B site: the OTHER (B or R) is at 4 diagonals; G is at 4 cardinals.
                    let other = 2 - ch;
                    rgb[out + other] = 0.25 * (
                        get(r_-1, c_-1) + get(r_-1, c_+1) +
                        get(r_+1, c_-1) + get(r_+1, c_+1));
                    rgb[out + 1] = 0.25 * (
                        get(r_-1, c_) + get(r_+1, c_) +
                        get(r_, c_-1) + get(r_, c_+1));
                }
                _ => {
                    // G site: R and B are on cardinals, but on different axes.
                    // Determine which by looking at the actual CFA neighbours.
                    let horiz_ch = cfa_channel(r, c.wrapping_add(1), pat);
                    let vert_ch  = cfa_channel(r.wrapping_add(1), c, pat);
                    let h_val = 0.5 * (get(r_, c_-1) + get(r_, c_+1));
                    let v_val = 0.5 * (get(r_-1, c_) + get(r_+1, c_));
                    rgb[out + horiz_ch] = h_val;
                    rgb[out + vert_ch]  = v_val;
                }
            }
        }
    }
    rgb
}
