// SPDX-License-Identifier: Apache-2.0
// WebGL2 renderer：鏡頭畫面 + 遮罩 → 美顏（只在臉上）→ 濾鏡（整張畫面）→ canvas。
// 只有一個 pass，順序固定：
//   1. 美顏：先算瘦臉／大眼的取樣位移，再在位移後的位置磨皮、美白。只作用在遮罩 R（美顏開的臉），不調色。
//      遮罩 G = 美顏關的臉（保護區），位移與美顏遮罩在這裡都歸 0，所以被關掉美顏的人與「只套濾鏡」的畫面逐像素相同。
//   2. 濾鏡：對整張畫面調色（曝光、對比、飽和、色溫、色調、褪色、暗角、顆粒），不看遮罩，所有人和背景一起套。
import { MAX_FACES, SLIM_N } from './warp.js';

/**
 * 濾鏡參數（look.params()，-1..1）→ shader 的調色 uniform。
 * on = false 時 shader 整段跳過調色，輸出與沒有濾鏡時逐像素相同。
 */
export function gradeUniforms(f = {}) {
  const v = (k) => Number(f[k]) || 0;
  const a = [v('exposure'), v('contrast'), v('saturation'), v('temperature')];
  const b = [v('tint'), v('fade'), v('vignette'), Math.max(0, v('grain'))];
  return { on: [...a, ...b].some((x) => x !== 0), a, b };
}

const VERT = `#version 300 es
in vec2 aPos;
uniform bool uMirror;
out vec2 vUV;
void main() {
  vec2 p = aPos * 0.5 + 0.5;            // 0..1，左下為原點
  // 紋理未做 FLIP_Y：t=0 是影像最上面那一列，所以 y 要反過來
  vUV = vec2(uMirror ? 1.0 - p.x : p.x, 1.0 - p.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
#define MAX_FACES ${MAX_FACES}
#define SLIM_N ${SLIM_N}
in vec2 vUV;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform vec2 uTexel;        // 1 / 影像解析度
uniform float uSpacing;     // 取樣間距（像素），依解析度縮放
uniform float uSmooth;      // 美顏：磨皮 0..1
uniform float uBright;      // 美顏：美白 0..1
uniform bool uGrade;        // 濾鏡：有沒有要調色（全部參數為 0 時跳過）
uniform vec4 uGradeA;       // 濾鏡：曝光、對比、飽和、色溫（-1..1）
uniform vec4 uGradeB;       // 濾鏡：色調、褪色、暗角（-1..1）、顆粒（0..1）
uniform float uSeed;        // 顆粒的亂數種子，每幀換一次
uniform int uViewMode;      // 0 正常 1 遮罩 2 與「只套濾鏡」的差異
uniform vec2 uRes;          // 影像解析度（像素）
uniform int uFaceCount;     // 要變形的臉數（只含美顏開的人）
uniform vec4 uFaceBox[MAX_FACES];          // x0 y0 x1 y1（像素），範圍外位移為 0
uniform vec4 uSlimPt[MAX_FACES * SLIM_N];  // 控制點 xy、位移 dxdy（像素，已乘強度）
uniform float uSlimR[MAX_FACES];           // 控制點影響半徑（像素）
uniform vec4 uEye[MAX_FACES * 2];          // 眼睛中心 xy、半徑、放大量（已乘強度）
out vec4 outColor;

const int R = 4;            // 9x9 取樣
const float SIGMA_S2 = 2.0 * 2.5 * 2.5;

float skinWeight(vec3 c) {
  // YCbCr 膚色範圍（0..1），邊界用 smoothstep 做軟邊
  float cb = 0.5 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;
  float cr = 0.5 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;
  float wb = smoothstep(0.26, 0.32, cb) * (1.0 - smoothstep(0.50, 0.56, cb));
  float wr = smoothstep(0.50, 0.54, cr) * (1.0 - smoothstep(0.68, 0.74, cr));
  return wb * wr;
}

vec3 bilateral(vec2 uv, vec3 c0, float sigmaR) {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  float sr2 = 2.0 * sigmaR * sigmaR;
  for (int j = -R; j <= R; j++) {
    for (int i = -R; i <= R; i++) {
      vec2 o = vec2(float(i), float(j)) * uSpacing * uTexel;
      vec3 c = texture(uVideo, uv + o).rgb;
      vec3 d = c - c0;
      float w = exp(-float(i * i + j * j) / SIGMA_S2 - dot(d, d) / sr2);
      sum += c * w;
      wsum += w;
    }
  }
  return sum / wsum;
}

// 提亮曲線：log(1 + (b-1)x) / log(b)，b 越大暗部提越多、亮部不爆
vec3 brighten(vec3 c, float k) {
  if (k < 1e-3) return c;
  float b = 1.0 + 5.0 * k;
  return log(1.0 + (b - 1.0) * c) / log(b);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 濾鏡：整張畫面的調色。uv 是畫面座標（暗角用），顆粒用螢幕像素座標，同一個像素前後兩次呼叫結果相同。
vec3 grade(vec3 c, vec2 uv) {
  if (!uGrade) return c;
  float expo = uGradeA.x, con = uGradeA.y, sat = uGradeA.z, temp = uGradeA.w;
  float tint = uGradeB.x, fade = uGradeB.y, vig = uGradeB.z, grain = uGradeB.w;
  c *= exp2(expo);                                            // 曝光：±1 檔
  c *= vec3(1.0 + 0.12 * temp, 1.0 - 0.1 * tint, 1.0 - 0.12 * temp); // 色溫：暖加紅減藍；色調：正值偏洋紅、負值偏綠
  c = (c - 0.5) * (1.0 + 0.5 * con) + 0.5;                   // 對比：以中灰為軸，0.5～1.5 倍
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.0 + sat);                             // 飽和：-100 為黑白，+100 為兩倍
  if (fade > 0.0) c = c * (1.0 - 0.25 * fade) + 0.15 * fade;  // 褪色：黑位抬高、白位壓低
  else c = (c + 0.1 * fade) / (1.0 + 0.1 * fade);             // 負值：黑位壓更深
  float d = length(uv - 0.5) * 1.41421356;                    // 0 = 中心，1 = 角落
  c *= 1.0 - 0.6 * vig * smoothstep(0.35, 1.0, d);            // 暗角：正值四角變暗、負值變亮
  c += (hash12(gl_FragCoord.xy + uSeed) - 0.5) * 0.12 * grain; // 顆粒
  return clamp(c, 0.0, 1.0);
}

// 反向映射：回傳「輸出像素 p 要往哪裡偏移去原圖取樣」（像素）。
// 瘦臉：每個輪廓控制點在半徑內把內容往中線推，權重 w=(1-q)^2 平滑衰減到 0。
//   方向取各點位移的加權平均，幅度取 1-Π(1-w)（平滑聯集），輪廓外的背景才不會先平台再陡降而被拉扯。
// 大眼：以眼睛中心做放大，取樣點往中心縮 a*(1-q)^2 倍；半徑處縮放與斜率都連續回到 1。
vec2 warpOffset(vec2 p) {
  vec2 off = vec2(0.0);
  for (int f = 0; f < MAX_FACES; f++) {
    if (f >= uFaceCount) break;
    vec4 b = uFaceBox[f];
    if (p.x < b.x || p.y < b.y || p.x > b.z || p.y > b.w) continue;
    float r2 = uSlimR[f] * uSlimR[f];
    vec2 s = vec2(0.0);
    float ws = 0.0, miss = 1.0;
    for (int i = 0; i < SLIM_N; i++) {
      vec4 c = uSlimPt[f * SLIM_N + i];
      vec2 d = p - c.xy;
      float q = dot(d, d) / r2;
      if (q < 1.0) {
        float w = (1.0 - q) * (1.0 - q);
        s += w * c.zw;
        ws += w;
        miss *= 1.0 - w;
      }
    }
    if (ws > 0.0) off -= s * ((1.0 - miss) / ws);
    for (int e = 0; e < 2; e++) {
      vec4 E = uEye[f * 2 + e];
      vec2 d = p - E.xy;
      float q = dot(d, d) / (E.z * E.z);
      if (q < 1.0) {
        float k = 1.0 - q;
        off -= d * (E.w * k * k);
      }
    }
  }
  return off;
}

void main() {
  vec3 src = texture(uVideo, vUV).rgb;        // 未變形、未美顏的原圖（差異檢視的基準）
  // 美顏關的人：位移乘 0。遮罩是柔邊，G ≥ 0.9 就當成完全保護，臉緣也不會殘留一點點位移
  float protect = smoothstep(0.05, 0.9, texture(uMask, vUV).g);
  vec2 uv = vUV;
  if (uFaceCount > 0) {
    vec2 off = warpOffset(vUV * uRes) * (1.0 - protect);
    uv = vUV + off / uRes;                    // off 為 0 時 uv 與 vUV 完全相同
  }
  vec3 orig = texture(uVideo, uv).rgb;
  // 美顏遮罩跟著臉的內容走（取變形後的位置）；保護區內歸 0，相鄰美顏開的人柔邊也不會蓋到關掉的人
  float m = texture(uMask, uv).r * (1.0 - protect);

  if (uViewMode == 1) {                 // 遮罩檢視：粉紅 = 美顏，藍 = 保護區
    vec3 c = mix(orig * 0.35, vec3(1.0, 0.3, 0.6), m);
    outColor = vec4(mix(c, vec3(0.2, 0.5, 1.0), protect * 0.5), 1.0);
    return;
  }

  vec3 result = orig;
  if (m > 0.0) {
    float skin = skinWeight(orig);
    vec3 beauty = orig;
    if (uSmooth > 0.0) {
      vec3 smoothed = bilateral(uv, orig, mix(0.04, 0.12, uSmooth));
      beauty = mix(orig, smoothed, uSmooth * (0.35 + 0.65 * skin));
    }
    beauty = brighten(beauty, uBright * (0.4 + 0.6 * skin));
    // 美白：膚色區稍微降飽和、往暖白靠
    float l = dot(beauty, vec3(0.299, 0.587, 0.114));
    beauty = mix(beauty, vec3(l) * vec3(1.02, 1.0, 0.98), 0.25 * uBright * skin);
    result = mix(orig, clamp(beauty, 0.0, 1.0), m);
  }

  // 濾鏡：美顏之後對整張畫面調色，不看遮罩，美顏開關的人與背景都一樣套
  result = grade(result, vUV);

  if (uViewMode == 2) {                 // 與「只套濾鏡、不套美顏」的畫面差異放大 20 倍：美顏關的人全黑
    outColor = vec4(clamp(abs(result - grade(src, vUV)) * 20.0, 0.0, 1.0), 1.0);
    return;
  }
  outColor = vec4(result, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}

function makeTex(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('此瀏覽器不支援 WebGL2');
    this.gl = gl;
    this.canvas = canvas;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
    this.prog = prog;
    gl.useProgram(prog);

    // 一個蓋滿畫面的大三角形
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.videoTex = makeTex(gl);
    this.maskTex = makeTex(gl);

    const u = (n) => gl.getUniformLocation(prog, n);
    this.u = {
      video: u('uVideo'),
      mask: u('uMask'),
      texel: u('uTexel'),
      spacing: u('uSpacing'),
      smooth: u('uSmooth'),
      bright: u('uBright'),
      grade: u('uGrade'),
      gradeA: u('uGradeA'),
      gradeB: u('uGradeB'),
      seed: u('uSeed'),
      viewMode: u('uViewMode'),
      mirror: u('uMirror'),
      res: u('uRes'),
      faceCount: u('uFaceCount'),
      faceBox: u('uFaceBox'),
      slimPt: u('uSlimPt'),
      slimR: u('uSlimR'),
      eye: u('uEye'),
    };
    gl.uniform1i(this.u.video, 0);
    gl.uniform1i(this.u.mask, 1);
  }

  /**
   * @param {HTMLVideoElement|HTMLCanvasElement} video  鏡頭畫面（測試頁可傳 canvas）
   * @param {HTMLCanvasElement} mask  與影像同比例的 2D canvas（未鏡像）；R 美顏、G 保護區
   * @param {{smooth:number, whiten:number}} o.beauty  美顏分頁的 look.params()（0..1），只作用在遮罩 R
   * @param {object} [o.filter]  濾鏡分頁的 look.params()（-1..1），作用在整張畫面；省略表示不調色
   * @param {object} [o.warp]  WarpBuilder.build() 的結果；省略表示不變形
   * @param {number} [o.seed]  顆粒的亂數種子
   */
  draw(video, mask, { beauty, filter = null, viewMode = 0, mirror = true, warp = null, seed = 0 }) {
    const gl = this.gl;
    const w = video.videoWidth || video.width,
      h = video.videoHeight || video.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);

    gl.uniform2f(this.u.texel, 1 / w, 1 / h);
    gl.uniform1f(this.u.spacing, Math.max(1, h / 480) * 1.5);
    gl.uniform1f(this.u.smooth, beauty.smooth);
    gl.uniform1f(this.u.bright, beauty.whiten);
    const g = gradeUniforms(filter ?? {});
    gl.uniform1i(this.u.grade, g.on ? 1 : 0);
    gl.uniform4f(this.u.gradeA, ...g.a);
    gl.uniform4f(this.u.gradeB, ...g.b);
    gl.uniform1f(this.u.seed, seed % 1000);
    gl.uniform1i(this.u.viewMode, viewMode);
    gl.uniform1i(this.u.mirror, mirror ? 1 : 0);
    gl.uniform2f(this.u.res, w, h);
    const n = warp ? warp.count : 0;
    gl.uniform1i(this.u.faceCount, n);
    if (n > 0) {
      gl.uniform4fv(this.u.faceBox, warp.box);
      gl.uniform4fv(this.u.slimPt, warp.slimPt);
      gl.uniform1fv(this.u.slimR, warp.slimR);
      gl.uniform4fv(this.u.eye, warp.eye);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
