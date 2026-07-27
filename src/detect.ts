/// Content-based file type detection. Never trust extension or MIME type —
/// users rename files, cameras don't set MIME types, drag-drop strips them.
///
/// We only need to distinguish "browser can decode this natively" (JPEG/PNG/
/// WebP) from "route it to rawler" (everything else). Beyond that, rawler
/// does its own magic-byte inspection to pick the right RAW decoder.

export type DetectedFormat =
  | { kind: 'standard'; format: 'jpeg' | 'png' | 'webp' }
  | { kind: 'raw'; format: RawFormat }
  | { kind: 'unknown'; hint: string };

/// Only the formats we actively support + advertise. Everything else that
/// rawler can decode still works — just detected as 'tiff-unknown' (for
/// TIFF-based RAWs) or 'unknown' (worker still tries rawler as fallback).
export type RawFormat =
  | 'dng' | 'cr2' | 'cr3' | 'nef' | 'arw'
  | 'raf' | 'orf' | 'rw2'
  | 'tiff-unknown';

export function detectFormat(buf: ArrayBuffer): DetectedFormat {
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 16));

  // ── Standard web images ─────────────────────────────────────────────
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { kind: 'standard', format: 'jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47)
    return { kind: 'standard', format: 'png' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { kind: 'standard', format: 'webp' };

  // ── Non-TIFF RAW containers ─────────────────────────────────────────
  // Canon CR3: "ftypcrx" at offset 4 (ISO BMFF)
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
      b[8] === 0x63 && b[9] === 0x72 && b[10] === 0x78) {
    return { kind: 'raw', format: 'cr3' };
  }
  // Fuji RAF: "FUJIFILM"
  if (b[0] === 0x46 && b[1] === 0x55 && b[2] === 0x4A && b[3] === 0x49 &&
      b[4] === 0x46 && b[5] === 0x49 && b[6] === 0x4C && b[7] === 0x4D) {
    return { kind: 'raw', format: 'raf' };
  }

  // ── TIFF-based (DNG, NEF, ARW, ORF, RW2, PEF, CR2, and many more) ──
  const isTiffLE = b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A && b[3] === 0x00;
  const isTiffBE = b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00 && b[3] === 0x2A;
  if (isTiffLE || isTiffBE) {
    // CR2 tags "CR" at offset 8 — cheap check
    if (b[8] === 0x43 && b[9] === 0x52) return { kind: 'raw', format: 'cr2' };
    // Any other TIFF variant: rawler figures it out from the IFD tags
    return { kind: 'raw', format: 'tiff-unknown' };
  }

  return { kind: 'unknown', hint: hexPreview(b) };
}

function hexPreview(b: Uint8Array): string {
  return Array.from(b.slice(0, 8))
    .map(n => n.toString(16).padStart(2, '0')).join(' ');
}

export function formatName(f: DetectedFormat): string {
  if (f.kind === 'standard') return f.format.toUpperCase();
  if (f.kind === 'raw') {
    const map: Record<RawFormat, string> = {
      dng: 'Adobe DNG', cr2: 'Canon CR2', cr3: 'Canon CR3',
      nef: 'Nikon NEF', arw: 'Sony ARW', raf: 'Fujifilm RAF',
      orf: 'Olympus ORF', rw2: 'Panasonic RW2',
      'tiff-unknown': 'TIFF-based RAW',
    };
    return map[f.format];
  }
  return `unknown (${f.hint})`;
}
