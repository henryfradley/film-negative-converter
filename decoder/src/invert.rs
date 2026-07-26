/// C41 negative → positive.
///
/// Density D = log(base/pixel) per channel — this is log-space (perceptual).
/// Per-channel auto-levels ≈ auto white balance.
/// Aggressive percentiles skip the film rebate area so the black point
/// lands in the scene, not on the sprocket holes.

pub fn invert(pixels: &[f32], _width: u32, _height: u32) -> Vec<f32> {
    let base = film_base(pixels);
    eprintln!("film base R={:.4}  G={:.4}  B={:.4}", base[0], base[1], base[2]);

    let log_base = [base[0].max(1e-6).ln(), base[1].max(1e-6).ln(), base[2].max(1e-6).ln()];

    // 1. Density per channel
    let mut px: Vec<f32> = pixels
        .chunks_exact(3)
        .flat_map(|p| {
            [
                (log_base[0] - p[0].max(1e-6).ln()).max(0.0),
                (log_base[1] - p[1].max(1e-6).ln()).max(0.0),
                (log_base[2] - p[2].max(1e-6).ln()).max(0.0),
            ]
        })
        .collect();

    // 2. Aggressive per-channel auto-levels — 3 % / 99.5 % percentile.
    //    The 3 % skip clips out the rebate/sprocket area so the black point
    //    lands in real scene shadow, not on transparent film.
    auto_levels_per_channel(&mut px, 0.03, 0.995);

    // 3. Film-like S-curve — normalised so 0→0 and 1→1
    for v in px.iter_mut() {
        *v = s_curve(*v, 6.0);
    }

    // 4. Saturation boost
    saturate(&mut px, 1.3);

    // NOTE: no sRGB gamma. Density is already log-space (perceptual),
    // so writing values directly is closer to correct than double-encoding.

    // 5. Final black-point / white-point pull — the Photoshop levels move.
    //    Aggressive lo (5 %) so the film rebate crushes to true black,
    //    since it can be 5-10 % of the image area.
    black_white_stretch(&mut px, 0.05, 0.999);

    px
}

/// Film base = per-channel 99 % percentile of non-clipped pixels.
fn film_base(pixels: &[f32]) -> [f32; 3] {
    let mut base = [0.0f32; 3];
    for ch in 0..3 {
        let mut vals: Vec<f32> = pixels
            .chunks_exact(3)
            .map(|p| p[ch])
            .filter(|&v| v < 0.999)
            .collect();
        if vals.is_empty() {
            base[ch] = 1.0;
            continue;
        }
        vals.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());
        base[ch] = vals[((vals.len() - 1) as f32 * 0.99) as usize];
    }
    base
}

fn auto_levels_per_channel(pixels: &mut [f32], lo_frac: f32, hi_frac: f32) {
    for ch in 0..3 {
        let mut vals: Vec<f32> = pixels.chunks_exact(3).map(|p| p[ch]).collect();
        vals.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());
        let lo = vals[((vals.len() - 1) as f32 * lo_frac) as usize];
        let hi = vals[((vals.len() - 1) as f32 * hi_frac) as usize];
        let range = (hi - lo).max(1e-6);
        eprintln!("  ch{ch}: density stretch [{lo:.3}, {hi:.3}]");
        for p in pixels.chunks_exact_mut(3) {
            p[ch] = ((p[ch] - lo) / range).clamp(0.0, 1.0);
        }
    }
}

fn s_curve(t: f32, slope: f32) -> f32 {
    let pivot = 0.5;
    let f = |x: f32| 1.0 / (1.0 + (-slope * (x - pivot)).exp());
    let f0 = f(0.0);
    let f1 = f(1.0);
    ((f(t) - f0) / (f1 - f0)).clamp(0.0, 1.0)
}

fn saturate(pixels: &mut [f32], factor: f32) {
    for p in pixels.chunks_exact_mut(3) {
        let luma = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
        p[0] = (luma + (p[0] - luma) * factor).clamp(0.0, 1.0);
        p[1] = (luma + (p[1] - luma) * factor).clamp(0.0, 1.0);
        p[2] = (luma + (p[2] - luma) * factor).clamp(0.0, 1.0);
    }
}

fn black_white_stretch(pixels: &mut [f32], lo_frac: f32, hi_frac: f32) {
    let mut lumas: Vec<f32> = pixels
        .chunks_exact(3)
        .map(|p| 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2])
        .collect();
    lumas.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());
    let lo = lumas[((lumas.len() - 1) as f32 * lo_frac) as usize];
    let hi = lumas[((lumas.len() - 1) as f32 * hi_frac) as usize];
    let range = (hi - lo).max(1e-6);
    eprintln!("final stretch: [{lo:.3}, {hi:.3}] → [0, 1]");
    for p in pixels.chunks_exact_mut(3) {
        p[0] = ((p[0] - lo) / range).clamp(0.0, 1.0);
        p[1] = ((p[1] - lo) / range).clamp(0.0, 1.0);
        p[2] = ((p[2] - lo) / range).clamp(0.0, 1.0);
    }
}
