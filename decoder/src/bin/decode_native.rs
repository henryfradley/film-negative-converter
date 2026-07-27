/// One-stop pipeline: RAW/DNG in → finished positive PNG out.
/// Also emits:
///   - output.bin              linear pixel dump (Web-Worker debug format)
///   - output_negative.png     the "as-scanned" view (sRGB-encoded linear
///                             capture, i.e. what the negative looks like
///                             through a lightbox — orange, inverted)
///
/// Usage: cargo run --bin decode_native -- path/to/file.dng
use decoder::{decode_raw, invert::invert};
use std::fs;
use std::io::Write;

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: decode_native <raw_or_dng_file>");

    println!("Reading: {path}");
    let data = fs::read(&path).expect("failed to read file");

    println!("Decoding...");
    let raw = decode_raw(&data).expect("decode failed");
    println!("  {}×{} linear RGB", raw.width, raw.height);

    // ── negative preview: gamma-encode the raw linear capture for display ──
    let neg_u8: Vec<u8> = raw.pixels.iter().map(|&v| (srgb_gamma(v) * 255.0) as u8).collect();
    let neg_out = "output_negative.png";
    image::save_buffer(neg_out, &neg_u8, raw.width, raw.height, image::ColorType::Rgb8)
        .expect("failed to write negative PNG");
    println!("Saved → {neg_out}  (as-scanned)");

    // Dump linear pixels as .bin for the browser
    dump_bin("output.bin", raw.width, raw.height, &raw.pixels);
    println!("Dumped → output.bin  ({} MB)", (16 + raw.pixels.len() * 4) / 1_048_576);

    println!("Inverting + levels + gamma...");
    let positive = invert(&raw.pixels, raw.width, raw.height);
    let u8_pixels: Vec<u8> = positive.iter().map(|&v| (v * 255.0) as u8).collect();
    let out = "output_positive.png";
    image::save_buffer(out, &u8_pixels, raw.width, raw.height, image::ColorType::Rgb8)
        .expect("failed to write PNG");
    println!("Saved → {out}  (positive)");
}

/// sRGB gamma-encode a linear [0,1] value for display.
fn srgb_gamma(v: f32) -> f32 {
    if v <= 0.0031308 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 }
}

/// Simple binary format the browser worker reads:
///   4B magic "FNIM" | 4B version=1 | 4B width | 4B height | pixels (f32 RGB LE)
fn dump_bin(path: &str, width: u32, height: u32, pixels: &[f32]) {
    let mut f = fs::File::create(path).expect("create .bin");
    f.write_all(b"FNIM").unwrap();
    f.write_all(&1u32.to_le_bytes()).unwrap();
    f.write_all(&width.to_le_bytes()).unwrap();
    f.write_all(&height.to_le_bytes()).unwrap();
    let bytes: &[u8] = unsafe {
        std::slice::from_raw_parts(pixels.as_ptr() as *const u8, pixels.len() * 4)
    };
    f.write_all(bytes).unwrap();
}
