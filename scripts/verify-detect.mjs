#!/usr/bin/env node
/**
 * Smoke test for the magic-byte detector. Feeds real-world magic-byte
 * prefixes for each supported format and asserts the classification.
 * Run with: node scripts/verify-detect.mjs
 */

import { detectFormat, formatName } from '../src/detect.ts';

// Prefix bytes taken from real files' first 16 bytes.
const CASES = [
  ['JPEG',     'FF D8 FF E0 00 10 4A 46 49 46 00 01 01 00 00 01', { kind: 'standard', format: 'jpeg' }],
  ['PNG',      '89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52', { kind: 'standard', format: 'png' }],
  ['WebP',     '52 49 46 46 24 00 00 00 57 45 42 50 56 50 38 20', { kind: 'standard', format: 'webp' }],
  ['CR3',      '00 00 00 18 66 74 79 70 63 72 78 20 00 00 00 01', { kind: 'raw',      format: 'cr3'  }],
  ['RAF',      '46 55 4A 49 46 49 4C 4D 43 43 44 2D 52 41 57 20', { kind: 'raw',      format: 'raf'  }],
  ['DNG/TIFF', '49 49 2A 00 08 00 00 00 10 00 00 01 03 00 01 00', { kind: 'raw',      format: 'tiff-unknown' }],
  ['CR2',      '49 49 2A 00 10 00 00 00 43 52 02 00 00 00 03 00', { kind: 'raw',      format: 'cr2'  }],
  ['garbage',  'DE AD BE EF DE AD BE EF DE AD BE EF DE AD BE EF', { kind: 'unknown' }],
];

const hexToBuf = (hex) => new Uint8Array(hex.split(' ').map(h => parseInt(h, 16))).buffer;

let pass = 0, fail = 0;
for (const [name, hex, expected] of CASES) {
  const result = detectFormat(hexToBuf(hex));
  const ok = result.kind === expected.kind
    && ('format' in expected ? result.format === expected.format : true);
  const label = formatName(result);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(10)} → ${result.kind}${'format' in result ? ':' + result.format : ''}  (${label})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
