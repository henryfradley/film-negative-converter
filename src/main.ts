import { Renderer, type StretchParams } from './gl';
import type { WorkerOut } from './worker';
import { saveFrame, updateFrame, deleteFrame, loadAllFrames, clearAll, type SavedFrame } from './db';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const status      = $<HTMLSpanElement>('status');
const drop        = $<HTMLDivElement>('drop');           // editor drop area
const dropHero    = $<HTMLDivElement>('drop-hero');       // home film-frame drop area
const file        = $<HTMLInputElement>('file');
const wrap        = $<HTMLDivElement>('canvas-wrap');
const canvas      = $<HTMLCanvasElement>('canvas');

// Views
const viewHero    = $<HTMLDivElement>('view-hero');
const viewEditor  = $<HTMLDivElement>('view-editor');
const viewHiw     = $<HTMLDivElement>('view-hiw');
const navHome     = $<HTMLElement>('nav-home');
const navHiw      = $<HTMLElement>('nav-hiw');
const btnLoad     = $<HTMLButtonElement>('btn-load');

type View = 'home' | 'editor' | 'hiw';
let activeView: View = 'home';
function setView(v: View) {
  activeView = v;
  viewHero.classList.toggle('active',   v === 'home');
  viewEditor.classList.toggle('active', v === 'editor');
  viewHiw.classList.toggle('active',    v === 'hiw');
  navHiw.classList.toggle('active',     v === 'hiw');
}
const cropRect    = $<HTMLDivElement>('crop-rect');
const dimTop      = $<HTMLDivElement>('dim-top');
const dimBottom   = $<HTMLDivElement>('dim-bottom');
const dimLeft     = $<HTMLDivElement>('dim-left');
const dimRight    = $<HTMLDivElement>('dim-right');
const controls    = $<HTMLElement>('controls');
const cropOverlay = $<HTMLDivElement>('crop');
const thumbStrip  = $<HTMLDivElement>('thumb-strip');
const thumbAdd    = $<HTMLButtonElement>('thumb-add');

const sContrast   = $<HTMLInputElement>('s-contrast');
const sSaturation = $<HTMLInputElement>('s-saturation');
const sCurves     = $<HTMLInputElement>('s-curves');
const sSharpen    = $<HTMLInputElement>('s-sharpen');
const sBlack      = $<HTMLInputElement>('s-black');
const sWhite      = $<HTMLInputElement>('s-white');
const sRotate     = $<HTMLInputElement>('s-rotate');
const sLock32     = $<HTMLInputElement>('s-lock32');
const sTemp       = $<HTMLInputElement>('s-temp');
const sTint       = $<HTMLInputElement>('s-tint');
const sShadowWarm = $<HTMLInputElement>('s-shadow-warm');
const sHighlightWarm = $<HTMLInputElement>('s-highlight-warm');
const vContrast   = $<HTMLSpanElement>('v-contrast');
const vSaturation = $<HTMLSpanElement>('v-saturation');
const vCurves     = $<HTMLSpanElement>('v-curves');
const vSharpen    = $<HTMLSpanElement>('v-sharpen');
const vBlack      = $<HTMLSpanElement>('v-black');
const vWhite      = $<HTMLSpanElement>('v-white');
const vRotate     = $<HTMLSpanElement>('v-rotate');
const vTemp       = $<HTMLSpanElement>('v-temp');
const vTint       = $<HTMLSpanElement>('v-tint');
const vShadowWarm = $<HTMLSpanElement>('v-shadow-warm');
const vHighlightWarm = $<HTMLSpanElement>('v-highlight-warm');
const btnReset      = $<HTMLButtonElement>('reset');
const btnCropReset  = $<HTMLButtonElement>('crop-reset');
const btnCropApply  = $<HTMLButtonElement>('crop-apply');
const btnApplyAll   = $<HTMLButtonElement>('apply-all');
const btnDownload   = $<HTMLButtonElement>('download');
const btnDownloadAll= $<HTMLButtonElement>('download-all');
const btnOrientCw   = $<HTMLButtonElement>('orient-cw');
const btnOrientCcw  = $<HTMLButtonElement>('orient-ccw');

const loading       = $<HTMLDivElement>('loading');
const loadingFile   = $<HTMLDivElement>('loading-file');
const loadingBar    = $<HTMLDivElement>('loading-bar-fill');
const loadingCount  = $<HTMLDivElement>('loading-count');

function showLoading(fileName: string, current: number, total: number, subLabel?: string) {
  loadingFile.textContent = subLabel ? `${subLabel} · ${fileName}` : fileName;
  const pct = total > 0 ? ((current / total) * 100).toFixed(0) : '0';
  loadingBar.style.width = `${pct}%`;
  loadingCount.textContent = `${current} / ${total}`;
  loading.classList.add('on');
}
function hideLoading() {
  loading.classList.remove('on');
}

/// Curated film-inspired starting points. Each preset overrides only the
/// tone/colour params it names; crop, orient, black/white points are left
/// alone (those are per-frame decisions).
type PresetKey =
  | 'sSlope' | 'saturation' | 'curves' | 'sharpen'
  | 'temp' | 'tint' | 'shadowWarm' | 'highlightWarm';
type Preset = { name: string } & Partial<Record<PresetKey, number>>;

const PRESETS: Preset[] = [
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

/// A loaded frame — pixels + settings + a rendered thumbnail canvas.
interface Frame {
  id: number;
  name: string;
  width: number;
  height: number;
  pixels: Float32Array;
  auto: WorkerOut;
  params: StretchParams;
  cropUV: [number, number, number, number];
  mode: 'edit' | 'preview';
  thumbCanvas: HTMLCanvasElement;
  thumbEl: HTMLDivElement;
}

let renderer: Renderer | null = null;
let frames: Frame[] = [];
let currentIdx = -1;
let nextId = 1;

function current(): Frame | null {
  return currentIdx >= 0 ? frames[currentIdx] : null;
}

function setStatus(s: string) { status.textContent = s; }

function ensureRenderer(): Renderer {
  if (!renderer) renderer = new Renderer(canvas);
  return renderer;
}

// ── params ────────────────────────────────────────────────────────────

function paramsFromAuto(a: WorkerOut, cropUV: [number, number, number, number]): StretchParams {
  return {
    logBase:   a.logBase,
    densityLo: a.densityLo,
    densityHi: a.densityHi,
    sSlope: 6.0,
    saturation: 1.3,
    bwLo: a.bwLo,
    bwHi: a.bwHi,
    cropMin: [cropUV[0], cropUV[1]],
    cropMax: [cropUV[2], cropUV[3]],
    rotate: 0,
    sharpen: 0,
    curves: 1.0,
    orient: 0,
    temp: 0,
    tint: 0,
    shadowWarm: 0,
    highlightWarm: 0,
  };
}

function updateSlidersFromParams(p: StretchParams) {
  sContrast.value   = p.sSlope.toString();
  sSaturation.value = p.saturation.toString();
  sCurves.value     = p.curves.toString();
  sSharpen.value    = p.sharpen.toString();
  sBlack.value      = p.bwLo.toString();
  sWhite.value      = p.bwHi.toString();
  sRotate.value     = p.rotate.toString();
  sTemp.value       = p.temp.toString();
  sTint.value       = p.tint.toString();
  sShadowWarm.value = p.shadowWarm.toString();
  sHighlightWarm.value = p.highlightWarm.toString();
  updateValueLabels();
}
function updateValueLabels() {
  const f = current(); if (!f) return;
  vContrast.textContent   = f.params.sSlope.toFixed(1);
  vSaturation.textContent = f.params.saturation.toFixed(2);
  vCurves.textContent     = f.params.curves.toFixed(2);
  vSharpen.textContent    = f.params.sharpen.toFixed(2);
  vBlack.textContent      = f.params.bwLo.toFixed(2);
  vWhite.textContent      = f.params.bwHi.toFixed(2);
  vRotate.textContent     = f.params.rotate.toFixed(1) + '°';
  vTemp.textContent       = f.params.temp.toFixed(2);
  vTint.textContent       = f.params.tint.toFixed(2);
  vShadowWarm.textContent = f.params.shadowWarm.toFixed(2);
  vHighlightWarm.textContent = f.params.highlightWarm.toFixed(2);
}

function render() {
  const f = current(); if (!f || !renderer) return;
  if (f.mode === 'preview') renderer.renderCropped(f.params);
  else renderer.render(f.params);
}

function setMode(m: 'edit' | 'preview') {
  const f = current(); if (!f) return;
  f.mode = m;
  cropOverlay.style.display = m === 'edit' ? 'block' : 'none';
  btnCropApply.textContent  = m === 'edit' ? 'Apply crop ↵' : 'Edit crop ↵';
  btnCropReset.disabled     = m === 'preview';
  render();
}

// ── crop overlay position ─────────────────────────────────────────────

function paintCrop() {
  const f = current(); if (!f) return;
  const [x0, y0, x1, y1] = f.cropUV;
  const leftPct   = (x0 * 100).toFixed(3) + '%';
  const topPct    = (y0 * 100).toFixed(3) + '%';
  const rightPct  = ((1 - x1) * 100).toFixed(3) + '%';
  const bottomPct = ((1 - y1) * 100).toFixed(3) + '%';

  cropRect.style.left = leftPct;
  cropRect.style.top = topPct;
  cropRect.style.right = rightPct;
  cropRect.style.bottom = bottomPct;

  dimTop.style.cssText = `top:0;left:0;right:0;height:${topPct}`;
  dimBottom.style.cssText = `bottom:0;left:0;right:0;height:${bottomPct}`;
  dimLeft.style.cssText = `top:${topPct};bottom:${bottomPct};left:0;width:${leftPct}`;
  dimRight.style.cssText = `top:${topPct};bottom:${bottomPct};right:0;width:${rightPct}`;

  f.params.cropMin = [f.cropUV[0], f.cropUV[1]];
  f.params.cropMax = [f.cropUV[2], f.cropUV[3]];
}

// ── frames ────────────────────────────────────────────────────────────

async function decodeBuffer(buffer: ArrayBuffer, name: string, type: string): Promise<WorkerOut> {
  const workerBuf = buffer.slice(0); // clone so caller keeps the original
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const done = new Promise<WorkerOut>((resolve, reject) => {
    worker.onmessage = e => {
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data as WorkerOut);
    };
    worker.onerror = reject;
  });
  worker.postMessage({ buffer: workerBuf, name, type }, [workerBuf]);
  const r = await done;
  worker.terminate();
  return r;
}

// Debounced param persistence: flush the current frame's tone/crop to the DB
// half a second after the last slider move. Failure is silent (over-quota,
// private browsing, etc.) so it never blocks the UI.
const saveTimers = new Map<number, number>();
function scheduleSave(f: Frame) {
  const existing = saveTimers.get(f.id);
  if (existing) clearTimeout(existing);
  const t = window.setTimeout(async () => {
    saveTimers.delete(f.id);
    try {
      await updateFrame(f.id, {
        params: f.params,
        cropUV: f.cropUV,
        mode:   f.mode,
      });
    } catch { /* quota / disabled — ignore */ }
  }, 500);
  saveTimers.set(f.id, t);
}

function renderThumb(frame: Frame) {
  if (!renderer) return;
  // Save active texture state — we need to swap texture per thumb.
  const saved = savePixels();
  renderer.uploadNegative(frame.width, frame.height, frame.pixels);
  const thumbW = 220;
  const cropPxW = (frame.params.cropMax[0] - frame.params.cropMin[0]) * frame.width;
  const cropPxH = (frame.params.cropMax[1] - frame.params.cropMin[1]) * frame.height;
  const thumbH = Math.max(20, Math.round(thumbW * cropPxH / cropPxW));
  renderer.renderToCanvas(thumbW, thumbH, frame.params, frame.thumbCanvas);
  if (saved) {
    renderer.uploadNegative(saved.width, saved.height, saved.pixels);
    render();
  }
}
function savePixels() {
  const f = current(); if (!f) return null;
  return { width: f.width, height: f.height, pixels: f.pixels };
}

function createThumbEl(frame: Frame): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'thumb';
  div.title = frame.name;
  div.appendChild(frame.thumbCanvas);
  const x = document.createElement('button');
  x.className = 'thumb-x';
  x.textContent = '×';
  x.addEventListener('click', e => {
    e.stopPropagation();
    removeFrame(frame.id);
  });
  div.appendChild(x);
  div.addEventListener('click', () => {
    const i = frames.findIndex(fr => fr.id === frame.id);
    if (i >= 0) switchTo(i);
  });
  return div;
}

function refreshThumbStates() {
  frames.forEach((f, i) => {
    f.thumbEl.classList.toggle('active', i === currentIdx);
  });
}

/// Add a frame from an ArrayBuffer + metadata. Used both by fresh file drops
/// and by the restore-from-DB path on page boot.
async function addFrameFromBuffer(
  buffer: ArrayBuffer, name: string, type: string,
  saved?: { id: number; params: StretchParams; cropUV: [number, number, number, number]; mode: 'edit' | 'preview' },
): Promise<Frame> {
  const auto = await decodeBuffer(buffer, name, type);
  const cropUV = saved?.cropUV ?? [0.05, 0.05, 0.95, 0.95];
  const frame: Frame = {
    id: saved?.id ?? nextId++,
    name,
    width: auto.width,
    height: auto.height,
    pixels: auto.pixels,
    auto,
    params: saved?.params ?? paramsFromAuto(auto, cropUV),
    cropUV,
    mode: saved?.mode ?? 'edit',
    thumbCanvas: document.createElement('canvas'),
    thumbEl: null as any,
  };
  if (saved?.id != null && saved.id >= nextId) nextId = saved.id + 1;
  frame.thumbEl = createThumbEl(frame);
  frames.push(frame);
  return frame;
}

async function loadFiles(fileList: FileList | File[]) {
  const list = Array.from(fileList);
  const placeholders = list.map(f => {
    const el = document.createElement('div');
    el.className = 'thumb loading';
    el.title = `queued: ${f.name}`;
    thumbStrip.insertBefore(el, thumbAdd);
    thumbStrip.classList.add('ready');
    return el;
  });

  showLoading(list[0].name, 0, list.length);

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    showLoading(f.name, i, list.length);
    try {
      const buffer = await f.arrayBuffer();
      const frame  = await addFrameFromBuffer(buffer, f.name, f.type);
      placeholders[i].replaceWith(frame.thumbEl);

      if (frames.length === 1) {
        setView('editor');
        wrap.classList.add('ready');
        controls.hidden = false;
        ensureRenderer();
        switchTo(0);
      }
      renderThumb(frame);

      // Persist to IDB (fire-and-forget; over-quota just means no persistence)
      saveFrame({
        id: frame.id, name: frame.name, type: f.type, buffer,
        params: frame.params, cropUV: frame.cropUV, mode: frame.mode,
        order: frames.length - 1,
      }).catch(err => console.warn('[db] save failed:', err));
    } catch (err) {
      placeholders[i].remove();
      setStatus(`error on ${f.name}: ${err}`);
    }
    showLoading(f.name, i + 1, list.length);
  }
  hideLoading();
  setStatus(`${frames.length} frame${frames.length === 1 ? '' : 's'} loaded  ·  showing ${currentIdx + 1}`);
}

/// Called once on boot — decodes anything persisted from a previous session.
async function restoreSaved() {
  let saved: SavedFrame[] = [];
  try { saved = await loadAllFrames(); } catch { return; }
  if (saved.length === 0) return;

  thumbStrip.classList.add('ready');
  const placeholders = saved.map(s => {
    const el = document.createElement('div');
    el.className = 'thumb loading';
    el.title = `restoring: ${s.name}`;
    thumbStrip.insertBefore(el, thumbAdd);
    return el;
  });

  showLoading(saved[0].name, 0, saved.length, 'Restoring');
  for (let i = 0; i < saved.length; i++) {
    const s = saved[i];
    showLoading(s.name, i, saved.length, 'Restoring');
    try {
      const frame = await addFrameFromBuffer(s.buffer, s.name, s.type,
        { id: s.id, params: s.params, cropUV: s.cropUV, mode: s.mode });
      placeholders[i].replaceWith(frame.thumbEl);
      if (frames.length === 1) {
        setView('editor');
        wrap.classList.add('ready');
        controls.hidden = false;
        ensureRenderer();
        switchTo(0);
      }
      renderThumb(frame);
    } catch (err) {
      placeholders[i].remove();
      console.warn(`[restore] failed on ${s.name}:`, err);
    }
    showLoading(s.name, i + 1, saved.length, 'Restoring');
  }
  hideLoading();
  setStatus(`${frames.length} frame${frames.length === 1 ? '' : 's'} restored`);
}

function switchTo(i: number) {
  if (i < 0 || i >= frames.length || !renderer) return;
  currentIdx = i;
  const f = frames[i];
  renderer.uploadNegative(f.width, f.height, f.pixels);
  updateSlidersFromParams(f.params);
  paintCrop();
  setMode(f.mode);
  refreshThumbStates();
  setStatus(`${f.name}  ·  ${f.width}×${f.height}  ·  ${currentIdx + 1}/${frames.length}`);
}

function removeFrame(id: number) {
  const i = frames.findIndex(f => f.id === id);
  if (i < 0) return;
  frames[i].thumbEl.remove();
  frames.splice(i, 1);
  deleteFrame(id).catch(() => {});
  if (frames.length === 0) {
    currentIdx = -1;
    setView('home');
    wrap.classList.remove('ready');
    thumbStrip.classList.remove('ready');
    controls.hidden = true;
    setStatus('Load a negative');
    return;
  }
  if (currentIdx >= frames.length) currentIdx = frames.length - 1;
  else if (currentIdx > i) currentIdx--;
  switchTo(currentIdx);
}

// ── slider live updates ───────────────────────────────────────────────
function clearPresetActive() {
  presetsEl?.querySelectorAll<HTMLButtonElement>('.preset-btn.active')
    .forEach(b => b.classList.remove('active'));
}
const bind = (input: HTMLInputElement, k: keyof StretchParams) => {
  input.addEventListener('input', () => {
    const f = current(); if (!f) return;
    (f.params as any)[k] = parseFloat(input.value);
    updateValueLabels(); render();
    clearPresetActive();
    scheduleSave(f);
  });
};
// ── preset chips ──────────────────────────────────────────────────────
const presetsEl = $<HTMLDivElement>('presets');
function buildPresets() {
  presetsEl.innerHTML = '';
  PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = p.name;
    btn.dataset.name = p.name;
    btn.addEventListener('click', () => applyPreset(p));
    presetsEl.appendChild(btn);
  });
}
function applyPreset(p: Preset) {
  const f = current(); if (!f) return;
  const keys: PresetKey[] = ['sSlope', 'saturation', 'curves', 'sharpen',
    'temp', 'tint', 'shadowWarm', 'highlightWarm'];
  for (const k of keys) {
    const v = (p as any)[k];
    if (v !== undefined) (f.params as any)[k] = v;
  }
  updateSlidersFromParams(f.params);
  render();
  presetsEl.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.name === p.name);
  });
  scheduleSave(f);
}
buildPresets();

bind(sContrast, 'sSlope');
bind(sSaturation, 'saturation');
bind(sCurves, 'curves');
bind(sSharpen, 'sharpen');
bind(sBlack, 'bwLo');
bind(sWhite, 'bwHi');
bind(sRotate, 'rotate');
bind(sTemp, 'temp');
bind(sTint, 'tint');
bind(sShadowWarm, 'shadowWarm');
bind(sHighlightWarm, 'highlightWarm');

btnReset.addEventListener('click', () => {
  const f = current(); if (!f) return;
  const savedCrop = { min: f.params.cropMin, max: f.params.cropMax };
  f.params = paramsFromAuto(f.auto, f.cropUV);
  f.params.cropMin = savedCrop.min;
  f.params.cropMax = savedCrop.max;
  updateSlidersFromParams(f.params);
  render();
});
btnCropReset.addEventListener('click', () => {
  const f = current(); if (!f) return;
  f.cropUV = [0, 0, 1, 1];
  paintCrop();
  render();
});
btnCropApply.addEventListener('click', () => {
  const f = current(); if (!f) return;
  setMode(f.mode === 'edit' ? 'preview' : 'edit');
});
btnApplyAll.addEventListener('click', () => {
  const f = current(); if (!f) return;
  const keys: (keyof StretchParams)[] = ['sSlope', 'saturation', 'curves', 'sharpen',
    'bwLo', 'bwHi', 'rotate', 'temp', 'tint', 'shadowWarm', 'highlightWarm'];
  for (const other of frames) {
    if (other.id === f.id) continue;
    for (const k of keys) (other.params as any)[k] = (f.params as any)[k];
    renderThumb(other);
    scheduleSave(other);
  }
  setStatus(`Tone applied to ${frames.length - 1} other frame${frames.length === 2 ? '' : 's'}.`);
});

function rotate90(dir: 1 | -1) {
  const f = current(); if (!f) return;
  f.params.orient = (((f.params.orient + dir) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
  f.cropUV = [0, 0, 1, 1];
  paintCrop();
  render();
  renderThumb(f);
  scheduleSave(f);
}
btnOrientCw.addEventListener('click',  () => rotate90( 1));
btnOrientCcw.addEventListener('click', () => rotate90(-1));
document.addEventListener('keydown', e => {
  const f = current(); if (!f) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    setMode(f.mode === 'edit' ? 'preview' : 'edit');
  } else if (e.key === 'Escape' && f.mode === 'preview') {
    setMode('edit');
  } else if (e.key === 'ArrowLeft' && currentIdx > 0) {
    switchTo(currentIdx - 1);
  } else if (e.key === 'ArrowRight' && currentIdx < frames.length - 1) {
    switchTo(currentIdx + 1);
  }
});

btnDownload.addEventListener('click', async () => {
  const f = current(); if (!f || !renderer) return;
  btnDownload.disabled = true; btnDownload.textContent = 'Rendering…';
  try {
    const blob = await renderer.renderToPng(f.params);
    triggerDownload(blob, f.name);
  } finally {
    btnDownload.disabled = false; btnDownload.textContent = 'Download PNG';
  }
});

btnDownloadAll.addEventListener('click', async () => {
  if (!renderer) return;
  btnDownloadAll.disabled = true;
  const savedIdx = currentIdx;
  try {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      showLoading(f.name, i, frames.length, 'EXPORTING');
      renderer.uploadNegative(f.width, f.height, f.pixels);
      const blob = await renderer.renderToPng(f.params);
      triggerDownload(blob, f.name);
      await new Promise(r => setTimeout(r, 100)); // browser breather between downloads
    }
    showLoading('', frames.length, frames.length, 'EXPORTING');
  } finally {
    switchTo(savedIdx);
    hideLoading();
    btnDownloadAll.disabled = false;
    btnDownloadAll.textContent = 'Download all';
  }
});

function triggerDownload(blob: Blob, sourceName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stem = sourceName.replace(/\.[^.]+$/, '');
  a.href = url;
  a.download = `${stem || 'positive'}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── crop drag/resize ──────────────────────────────────────────────────
type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';
interface DragState { mode: DragMode; startX: number; startY: number; startCrop: [number, number, number, number]; }
let drag: DragState | null = null;
const MIN_SIZE = 0.02;

function canvasUVFromMouse(e: PointerEvent): { x: number; y: number } {
  const rect = wrap.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}

function startDrag(e: PointerEvent, mode: DragMode) {
  const f = current(); if (!f) return;
  e.preventDefault();
  const uv = canvasUVFromMouse(e);
  drag = { mode, startX: uv.x, startY: uv.y, startCrop: [...f.cropUV] as [number, number, number, number] };
  (e.target as Element).setPointerCapture(e.pointerId);
}

function updateDrag(e: PointerEvent) {
  if (!drag) return;
  const f = current(); if (!f) return;
  const uv = canvasUVFromMouse(e);
  const dx = uv.x - drag.startX;
  const dy = uv.y - drag.startY;
  let [x0, y0, x1, y1] = drag.startCrop;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  if (drag.mode === 'move') {
    const w = x1 - x0, h = y1 - y0;
    x0 = clamp(x0 + dx, 0, 1 - w); y0 = clamp(y0 + dy, 0, 1 - h);
    x1 = x0 + w; y1 = y0 + h;
  } else {
    if (drag.mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_SIZE);
    if (drag.mode.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_SIZE, 1);
    if (drag.mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_SIZE);
    if (drag.mode.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_SIZE, 1);

    if (sLock32.checked) {
      const srcRatio = f.width / f.height;
      const startPixelW = (drag.startCrop[2] - drag.startCrop[0]) * f.width;
      const startPixelH = (drag.startCrop[3] - drag.startCrop[1]) * f.height;
      const targetPixelRatio = startPixelW >= startPixelH ? 1.5 : 1 / 1.5;
      const uvRatio = targetPixelRatio / srcRatio;
      const w = x1 - x0, h = y1 - y0;

      if (drag.mode === 'n' || drag.mode === 's') {
        const cx = (drag.startCrop[0] + drag.startCrop[2]) / 2;
        const newW = Math.min(h * uvRatio, 1);
        x0 = clamp(cx - newW / 2, 0, 1); x1 = clamp(cx + newW / 2, 0, 1);
      } else if (drag.mode === 'w' || drag.mode === 'e') {
        const cy = (drag.startCrop[1] + drag.startCrop[3]) / 2;
        const newH = Math.min(w / uvRatio, 1);
        y0 = clamp(cy - newH / 2, 0, 1); y1 = clamp(cy + newH / 2, 0, 1);
      } else {
        const currentUvRatio = w / h;
        if (currentUvRatio > uvRatio) {
          const newW = h * uvRatio;
          if (drag.mode.includes('w')) x0 = x1 - newW; else x1 = x0 + newW;
        } else {
          const newH = w / uvRatio;
          if (drag.mode.includes('n')) y0 = y1 - newH; else y1 = y0 + newH;
        }
      }
    }
  }
  f.cropUV = [clamp(x0, 0, 1), clamp(y0, 0, 1), clamp(x1, 0, 1), clamp(y1, 0, 1)];
  paintCrop();
}

function endDrag(e: PointerEvent) {
  if (drag) {
    (e.target as Element).releasePointerCapture(e.pointerId);
    drag = null;
    const f = current(); if (f) scheduleSave(f);
  }
}

cropRect.addEventListener('pointerdown', e => {
  if (e.target === cropRect) startDrag(e, 'move');
});
cropRect.querySelectorAll<HTMLDivElement>('.crop-handle').forEach(h => {
  h.addEventListener('pointerdown', e => startDrag(e, h.dataset.handle as DragMode));
});
document.addEventListener('pointermove', updateDrag);
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

const btnClear = $<HTMLButtonElement>('clear-session');
btnClear.addEventListener('click', async () => {
  if (!confirm(`Remove all ${frames.length} frame${frames.length === 1 ? '' : 's'} from this session?`)) return;
  await clearAll().catch(() => {});
  const ids = frames.map(f => f.id);
  for (const id of ids) removeFrame(id);
});

// ── nav ───────────────────────────────────────────────────────────────
navHome.addEventListener('click', () => setView(frames.length > 0 ? 'editor' : 'home'));
navHiw.addEventListener('click',  () => setView('hiw'));
btnLoad.addEventListener('click', () => file.click());

// ── file input + drag/drop ────────────────────────────────────────────
file.addEventListener('change', () => {
  if (file.files && file.files.length) loadFiles(file.files).catch(err => setStatus(`error: ${err}`));
  file.value = ''; // allow re-selecting same file
});
thumbAdd.addEventListener('click', () => file.click());
dropHero.addEventListener('click', () => file.click());

// Wire drop handlers on BOTH the hero film-frame and the editor canvas area
[drop, dropHero].forEach(zone => {
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('hover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('hover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('hover');
    const list = e.dataTransfer?.files;
    if (list && list.length) loadFiles(list).catch(err => setStatus(`error: ${err}`));
  });
});

// Re-fit canvas display when the window changes so the crop overlay always
// matches the actually-visible image area.
window.addEventListener('resize', () => {
  if (renderer && current()) render();
});

// Auto-restore anything persisted from a previous session.
restoreSaved().catch(err => console.warn('[restore]', err));
