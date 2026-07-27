/// WebGL2 pipeline: uploads linear RGB f32 negative → renders inverted positive.
/// Percentile-based stretch values are computed on the CPU and passed as uniforms.

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/// Pipeline mirrors invert.rs:
///   density = log(base) − log(pixel) per channel
///   density stretch → S-curve → saturation → BW stretch
/// UV is remapped into [u_crop_min, u_crop_max] so we render only the cropped region.
const FS = `#version 300 es
precision highp float;

uniform sampler2D u_negative;
uniform vec3  u_log_base;
uniform vec3  u_density_lo;
uniform vec3  u_density_hi;
uniform float u_s_slope;
uniform float u_saturation;
uniform float u_bw_lo;
uniform float u_bw_hi;
uniform vec2  u_crop_min;
uniform vec2  u_crop_max;
uniform float u_rotate; // radians, applied around image centre before crop
uniform vec2  u_src_size; // texture w,h for aspect-correct rotation
uniform float u_sharpen; // 0 = off; 1 = normal unsharp mask; up to ~3
uniform float u_curves;  // midtone gamma: <1 darkens midtones, >1 lifts them
uniform int   u_orient;  // 0, 1, 2, 3: number of 90° CW rotations applied to display
uniform float u_temp;    // −1 cool (blue) … +1 warm (orange)
uniform float u_tint;    // −1 green … +1 magenta
uniform float u_shadow_warm;    // −1 cool shadows … +1 warm shadows
uniform float u_highlight_warm; // −1 cool highlights … +1 warm highlights

in  vec2 v_uv;
out vec4 outColor;

float sCurve(float t, float slope) {
  float pivot = 0.5;
  float f0 = 1.0 / (1.0 + exp( slope * pivot));
  float f1 = 1.0 / (1.0 + exp(-slope * (1.0 - pivot)));
  float f  = 1.0 / (1.0 + exp(-slope * (t - pivot)));
  return clamp((f - f0) / (f1 - f0), 0.0, 1.0);
}

/// Full tone pipeline for a given crop-space UV. Returns black outside frame.
vec3 tone(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.02);
  vec3 pixel = texture(u_negative, uv).rgb;
  vec3 d = max(u_log_base - log(max(pixel, vec3(1e-6))), vec3(0.0));
  vec3 range = max(u_density_hi - u_density_lo, vec3(1e-6));
  vec3 t = clamp((d - u_density_lo) / range, 0.0, 1.0);
  t = vec3(sCurve(t.r, u_s_slope), sCurve(t.g, u_s_slope), sCurve(t.b, u_s_slope));
  // Curves = midtone gamma
  t = pow(t, vec3(1.0 / max(u_curves, 0.01)));

  // ── Colour balance ──────────────────────────────────────────────────
  // Temperature: R ↔ B. Tint: G ↔ magenta (R+B).
  float TEMP = 0.30, TINT = 0.30;
  vec3 wb = vec3(
    1.0 + u_temp * TEMP + u_tint * TINT * 0.5,
    1.0 - u_tint * TINT,
    1.0 - u_temp * TEMP + u_tint * TINT * 0.5
  );
  t = clamp(t * wb, 0.0, 1.0);

  // Split toning — shadow / highlight warmth. Amounts are weighted by
  // luminance, so shadow-warmth affects darker pixels more, highlight-warmth
  // affects brighter pixels more. Positive = warm (R↑ B↓).
  float luma = dot(t, vec3(0.2126, 0.7152, 0.0722));
  float shadowMask    = 1.0 - luma;
  float highlightMask = luma;
  float SPLIT = 0.20;
  vec3 shadowShift = vec3( u_shadow_warm    * SPLIT, 0.0, -u_shadow_warm    * SPLIT);
  vec3 hlShift     = vec3( u_highlight_warm * SPLIT, 0.0, -u_highlight_warm * SPLIT);
  t = clamp(t + shadowMask * shadowShift + highlightMask * hlShift, 0.0, 1.0);

  // Saturation
  luma = dot(t, vec3(0.2126, 0.7152, 0.0722));
  t = clamp(vec3(luma) + (t - vec3(luma)) * u_saturation, 0.0, 1.0);

  // Final BW stretch
  float bwRange = max(u_bw_hi - u_bw_lo, 1e-6);
  t = clamp((t - vec3(u_bw_lo)) / bwRange, 0.0, 1.0);
  return t;
}

/// Effective (post-90°-orientation) dimensions in display space.
vec2 effectiveSize() {
  return (u_orient == 1 || u_orient == 3) ? u_src_size.yx : u_src_size;
}

/// Inverse of the 90° orient rotation: display UV → source texture UV.
vec2 unorient(vec2 uv) {
  if (u_orient == 1) return vec2(uv.y, 1.0 - uv.x);       // 90° CW display
  if (u_orient == 2) return vec2(1.0 - uv.x, 1.0 - uv.y); // 180°
  if (u_orient == 3) return vec2(1.0 - uv.y, uv.x);       // 270° CW (= 90° CCW)
  return uv;
}

vec2 transformUV(vec2 vuv) {
  vec2 uv = mix(u_crop_min, u_crop_max, vuv);
  // Rotate around centre in effective (post-orient) aspect-correct coords.
  vec2 sz = effectiveSize();
  vec2 centred = (uv - 0.5) * sz;
  float c = cos(u_rotate), s = sin(u_rotate);
  vec2 rotated = vec2(c * centred.x - s * centred.y,
                      s * centred.x + c * centred.y);
  uv = rotated / sz + 0.5;
  // Unorient into source texture space
  return unorient(uv);
}

void main() {
  vec2 uv = transformUV(v_uv);
  vec3 col = tone(uv);

  if (u_sharpen > 0.001) {
    // Unsharp mask on the tone-mapped output: sample the pipeline at 4
    // neighbouring UVs (2-texel radius so it's visible at fit-to-screen too).
    vec2 px = 2.0 / u_src_size;
    vec3 blur = 0.2 * (
      col +
      tone(transformUV(v_uv + vec2( px.x, 0.0))) +
      tone(transformUV(v_uv + vec2(-px.x, 0.0))) +
      tone(transformUV(v_uv + vec2(0.0,  px.y))) +
      tone(transformUV(v_uv + vec2(0.0, -px.y)))
    );
    col = clamp(col + (col - blur) * u_sharpen, 0.0, 1.0);
  }

  outColor = vec4(col, 1.0);
}`;

export type StretchParams = {
  logBase: [number, number, number];
  densityLo: [number, number, number];
  densityHi: [number, number, number];
  sSlope: number;
  saturation: number;
  bwLo: number;
  bwHi: number;
  cropMin: [number, number]; // UV
  cropMax: [number, number];
  rotate: number; // degrees; positive = clockwise (fine, ±15)
  sharpen: number;
  curves: number; // gamma-style midtone; 1.0 = neutral
  orient: 0 | 1 | 2 | 3; // number of 90° CW rotations (portrait handling)
  temp: number;           // −1 cool … +1 warm
  tint: number;           // −1 green … +1 magenta
  shadowWarm: number;     // −1 cool shadows … +1 warm shadows
  highlightWarm: number;  // −1 cool highlights … +1 warm highlights
};

export class Renderer {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  tex: WebGLTexture;
  uni: Record<string, WebGLUniformLocation> = {};
  srcWidth = 0;
  srcHeight = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float missing');
    this.gl = gl;

    this.program = this.buildProgram(VS, FS);
    for (const name of ['u_negative', 'u_log_base', 'u_density_lo', 'u_density_hi',
                        'u_s_slope', 'u_saturation', 'u_bw_lo', 'u_bw_hi',
                        'u_crop_min', 'u_crop_max', 'u_rotate', 'u_src_size',
                        'u_sharpen', 'u_curves', 'u_orient',
                        'u_temp', 'u_tint', 'u_shadow_warm', 'u_highlight_warm']) {
      const loc = gl.getUniformLocation(this.program, name);
      if (!loc) throw new Error(`missing uniform ${name}`);
      this.uni[name] = loc;
    }

    const quad = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture()!;
  }

  uploadNegative(width: number, height: number, pixels: Float32Array) {
    const { gl } = this;
    this.srcWidth = width;
    this.srcHeight = height;

    const rgba = new Float32Array(width * height * 4);
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
      rgba[j]     = pixels[i];
      rgba[j + 1] = pixels[i + 1];
      rgba[j + 2] = pixels[i + 2];
      rgba[j + 3] = 1.0;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /// Effective (post-orient) dimensions of the source image.
  effectiveSize(p: StretchParams): [number, number] {
    const swap = p.orient === 1 || p.orient === 3;
    return swap ? [this.srcHeight, this.srcWidth] : [this.srcWidth, this.srcHeight];
  }

  /// Size the drawing buffer to the source aspect (capped at MAX px)
  /// AND lock the CSS display size to fit the actual visible container.
  /// Both are needed: buffer size sets shader resolution; display size
  /// ensures the wrap element (and thus the crop overlay) doesn't extend
  /// past what the user can see.
  fitCanvas(p: StretchParams, maxDim = 1800) {
    const [w, h] = this.effectiveSize(p);
    const scale = Math.min(1, maxDim / Math.max(w, h));
    this.canvas.width  = Math.max(1, Math.round(w * scale));
    this.canvas.height = Math.max(1, Math.round(h * scale));
    this.lockDisplaySize();
  }

  /// Explicitly compute canvas display size from its available container
  /// (canvas-area minus padding). Preserves aspect ratio. Call after any
  /// change that affects intrinsic size or on window resize.
  lockDisplaySize() {
    const wrap = this.canvas.parentElement;
    const area = wrap?.parentElement;
    if (!wrap || !area) return;
    const rect = area.getBoundingClientRect();
    const cs = getComputedStyle(area);
    const availW = Math.max(1, rect.width  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const availH = Math.max(1, rect.height - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom));
    const bufAspect  = this.canvas.width / this.canvas.height;
    const availAspect = availW / availH;
    let dw: number, dh: number;
    if (bufAspect > availAspect) { dw = availW; dh = availW / bufAspect; }
    else                          { dh = availH; dw = availH * bufAspect; }
    this.canvas.style.width  = `${Math.floor(dw)}px`;
    this.canvas.style.height = `${Math.floor(dh)}px`;
  }

  render(p: StretchParams) {
    this.fitCanvas(p);
    // Live preview always renders the FULL frame — the crop is a UI overlay.
    const fullFrame = { ...p, cropMin: [0, 0] as [number, number], cropMax: [1, 1] as [number, number] };
    this.drawTo(this.canvas.width, this.canvas.height, fullFrame, null);
  }

  /// Render the CROPPED area, canvas sized to match its aspect.
  renderCropped(p: StretchParams, maxDim = 1800) {
    const [effW, effH] = this.effectiveSize(p);
    const cropPxW = (p.cropMax[0] - p.cropMin[0]) * effW;
    const cropPxH = (p.cropMax[1] - p.cropMin[1]) * effH;
    const scale = Math.min(1, maxDim / Math.max(cropPxW, cropPxH));
    this.canvas.width  = Math.max(1, Math.round(cropPxW * scale));
    this.canvas.height = Math.max(1, Math.round(cropPxH * scale));
    this.drawTo(this.canvas.width, this.canvas.height, p, null);
  }

  /// Render at an arbitrary size to an offscreen framebuffer, return the raw
  /// RGBA8 pixel buffer (Y-up per WebGL convention). Callers convert as needed.
  /// Resources are always released even if `drawTo` throws.
  private renderOffscreen(w: number, h: number, p: StretchParams): Uint8Array {
    const { gl } = this;
    const fbTex = gl.createTexture()!;
    const fbo   = gl.createFramebuffer()!;
    try {
      gl.bindTexture(gl.TEXTURE_2D, fbTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`FBO incomplete: 0x${status.toString(16)}`);
      }

      this.drawTo(w, h, p, fbo);
      const raw = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      return raw;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(fbTex);
    }
  }

  /// Render a thumbnail into a target canvas (fully renders inversion pipeline).
  renderToCanvas(w: number, h: number, p: StretchParams, target: HTMLCanvasElement) {
    const raw = this.renderOffscreen(w, h, p);
    target.width = w;
    target.height = h;
    const ctx = target.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    // Flip Y (WebGL is bottom-first, canvas is top-first)
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      img.data.set(raw.subarray(src, src + w * 4), dst);
    }
    ctx.putImageData(img, 0, 0);
  }

  /// Render at full crop resolution to a framebuffer, read pixels, return PNG Blob.
  async renderToPng(p: StretchParams): Promise<Blob> {
    const [effW, effH] = this.effectiveSize(p);
    const w = Math.max(1, Math.round((p.cropMax[0] - p.cropMin[0]) * effW));
    const h = Math.max(1, Math.round((p.cropMax[1] - p.cropMin[1]) * effH));
    const raw = this.renderOffscreen(w, h, p);

    // Restore normal display (offscreen render bound the FBO)
    this.render(p);

    // Flip Y (readPixels is bottom-first) into an ImageData for canvas
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      img.data.set(raw.subarray(src, src + w * 4), dst);
    }
    ctx.putImageData(img, 0, 0);
    return off.convertToBlob({ type: 'image/png' });
  }

  private drawTo(width: number, height: number, p: StretchParams, fbo: WebGLFramebuffer | null) {
    const { gl, uni } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.05, 0.05, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(uni.u_negative, 0);
    gl.uniform3fv(uni.u_log_base, p.logBase);
    gl.uniform3fv(uni.u_density_lo, p.densityLo);
    gl.uniform3fv(uni.u_density_hi, p.densityHi);
    gl.uniform1f(uni.u_s_slope, p.sSlope);
    gl.uniform1f(uni.u_saturation, p.saturation);
    gl.uniform1f(uni.u_bw_lo, p.bwLo);
    gl.uniform1f(uni.u_bw_hi, p.bwHi);
    gl.uniform2fv(uni.u_crop_min, p.cropMin);
    gl.uniform2fv(uni.u_crop_max, p.cropMax);
    gl.uniform1f(uni.u_rotate, (p.rotate ?? 0) * Math.PI / 180);
    gl.uniform2fv(uni.u_src_size, [this.srcWidth, this.srcHeight]);
    gl.uniform1f(uni.u_sharpen, p.sharpen ?? 0);
    gl.uniform1f(uni.u_curves, p.curves ?? 1.0);
    gl.uniform1i(uni.u_orient, (p.orient ?? 0) as number);
    gl.uniform1f(uni.u_temp, p.temp ?? 0);
    gl.uniform1f(uni.u_tint, p.tint ?? 0);
    gl.uniform1f(uni.u_shadow_warm, p.shadowWarm ?? 0);
    gl.uniform1f(uni.u_highlight_warm, p.highlightWarm ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private buildProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    }
    return p;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`compile: ${gl.getShaderInfoLog(s)}\n${src}`);
    }
    return s;
  }
}
