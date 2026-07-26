# Film Negative Converter — Plan

Browser-based film negative → positive converter. No Adobe, no server.

## Stack
- **Decode (native):** rsraw (Rust) → system libraw 0.22.2
- **Decode (browser):** rawler (Rust→WASM) + bilinear demosaic; browser-native for JPEG/PNG/WebP
- **Frontend:** Vite + TypeScript (no framework)
- **Processing:** WebGL2 fragment shader (all tone/color/geom in one pass)
- **Persistence:** IndexedDB (frames + params survive page reload)
- **Hosting:** static via Vercel

## Features
- [x] DNG + all rawler-supported RAW + JPEG/PNG/WebP input
- [x] Log-space inversion, per-channel auto-levels
- [x] Manual sliders: contrast, curves, saturation, sharpen, temp, tint, shadow/highlight warmth, black/white
- [x] Fine rotation (±15°) + 90° orientation buttons
- [x] Drag-drop manual crop, 3:2 lock, Apply-crop preview mode
- [x] 8 curated tone presets (Neutral/Portrait/Vivid/Golden/Cinematic/Faded/Moody/Cool)
- [x] Multi-file batch: thumbnail strip, per-frame settings, Apply-tone-to-all
- [x] PNG download (single + batch), rendered at full crop resolution via FBO
- [x] Session persistence via IndexedDB (file buffers + params)
- [x] Retro film UI (amber accent, monospace, sprocket motifs, animated loading)
- [ ] Hosting on Vercel

## Repo layout
```
/decoder      Rust: native binary (rsraw/libraw) + WASM lib (rawler + demosaic)
/decoder/pkg  Generated WASM output (COMMITTED — Vercel doesn't build WASM)
/src          Vite frontend: main.ts, worker.ts, gl.ts, db.ts
/dist         Vite build output
vercel.json   Vercel config (WASM MIME + immutable asset caching)
PLAN.md
```

## Deploying to Vercel
1. **Commit the WASM output**: `decoder/pkg/*` MUST be committed — Vercel can't run wasm-pack.
2. **Push to GitHub** (or any git remote Vercel supports).
3. **Import in Vercel**: framework auto-detects as Vite. Zero config needed beyond `vercel.json`.
4. Or via CLI: `npx vercel` (login, deploy). `npx vercel --prod` for production.

## Key decisions
- Vite over Next.js: this is a client-only single-page WebGL/WASM tool; no routes, no SSR needed.
- libraw over rawler (native) for HE* readiness; rawler + bilinear demosaic (WASM)
- HE* NEF still unsupported by libraw; DNG conversion required as workaround
- Log-space density inversion: `D = log(base) − log(pixel)`. Linear `base/pixel` always clips.
- No sRGB gamma at output — density is already log-space (perceptual)
- Store file buffers in IDB, not decoded pixels (280MB decoded vs ~40MB compressed)
- Auto-crop is unreliable across scenes; manual crop is the primary UX

## Next
- Test on Vercel: make sure WASM loads with correct MIME, worker paths resolve
- B&W path: skip mask logic, luminance-only inversion
- 16-bit TIFF export (for further editing in Lightroom/Photoshop)
- (Nice-to-have) Straighten tool by clicking two horizon points
