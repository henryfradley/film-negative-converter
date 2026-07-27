/// Manual crop overlay: 8 handles + body drag, with optional 3:2 aspect lock.
/// Aspect math is in PIXEL space (converts UV × source-size) so it produces
/// visually correct rectangles regardless of source aspect ratio.

export type CropUV = [number, number, number, number]; // x0, y0, x1, y1 in UV
export type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

const MIN_SIZE = 0.02;

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startCrop: CropUV;
}

export interface CropContext {
  /// Read the current crop from wherever caller stores it.
  getCrop(): CropUV;
  /// Write the new crop back — caller re-paints the overlay + updates params.
  setCrop(next: CropUV): void;
  /// Source image dimensions (in pixels) for aspect-ratio math. Post-orient.
  getSourceSize(): { width: number; height: number };
  /// Whether the 3:2 lock is currently on.
  isAspectLocked(): boolean;
  /// A container element whose bounding rect maps cursor position to UV [0,1].
  getBounds(): DOMRect;
  /// Called after the drag ends (successfully) so caller can persist state.
  onDragEnd?(): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/// Wire mouse handlers on the crop rect + its handles. Returns a teardown
/// function that removes the document-level listeners.
export function installCropDrag(
  cropRectEl: HTMLElement,
  handleEls: NodeListOf<HTMLElement> | HTMLElement[],
  ctx: CropContext,
): () => void {
  let drag: DragState | null = null;

  const cursorUV = (e: PointerEvent) => {
    const r = ctx.getBounds();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const start = (e: PointerEvent, mode: DragMode) => {
    e.preventDefault();
    const uv = cursorUV(e);
    drag = { mode, startX: uv.x, startY: uv.y, startCrop: [...ctx.getCrop()] as CropUV };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent) => {
    if (!drag) return;
    const uv = cursorUV(e);
    const dx = uv.x - drag.startX;
    const dy = uv.y - drag.startY;
    let [x0, y0, x1, y1] = drag.startCrop;

    if (drag.mode === 'move') {
      const w = x1 - x0, h = y1 - y0;
      x0 = clamp(x0 + dx, 0, 1 - w);
      y0 = clamp(y0 + dy, 0, 1 - h);
      x1 = x0 + w;
      y1 = y0 + h;
    } else {
      if (drag.mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_SIZE);
      if (drag.mode.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_SIZE, 1);
      if (drag.mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_SIZE);
      if (drag.mode.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_SIZE, 1);

      if (ctx.isAspectLocked()) {
        [x0, y0, x1, y1] = apply32Constraint(x0, y0, x1, y1, drag.mode, drag.startCrop, ctx);
      }
    }
    ctx.setCrop([clamp(x0, 0, 1), clamp(y0, 0, 1), clamp(x1, 0, 1), clamp(y1, 0, 1)]);
  };

  const end = (e: PointerEvent) => {
    if (drag) {
      (e.target as Element).releasePointerCapture(e.pointerId);
      drag = null;
      ctx.onDragEnd?.();
    }
  };

  cropRectEl.addEventListener('pointerdown', e => {
    if (e.target === cropRectEl) start(e, 'move');
  });
  handleEls.forEach(h => {
    h.addEventListener('pointerdown', e => start(e, h.dataset.handle as DragMode));
  });
  document.addEventListener('pointermove',   move);
  document.addEventListener('pointerup',     end);
  document.addEventListener('pointercancel', end);

  return () => {
    document.removeEventListener('pointermove',   move);
    document.removeEventListener('pointerup',     end);
    document.removeEventListener('pointercancel', end);
  };
}

/// Snap a freshly-dragged crop to exact 3:2 in PIXEL space (accounts for
/// non-square source aspect: a 3:2 crop of a 3:2 source is a UV square).
/// The anchor for corner drags is the opposite corner; edge drags scale
/// symmetrically around the perpendicular axis's centre.
function apply32Constraint(
  x0: number, y0: number, x1: number, y1: number,
  mode: DragMode, startCrop: CropUV, ctx: CropContext,
): CropUV {
  const { width: srcW, height: srcH } = ctx.getSourceSize();
  const srcRatio = srcW / srcH;
  const startPixelW = (startCrop[2] - startCrop[0]) * srcW;
  const startPixelH = (startCrop[3] - startCrop[1]) * srcH;
  const targetPixelRatio = startPixelW >= startPixelH ? 1.5 : 1 / 1.5;
  const uvRatio = targetPixelRatio / srcRatio; // desired uv_w / uv_h

  const w = x1 - x0, h = y1 - y0;

  if (mode === 'n' || mode === 's') {
    const cx = (startCrop[0] + startCrop[2]) / 2;
    const newW = Math.min(h * uvRatio, 1);
    x0 = clamp(cx - newW / 2, 0, 1);
    x1 = clamp(cx + newW / 2, 0, 1);
  } else if (mode === 'w' || mode === 'e') {
    const cy = (startCrop[1] + startCrop[3]) / 2;
    const newH = Math.min(w / uvRatio, 1);
    y0 = clamp(cy - newH / 2, 0, 1);
    y1 = clamp(cy + newH / 2, 0, 1);
  } else {
    // Corner: anchor at the opposite corner
    const currentUvRatio = w / h;
    if (currentUvRatio > uvRatio) {
      const newW = h * uvRatio;
      if (mode.includes('w')) x0 = x1 - newW; else x1 = x0 + newW;
    } else {
      const newH = w / uvRatio;
      if (mode.includes('n')) y0 = y1 - newH; else y1 = y0 + newH;
    }
  }
  return [x0, y0, x1, y1];
}
