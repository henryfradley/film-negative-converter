# NEGATIVE.LAB

A browser-based film negative → positive converter. Drop a camera-scanned RAW, drag a crop, tweak the tone, download a positive. Nothing leaves your machine.

**Live:** [film-negative-converter.vercel.app](https://film-negative-converter.vercel.app)

![Kodak-inspired UI screenshot](https://raw.githubusercontent.com/henryfradley/film-negative-converter/main/.github/screenshot.png)

## What this replaces

The traditional workflow for camera-scanned film is Lightroom (~$10/month) + Negative Lab Pro (~$100 one-time). This tool does the same core job for free, in-browser, no install.

## How it works

The tone pipeline runs entirely in your browser:

1. **Decode** — Rust compiled to WebAssembly (`rawler` + bilinear demosaic) parses the RAW file into linear RGB
2. **Invert** — log-space density conversion: `D = log(base) − log(pixel)` per channel. Removes the orange C41 mask and inverts tonality in one operation.
3. **Adjust** — per-channel auto-levels acts as auto white balance; a WebGL2 fragment shader applies contrast, curves, saturation, split-toning, sharpening, crop, and rotation in a single pass
4. **Export** — download renders through the same shader at full crop resolution via a WebGL framebuffer

Full pipeline explanation lives in the **How it works** page inside the app.

## Supported formats

- **Camera RAW** — DNG, NEF (non-HE*), CR2/CR3, ARW, RAF, ORF, RW2, PEF, SRW, IIQ, 3FR, DCR, MRW
- **Standard** — JPEG, PNG, WebP

Nikon HE / HE* NEFs aren't yet supported by any open-source decoder. Convert to DNG first via Adobe's free [DNG Converter](https://helpx.adobe.com/camera-raw/using/adobe-dng-converter.html).

## Running locally

```bash
git clone https://github.com/henryfradley/film-negative-converter
cd film-negative-converter
npm install
npm run dev
```

Vite dev server on `http://localhost:5173`.

### Rebuilding the WASM decoder

The compiled WASM output (`decoder/pkg/`) is checked in so `npm run dev` and Vercel deploys work out of the box. If you change any Rust code, rebuild with:

```bash
npm run wasm       # runs `wasm-pack build --target web --no-default-features`
```

The GitHub Actions workflow (`.github/workflows/wasm.yml`) rebuilds this automatically on every push that touches Rust code.

**Prerequisites for the Rust build:**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Native decoder binary

For batch processing, debugging, or CLI use, there's also a native binary that uses system libraw:

```bash
brew install libraw
cd decoder
cargo run --bin decode_native -- path/to/negative.dng
# → produces output_positive.png + output.bin
```

## Project layout

```
/decoder            Rust: WASM decoder (rawler) + native binary (libraw)
/decoder/pkg        Compiled WASM output (committed for zero-config deploys)
/src
  main.ts          Orchestration + event wiring
  gl.ts            WebGL2 renderer + tone shader
  worker.ts        Runs the WASM decoder off the main thread
  db.ts            IndexedDB session persistence
/index.html        Full UI markup + styles (single-file for simplicity)
/vercel.json       Static hosting config (WASM MIME + immutable cache)
/.github/workflows Auto-rebuild WASM on push
```

## Deploying

Static deploy — any host works. The included `vercel.json` sets the correct MIME type for `.wasm` files and immutable cache headers on hashed assets.

```bash
npx vercel        # first time: log in + link
npx vercel --prod
```

Or connect the repo in the Vercel dashboard — framework auto-detects as Vite.

## Privacy

Your files never leave your machine. There is no server processing negatives; the site is 100% static assets served by a CDN. The Rust decoder runs in-browser via WebAssembly and the tone pipeline runs on your GPU. Session state persists in `IndexedDB`, local to your browser only.

## License

MIT — do whatever you want with it.
