# Work Backlog

Prioritized tickets from the second staff-engineer review (2026-07-26).
Each is scoped small enough to land in one PR. `P0` = shipping blockers,
`P1` = real user impact, `P2` = polish/nice-to-have.

---

## NEG-01 — Extract `frames.ts` from `main.ts`
**Priority:** P1  ·  **Effort:** M (2–3 hours)  ·  **Status:** open

### Problem
`src/main.ts` is 771 lines with 34 top-level functions. It handles routing,
view swap, frame store, drag delegation, downloads, keyboard, presets,
DB syncing, thumbnails, sliders, orientation, apply-all, errors, and
window-resize concerns. The load-bearing chunk — the frame store — is what
everything else couples to.

Every mutation (`addFrameFromBuffer`, `switchTo`, `removeFrame`, `renderThumb`)
reaches into `main.ts` globals. Testing anything requires a browser context.
Two people editing this file will conflict on nearly every PR.

### Proposed solution
Extract a `frames.ts` module that owns:
- `Frame` interface
- `frames[]` array + `currentIdx` + `nextId`
- `addFrameFromBuffer()`, `switchTo()`, `removeFrame()`
- Optional: `renderThumb()` (or leave in main since it needs the renderer)
- Emits events (or accepts callbacks) for `on-frame-added`, `on-switch`,
  `on-frame-removed` so `main.ts` can react without shared state.

### Acceptance criteria
- [ ] `frames.ts` created; no DOM refs, no renderer refs (pass renderer via a small context object like `crop.ts` does)
- [ ] `main.ts` under 500 lines
- [ ] All existing behaviour preserved (drop → decode → thumb → switch → remove works exactly as before)
- [ ] Build + typecheck + existing detector tests still pass in CI

### Files
- `src/main.ts` (shrink)
- `src/frames.ts` (new)

### Blocks
- NEG-02 (memory eviction) — needs a clean frame API to hang eviction off
- NEG-03 (tests) — needs testable module boundary

---

## NEG-02 — Memory eviction for decoded frame pixels
**Priority:** P0  ·  **Effort:** M (3–4 hours)  ·  **Status:** open

### Problem
Every loaded frame keeps its `Float32Array` of decoded RGB pixels in RAM
forever. A 24MP frame is ~280MB decoded. A 36-exposure roll = ~10GB.

- **Desktop Chrome:** kills tab around 4GB → session dies at ~14 frames
- **iPhone Safari:** kills tab around 500MB → session dies at 1–2 frames
- Batch "Download all" holds all pixels simultaneously

Advertised as batch-capable; not actually batch-capable at real roll sizes.

### Proposed solution
LRU eviction. Keep decoded pixels only for the current frame + N most-recently-switched neighbours (N=2 by default). Others hold only the file `ArrayBuffer` (~40MB per DNG).

On `switchTo(i)`:
1. If `frames[i].pixels` is null → re-decode from IDB `buffer` (~1s in WASM)
2. Evict oldest frame's `pixels` (set to `null`, keep buffer)
3. Upload to renderer

Requires:
- Bump `Frame.pixels` type to `Float32Array | null`
- Fetch the file buffer from IDB during re-decode (currently the buffer isn't kept in memory after `loadFiles`)
- Loading overlay during re-decode to give feedback (~1s wait)

### Acceptance criteria
- [ ] Loading a roll of 30+ frames doesn't OOM the tab
- [ ] Switching to an evicted frame shows a brief loading state (< 2s)
- [ ] "Download all" evicts as it goes so peak memory stays bounded
- [ ] iOS Safari can hold at least 5 frames without dying
- [ ] Test on iPhone SE / iPad / desktop Chrome with 20-frame session

### Files
- `src/frames.ts` (from NEG-01)
- `src/main.ts` (switch/download flow)
- `src/db.ts` (add `getFrameBuffer(id)` helper)

### Depends on
- NEG-01

---

## NEG-03 — Vitest + tests for the pure-logic modules
**Priority:** P1  ·  **Effort:** M (2–3 hours)  ·  **Status:** open

### Problem
One smoke test exists (`scripts/verify-detect.mjs`, 8 magic-byte cases).
Nothing tests:
- `invert.rs` — log-space math is easy to break subtly (green cast, lifted blacks, wrong film-base sampling)
- `crop.ts` — 3:2 aspect math in UV space with orient/rotate has non-obvious edge cases
- Worker percentile computation — could regress silently
- Preset application

Any refactor to the shader or crop logic is currently walking blind.

### Proposed solution
Add vitest as a dev dep. Migrate `verify-detect.mjs` into `test/detect.test.ts`.
Add cases:

**`test/invert.test.ts`** (Rust — separate `cargo test` target or use `wasm-bindgen-test`):
- Given known input pixels + base, produce expected density
- Auto-levels of a known histogram produces expected `bwLo`/`bwHi`

**`test/crop.test.ts`**:
- Corner drag preserves opposite corner
- 3:2 lock on portrait source produces 2:3 UV rect
- 3:2 lock on landscape 3:2 source produces a UV square (regression test)

**`test/detect.test.ts`**:
- Move the 8 cases from `verify-detect.mjs`
- Add: TIFF with CR2 signature returns `cr2` not `tiff-unknown`

**`test/percentile.test.ts`** (worker helper):
- 99th percentile of uniform distribution = ~0.99
- Clipped-values filter drops values ≥ 0.999

### Acceptance criteria
- [ ] `npm test` runs vitest, exits nonzero on failure
- [ ] CI (`.github/workflows/ci.yml`) runs vitest, not the shell script
- [ ] At least 15 assertions across the four suites
- [ ] `verify-detect.mjs` deleted, cases live in `test/detect.test.ts`
- [ ] Cargo test target for `invert.rs`, invoked from a new `cargo-test` CI job

### Files
- `package.json` (vitest, `test` script)
- `test/*.test.ts` (new)
- `vitest.config.ts` (new)
- `.github/workflows/ci.yml`
- `scripts/verify-detect.mjs` (delete)
- `decoder/src/invert.rs` (add `#[cfg(test)]` module)

### Depends on
- NEG-01 (needs extracted modules to test cleanly)

---

## NEG-04 — Block user input during batch operations
**Priority:** P1  ·  **Effort:** S (30 min)  ·  **Status:** open

### Problem
Loading overlay (`.loading.on`) visually covers the UI with `z-index: 100`
but doesn't stop **keyboard** events:
- Arrow keys can navigate frames mid-batch → texture upload race
- Enter/Escape can toggle preview mode mid-batch
- Slider drags can start via mouse if user dodges the overlay somehow

During "Download all" (currently ~2s per frame × N frames), user has plenty
of time to interfere and corrupt state.

### Proposed solution
Single global `busy: boolean` flag. Set true during:
- `loadFiles()` decode loop
- `restoreSaved()`
- `Download all`
- Any operation that swaps the renderer texture

Guard all input handlers:
- Keyboard: `if (busy) return` at top of the `keydown` listener
- Sliders: `input.disabled = busy` for all controls
- Buttons: same

Loading overlay already has `pointer-events: auto` on the semi-transparent
background, so mouse is blocked visually — this fix covers keyboard + programmatic.

### Acceptance criteria
- [ ] Pressing arrow keys during "Download all" is ignored
- [ ] Enter/Escape are ignored during any decode operation
- [ ] Sliders are visually disabled during busy state
- [ ] When busy clears, all handlers wake up normally

### Files
- `src/main.ts`

---

## NEG-05 — Per-thumbnail FBO (kill texture swap race)
**Priority:** P2  ·  **Effort:** M (2 hours)  ·  **Status:** open

### Problem
`renderThumb(frame)`:
1. `savePixels()` — grab pointer to current frame's pixels
2. `renderer.uploadNegative(frame.pixels)` — upload 280MB to GPU
3. Render to thumb canvas at 220×147
4. `renderer.uploadNegative(current.pixels)` — re-upload 280MB
5. `render()` — restore visible canvas

**Costs:**
- ~560MB GPU bandwidth per thumb refresh
- If interleaved with any async op → state corrupts
- "Apply tone to all" does this in a loop for every frame

### Proposed solution
Render each thumbnail to a dedicated per-frame FBO that stays alive. Its
input texture is separate from the main renderer's — we upload once per
frame (at load time), reuse forever.

Alternative (simpler, worse perf): keep the current approach but wrap in a
mutex flag so concurrent calls queue instead of interleave.

### Acceptance criteria
- [ ] `renderThumb` never touches `renderer.tex`
- [ ] Each frame has an owned WebGLTexture and WebGLFramebuffer for its thumb
- [ ] "Apply tone to all" completes without touching the main texture
- [ ] Dispose thumbs' GL resources on `removeFrame`
- [ ] Memory audit: no leaked textures after adding + removing 10 frames

### Files
- `src/gl.ts` (add ThumbnailRenderer or per-frame FBO helpers)
- `src/main.ts` (renderThumb signature)

---

## NEG-06 — IndexedDB transaction safety for `updateFrame`
**Priority:** P2  ·  **Effort:** S (45 min)  ·  **Status:** open

### Problem
`db.updateFrame(id, patch)` does:
```ts
const get = store.get(id);
get.onsuccess = () => store.put({...get.result, ...patch});
```

The `get` and `put` are separate ops within the same transaction, but
**two concurrent `updateFrame(id, patch)` calls will race** — each reads,
each writes their patch on top of the pre-read state. Last write wins,
intermediate patches silently dropped.

The debounced saves fire from many code paths (slider input, drag end,
preset click, orient, apply-all). Rapid slider dragging while apply-all
runs on the current frame could lose settings.

### Proposed solution
Use IDB's `versionchange` transaction with a cursor that read-modify-writes
atomically. Or serialize per-id updates through a Promise chain:

```ts
const pending = new Map<number, Promise<void>>();
export function updateFrame(id, patch) {
  const prev = pending.get(id) ?? Promise.resolve();
  const next = prev.then(() => doUpdate(id, patch));
  pending.set(id, next);
  return next;
}
```

### Acceptance criteria
- [ ] 100 rapid `updateFrame(1, {params: {sSlope: i}})` calls all land in DB (final value == 99)
- [ ] Added as a vitest case in `test/db.test.ts`

### Files
- `src/db.ts`
- `test/db.test.ts` (new)

### Depends on
- NEG-03 (test infra)

---

## NEG-07 — Delete `invert.rs` duplication (or make it authoritative)
**Priority:** P2  ·  **Effort:** S (1 hour)  ·  **Status:** open

### Problem
`decoder/src/invert.rs` (115 lines) reimplements the same log-space
inversion + auto-levels + S-curve + saturation + BW-stretch pipeline
that lives in `src/gl.ts`'s fragment shader.

- Only consumer: `decode_native` binary (developer tool, not shipped)
- Change the algorithm → change it twice, or the two drift
- We already had `invert.rs` and the shader agree on the algo by accident

### Proposed solution — pick one

**A. Delete.** Remove `invert.rs` and simplify `decode_native` to only
emit the linear decode (drop `output_positive.png`). Loses the ability to
generate sample images from CLI, gains one less thing to maintain.

**B. Make it the spec.** Keep `invert.rs`, add unit tests (NEG-03), treat
it as the source of truth. Whenever the shader changes, update
`invert.rs` too. Add a comment in `gl.ts` cross-referencing the Rust file.

**C. Golden-image test.** Native binary produces `output_positive.png`
for a fixed input DNG; shader renders same input to a Canvas; a test
compares SSIM > 0.98. Catches drift automatically. More work.

Recommend **A** unless you're planning to ship a CLI.

### Acceptance criteria
- [ ] Decision documented in `PLAN.md`
- [ ] Chosen path implemented
- [ ] No stale files left behind

### Files
- `decoder/src/invert.rs`
- `decoder/src/bin/decode_native.rs`
- `decoder/src/lib.rs`
- `PLAN.md`

---

## NEG-08 — B&W-only inversion path
**Priority:** P1  ·  **Effort:** M (2 hours)  ·  **Status:** open

### Problem
Advertised in the original phasing (`PLAN.md`) but never built. B&W film
(HP5, Tri-X, Delta 100) has no colour mask — running it through the
current per-channel auto-levels produces a slight colour cast that has to
be manually neutralized every time.

### Proposed solution
Add a `Frame.bw: boolean` flag + toggle button.

When `bw = true`:
- Compute density on **luminance** (0.2126 R + 0.7152 G + 0.0722 B) instead of per-channel
- Skip the per-channel auto-levels stretch (use single-channel version)
- Force saturation to 0 in shader
- Skip Temperature/Tint/split-toning uniforms

Shader gets a `u_bw` uniform; new branch in `tone()`.

### Acceptance criteria
- [ ] "B&W" toggle in the Tone section
- [ ] Persisted per-frame in IDB
- [ ] "Neutral B&W" preset added
- [ ] Test with an HP5 negative if available; otherwise force via UI

### Files
- `src/gl.ts` (shader + params)
- `src/main.ts` (toggle handler)
- `index.html` (button)
- `src/presets.ts` (add BW preset)

---

## NEG-09 — 16-bit TIFF export
**Priority:** P2  ·  **Effort:** M (3 hours)  ·  **Status:** open

### Problem
Currently only PNG export at 8-bit. Photographers who want to further
edit in Lightroom or Photoshop lose gradation in shadows/highlights that
would survive in 16-bit. This is a common pro-workflow expectation.

### Proposed solution
Render to a floating-point FBO (`RGBA32F`) at full crop resolution, read
back `Float32Array`, encode as 16-bit TIFF client-side.

TIFF encoding: use a small library (`utif` or `geotiff` write path) or
write our own — the format is well-documented and the write path for
striped uncompressed 16-bit is ~150 lines of typed-array manipulation.

Alternative: write ImageJ-style raw + a `.txt` sidecar. Simpler but less
compatible.

### Acceptance criteria
- [ ] "Download TIFF (16-bit)" button beside "Download PNG"
- [ ] File opens in Photoshop / Preview / Affinity with correct colour
- [ ] File size is reasonable (< 200MB for 24MP)
- [ ] No visible banding vs the on-screen preview

### Files
- `src/gl.ts` (32F FBO path)
- `src/tiff-encode.ts` (new)
- `src/main.ts` (button)
- `index.html`

---

## NEG-10 — Accessibility pass
**Priority:** P2  ·  **Effort:** M (3 hours)  ·  **Status:** open

### Problem
- No ARIA labels on sliders — screen readers announce "slider" only
- No focus styles — keyboard users can't see what's focused
- Canvas has no `alt` equivalent or `aria-label`
- Buttons with just icons (`↺ 90°`, `⇋ Flip horizontal`) may not read correctly
- Drop zone doesn't announce state changes ("negative loaded")
- Tab order through the sidebar is undefined

### Proposed solution
Systematic pass:
- Every `<input type="range">` gets `aria-label` + `aria-valuenow`
- Every icon-only button gets `aria-label`
- Focus ring on all interactive elements (currently disabled by default)
- Canvas element gets `role="img"` + `aria-label="Film negative preview"`
- Toast already has `role="alert"` — verify it announces
- Loading overlay gets `aria-busy="true"` on `<body>`
- Skip-link to jump straight to the drop zone

### Acceptance criteria
- [ ] Lighthouse accessibility score > 90
- [ ] Tab through the entire editor without losing focus
- [ ] VoiceOver / NVDA announces slider values as they change
- [ ] Manual test with keyboard only: load a file → adjust contrast → download

### Files
- `index.html` (attributes)
- CSS focus states

---

## NEG-11 — WebP sample images
**Priority:** P3  ·  **Effort:** S (30 min)  ·  **Status:** open

### Problem
`sample-negative.jpg` (167KB) + `sample-positive.jpg` (383KB) = **550KB
downloaded on every first visit** to the homepage. WebP at similar quality
is ~40% smaller.

### Proposed solution
Generate WebP versions, use `<picture>` with WebP source + JPEG fallback.

```html
<picture>
  <source srcset="/samples/sample-positive.webp" type="image/webp">
  <img src="/samples/sample-positive.jpg" alt="...">
</picture>
```

Generate with `sips`:
```bash
sips -s format webp -s formatOptions 78 sample-positive.jpg --out sample-positive.webp
```

### Acceptance criteria
- [ ] WebP versions committed to `public/samples/`
- [ ] `<picture>` markup in homepage
- [ ] Total sample-image weight < 300KB
- [ ] JPEG fallback still loads on browsers without WebP

### Files
- `public/samples/*.webp` (new)
- `index.html`

---

## NEG-12 — Custom domain + fix hardcoded canonical URLs
**Priority:** P3  ·  **Effort:** S (15 min once domain exists)  ·  **Status:** open

### Problem
SEO meta tags, OG image URLs, sitemap, robots.txt all hardcode
`https://film-negative-converter.vercel.app`. If the project moves to a
custom domain (e.g. `negativeconverter.app`), all this needs updating.

### Proposed solution
- Buy/configure custom domain in Vercel
- Find/replace `film-negative-converter.vercel.app` → new host in:
  - `index.html` (canonical, OG, Twitter URLs)
  - `public/robots.txt`
  - `public/sitemap.xml`
- Set up 301 redirect from vercel subdomain → custom domain

### Acceptance criteria
- [ ] Custom domain live with HTTPS
- [ ] Old vercel subdomain 301s to new
- [ ] Google Search Console verified for new domain
- [ ] All URLs across the repo point to new domain

### Files
- `index.html`, `public/robots.txt`, `public/sitemap.xml`, Vercel dashboard

---

## Ticket cheat sheet

| ID     | Priority | Effort | One-liner                                                |
|--------|----------|--------|----------------------------------------------------------|
| NEG-01 | P1       | M      | Extract `frames.ts` from `main.ts`                       |
| NEG-02 | **P0**   | M      | Memory eviction — actually support multi-frame sessions  |
| NEG-03 | P1       | M      | Vitest + real tests for pure-logic modules               |
| NEG-04 | P1       | S      | Block keyboard/input during batch operations             |
| NEG-05 | P2       | M      | Per-thumbnail FBO (kill main-texture swap)               |
| NEG-06 | P2       | S      | IndexedDB transaction safety for `updateFrame`           |
| NEG-07 | P2       | S      | Delete or authoritise `invert.rs` duplication            |
| NEG-08 | P1       | M      | B&W-only inversion path                                  |
| NEG-09 | P2       | M      | 16-bit TIFF export                                       |
| NEG-10 | P2       | M      | Accessibility pass (ARIA, focus, keyboard-only nav)      |
| NEG-11 | P3       | S      | WebP sample images (~40 % size cut)                      |
| NEG-12 | P3       | S      | Custom domain + URL sweep                                |

**Recommended order to keep momentum:**
NEG-01 → NEG-02 → NEG-04 → NEG-03 → then pick from remaining.
