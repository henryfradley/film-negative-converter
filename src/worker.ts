/// Worker: routes based on file type — RAW → Rust/WASM (rawler), or standard
/// image (JPEG/PNG/WebP) → browser native. Then computes percentiles and
/// transfers linear RGB + stretch params to main thread.

import init, { decode } from '../decoder/pkg/decoder.js';

export type WorkerIn = { buffer: ArrayBuffer; name: string; type: string };
export type WorkerOut = {
  width: number;
  height: number;
  pixels: Float32Array;
  logBase: [number, number, number];
  densityLo: [number, number, number];
  densityHi: [number, number, number];
  bwLo: number;
  bwHi: number;
  crop: [number, number, number, number];
  /// Which decoder handled this file — surfaced in the status text.
  decoder: 'rawler' | 'browser';
};

const SAMPLE_COUNT = 200_000;
const STANDARD_MIME = /^image\/(jpeg|png|webp)$/;
const STANDARD_EXT  = /\.(jpg|jpeg|png|webp)$/i;
let wasmReady: Promise<void> | null = null;

async function ensureWasm(): Promise<void> {
  if (!wasmReady) wasmReady = init().then(() => {});
  return wasmReady;
}

/// sRGB gamma → linear, per channel.
function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/// Decode a standard image (JPEG/PNG/WebP) via the browser and convert to
/// linear RGB f32. Assumes source is sRGB-encoded (standard).
async function decodeStandard(buffer: ArrayBuffer, mime: string):
  Promise<{ width: number; height: number; pixels: Float32Array }> {
  const bitmap = await createImageBitmap(new Blob([buffer], { type: mime }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const pixels = new Float32Array(bitmap.width * bitmap.height * 3);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) {
    pixels[j]     = srgbToLinear(img.data[i]     / 255);
    pixels[j + 1] = srgbToLinear(img.data[i + 1] / 255);
    pixels[j + 2] = srgbToLinear(img.data[i + 2] / 255);
  }
  bitmap.close();
  return { width: bitmap.width, height: bitmap.height, pixels };
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    const { buffer, name, type } = e.data;

    // Route to the right decoder
    const isStandard = STANDARD_MIME.test(type) || STANDARD_EXT.test(name);

    let width: number, height: number, pixels: Float32Array;
    let decoder: 'rawler' | 'browser';

    if (isStandard) {
      const r = await decodeStandard(buffer, type || 'image/jpeg');
      width = r.width; height = r.height; pixels = r.pixels;
      decoder = 'browser';
    } else {
      await ensureWasm();
      const bytes = new Uint8Array(buffer);
      const result = decode(bytes);
      width  = result.width;
      height = result.height;
      pixels = result.pixels;
      decoder = 'rawler';
    }

    // ── percentile subsample ──────────────────────────────────────────
    const nPixels = width * height;
    const stride = Math.max(1, Math.floor(nPixels / SAMPLE_COUNT));
    const sR: number[] = [], sG: number[] = [], sB: number[] = [];
    for (let i = 0; i < nPixels; i += stride) {
      const base = i * 3;
      sR.push(pixels[base]);
      sG.push(pixels[base + 1]);
      sB.push(pixels[base + 2]);
    }

    const filmBase: [number, number, number] = [
      percentile(sR.filter(v => v < 0.999), 0.99),
      percentile(sG.filter(v => v < 0.999), 0.99),
      percentile(sB.filter(v => v < 0.999), 0.99),
    ];
    const logBase: [number, number, number] = [
      Math.log(Math.max(filmBase[0], 1e-6)),
      Math.log(Math.max(filmBase[1], 1e-6)),
      Math.log(Math.max(filmBase[2], 1e-6)),
    ];

    const dR = sR.map(v => Math.max(logBase[0] - Math.log(Math.max(v, 1e-6)), 0));
    const dG = sG.map(v => Math.max(logBase[1] - Math.log(Math.max(v, 1e-6)), 0));
    const dB = sB.map(v => Math.max(logBase[2] - Math.log(Math.max(v, 1e-6)), 0));

    const densityLo: [number, number, number] = [
      percentile(dR, 0.03), percentile(dG, 0.03), percentile(dB, 0.03),
    ];
    const densityHi: [number, number, number] = [
      percentile(dR, 0.995), percentile(dG, 0.995), percentile(dB, 0.995),
    ];

    // Simulate the shader pipeline on the subsample → estimate final BW stretch
    const S_SLOPE = 6.0;
    const SAT = 1.3;
    const finalLumas: number[] = new Array(sR.length);
    for (let i = 0; i < sR.length; i++) {
      const t = [
        normalise(dR[i], densityLo[0], densityHi[0]),
        normalise(dG[i], densityLo[1], densityHi[1]),
        normalise(dB[i], densityLo[2], densityHi[2]),
      ].map(v => sCurve(v, S_SLOPE));
      const luma = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
      const sat = [
        clamp(luma + (t[0] - luma) * SAT),
        clamp(luma + (t[1] - luma) * SAT),
        clamp(luma + (t[2] - luma) * SAT),
      ];
      finalLumas[i] = 0.2126 * sat[0] + 0.7152 * sat[1] + 0.0722 * sat[2];
    }
    const bwLo = percentile(finalLumas, 0.05);
    const bwHi = percentile(finalLumas, 0.999);

    // Manual crop: default to whole frame; user drags to trim.
    const crop: [number, number, number, number] = [0, 0, 1, 1];

    const out: WorkerOut = {
      width, height, pixels,
      logBase, densityLo, densityHi, bwLo, bwHi, crop, decoder,
    };
    (self as any).postMessage(out, [pixels.buffer]);
  } catch (err) {
    (self as any).postMessage({ error: String(err) });
  }
};

function percentile(arr: number[], p: number): number {
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
}
function normalise(v: number, lo: number, hi: number): number {
  return clamp((v - lo) / Math.max(hi - lo, 1e-6));
}
function clamp(v: number): number { return Math.max(0, Math.min(1, v)); }
function sCurve(t: number, slope: number): number {
  const pivot = 0.5;
  const f = (x: number) => 1 / (1 + Math.exp(-slope * (x - pivot)));
  const f0 = f(0), f1 = f(1);
  return clamp((f(t) - f0) / (f1 - f0));
}
