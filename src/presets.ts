/// Curated film-inspired starting points. Each preset overrides only the
/// tone/colour params it names; crop, orient, black/white points are left
/// alone (those are per-frame decisions).

import type { StretchParams } from './gl';

export type PresetKey =
  | 'sSlope' | 'saturation' | 'curves' | 'sharpen'
  | 'temp' | 'tint' | 'shadowWarm' | 'highlightWarm';

export type Preset = { name: string } & Partial<Record<PresetKey, number>>;

export const PRESET_KEYS: PresetKey[] = [
  'sSlope', 'saturation', 'curves', 'sharpen',
  'temp', 'tint', 'shadowWarm', 'highlightWarm',
];

export const PRESETS: Preset[] = [
  { name: 'Neutral',    sSlope: 6.0, saturation: 1.30, curves: 1.00, sharpen: 0.00,
                        temp: 0.00, tint: 0.00, shadowWarm: 0.00, highlightWarm: 0.00 },
  { name: 'Portrait',   sSlope: 4.8, saturation: 1.15, curves: 1.10, sharpen: 0.20,
                        temp: 0.12, tint: -0.05, shadowWarm: 0.15, highlightWarm: 0.10 },
  { name: 'Vivid',      sSlope: 8.0, saturation: 1.70, curves: 0.90, sharpen: 0.60,
                        temp: 0.00, tint: 0.00, shadowWarm: -0.10, highlightWarm: 0.10 },
  { name: 'Golden',     sSlope: 5.5, saturation: 1.40, curves: 1.10, sharpen: 0.30,
                        temp: 0.25, tint: -0.05, shadowWarm: 0.20, highlightWarm: 0.25 },
  { name: 'Cinematic',  sSlope: 7.0, saturation: 1.15, curves: 0.95, sharpen: 0.40,
                        temp: 0.05, tint: 0.00, shadowWarm: -0.35, highlightWarm: 0.30 },
  { name: 'Faded',      sSlope: 4.0, saturation: 0.75, curves: 1.25, sharpen: 0.00,
                        temp: 0.20, tint: 0.00, shadowWarm: 0.15, highlightWarm: 0.15 },
  { name: 'Moody',      sSlope: 8.5, saturation: 1.10, curves: 0.85, sharpen: 0.30,
                        temp: -0.15, tint: 0.00, shadowWarm: -0.20, highlightWarm: -0.05 },
  { name: 'Cool',       sSlope: 6.0, saturation: 1.20, curves: 1.00, sharpen: 0.20,
                        temp: -0.20, tint: 0.05, shadowWarm: -0.10, highlightWarm: -0.15 },
];

/// Apply a preset's named keys to a params object (in-place).
export function applyPresetToParams(params: StretchParams, p: Preset): void {
  for (const k of PRESET_KEYS) {
    const v = p[k];
    if (v !== undefined) params[k] = v;
  }
}
