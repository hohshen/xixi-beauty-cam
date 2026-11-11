// SPDX-License-Identifier: Apache-2.0
// 瘦臉與大眼的變形參數：從每個「美顏開」的人的 landmark 算出 shader 要用的控制點。
// 變形本身在 renderer.js 的 fragment shader 裡做（反向映射：輸出像素去原圖的哪裡取樣）。
// 座標一律是未鏡像的影像像素座標。

export const MAX_FACES = 6;
export const SLIM_N = 10; // 每張臉的瘦臉控制點數

// 臉頰到下顎的輪廓點（FACE_OVAL 上，不含額頭與下巴尖）：影像左側 5 點、右側 5 點
const SLIM_IDX = [93, 132, 58, 172, 136, 323, 361, 288, 397, 365];
const MID_TOP = 10; // 額頭中央
const MID_BOTTOM = 152; // 下巴尖
const CHEEK_L = 234,
  CHEEK_R = 454;
// 眼角（算眼寬）與虹膜中心（478 點模型才有；缺的話用兩眼角中點）
const EYES = [
  { a: 33, b: 133, iris: 468 },
  { a: 362, b: 263, iris: 473 },
];

const SLIM_MAX = 0.12; // 強度 100 時，輪廓點往中線移動「到中線距離」的 12%
const SLIM_RADIUS = 0.3; // 每個控制點的影響半徑 = 臉寬 30%
const EYE_MAX = 0.32; // 強度 100 時眼睛中心放大 1/(1-0.32) ≈ 1.47 倍，往外遞減到 1
const EYE_RADIUS = 1.0; // 放大半徑 = 眼寬 × 1.0
const BOX_PAD = 0.4; // shader 提早跳出用的範圍：臉框往外擴 40% 臉寬（大於影響半徑），範圍外變形量為 0
const SMOOTH = 0.5; // 幾何參數的跨幀 EMA，壓 landmark 抖動

const GEO_LEN = 4 + SLIM_N * 4 + 1 + 2 * 3;
const OFF_SLIM_R = 4 + SLIM_N * 4;
const OFF_EYE = OFF_SLIM_R + 1;

function pt(lm, i, w, h) {
  const p = lm[i];
  return [p.x * w, p.y * h];
}

/** 只算幾何（強度 = 1）。強度在最後才乘，所以滑桿 0 時變形量剛好是 0。 */
export function faceGeometry(lm, w, h) {
  const g = new Float32Array(GEO_LEN);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of lm) {
    const x = p.x * w,
      y = p.y * h;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const [lx, ly] = pt(lm, CHEEK_L, w, h);
  const [rx, ry] = pt(lm, CHEEK_R, w, h);
  const faceW = Math.max(1, Math.hypot(rx - lx, ry - ly));
  const pad = faceW * BOX_PAD;
  g.set([x0 - pad, y0 - pad, x1 + pad, y1 + pad], 0);

  // 臉中線：額頭中央 → 下巴尖；歪頭時中線跟著歪
  const [ax, ay] = pt(lm, MID_TOP, w, h);
  const [bx, by] = pt(lm, MID_BOTTOM, w, h);
  const len = Math.max(1e-6, Math.hypot(bx - ax, by - ay));
  const ux = (bx - ax) / len,
    uy = (by - ay) / len;
  SLIM_IDX.forEach((idx, i) => {
    const [cx, cy] = pt(lm, idx, w, h);
    const t = (cx - ax) * ux + (cy - ay) * uy;
    const mx = ax + ux * t,
      my = ay + uy * t; // 中線上的垂足
    g.set([cx, cy, (mx - cx) * SLIM_MAX, (my - cy) * SLIM_MAX], 4 + i * 4);
  });
  g[OFF_SLIM_R] = faceW * SLIM_RADIUS;

  EYES.forEach((e, k) => {
    const [pax, pay] = pt(lm, e.a, w, h);
    const [pbx, pby] = pt(lm, e.b, w, h);
    const [cx, cy] = lm.length > e.iris ? pt(lm, e.iris, w, h) : [(pax + pbx) / 2, (pay + pby) / 2];
    const eyeW = Math.hypot(pbx - pax, pby - pay);
    g.set([cx, cy, Math.max(1, eyeW * EYE_RADIUS)], OFF_EYE + k * 3);
  });
  return g;
}

export class WarpBuilder {
  constructor({ smooth = SMOOTH } = {}) {
    this.smooth = smooth;
    this.prev = new Map(); // track id -> 上一幀平滑後的幾何
    this.out = {
      count: 0,
      box: new Float32Array(MAX_FACES * 4),
      slimPt: new Float32Array(MAX_FACES * SLIM_N * 4),
      slimR: new Float32Array(MAX_FACES),
      eye: new Float32Array(MAX_FACES * 2 * 4),
    };
  }

  /**
   * @param {{id:number, beauty:boolean, landmarks:any[]|null}[]} tracks
   * @param {number} w 影像寬（像素）
   * @param {number} h 影像高
   * @param {{slim:number, eye:number}} s 0..1
   */
  build(tracks, w, h, { slim, eye }) {
    const o = this.out;
    o.count = 0;
    const seen = new Set();
    for (const t of tracks) {
      // 只有「美顏開」且這一幀有偵測到的人才變形；關掉的人不產生任何控制點
      if (!t.beauty || !t.landmarks || o.count >= MAX_FACES) continue;
      const g = faceGeometry(t.landmarks, w, h);
      const p = this.prev.get(t.id);
      if (p) for (let i = 0; i < GEO_LEN; i++) g[i] = p[i] + (g[i] - p[i]) * this.smooth;
      this.prev.set(t.id, g);
      seen.add(t.id);
      if (slim <= 0 && eye <= 0) continue; // 兩條都是 0：不送進 shader，輸出與原圖相同

      const f = o.count++;
      o.box.set(g.subarray(0, 4), f * 4);
      for (let i = 0; i < SLIM_N; i++) {
        const b = 4 + i * 4,
          d = (f * SLIM_N + i) * 4;
        o.slimPt[d] = g[b];
        o.slimPt[d + 1] = g[b + 1];
        o.slimPt[d + 2] = g[b + 2] * slim;
        o.slimPt[d + 3] = g[b + 3] * slim;
      }
      o.slimR[f] = g[OFF_SLIM_R];
      for (let k = 0; k < 2; k++) {
        const b = OFF_EYE + k * 3,
          d = (f * 2 + k) * 4;
        o.eye[d] = g[b];
        o.eye[d + 1] = g[b + 1];
        o.eye[d + 2] = g[b + 2];
        o.eye[d + 3] = EYE_MAX * eye;
      }
    }
    for (const id of [...this.prev.keys()]) if (!seen.has(id)) this.prev.delete(id);
    return o;
  }
}
