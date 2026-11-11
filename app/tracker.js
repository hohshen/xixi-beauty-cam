// SPDX-License-Identifier: Apache-2.0
// 跨幀人臉追蹤：依 bbox 中心做最近鄰匹配，給穩定 ID。
// 座標一律用 0–1 的正規化影像座標（未鏡像）。

export class FaceTracker {
  /**
   * @param {object} opt
   * @param {number} opt.maxMissed  連續幾次偵測沒對到才移除（約 30 幀 ≈ 1 秒 @30fps）
   * @param {number} opt.gate       匹配門檻：中心距離 / 臉框邊長，超過就不算同一人
   * @param {number} opt.lostGate   已暫時消失的軌跡用較寬的門檻（人可能移動了一段）
   */
  constructor({ maxMissed = 30, gate = 0.8, lostGate = 1.6 } = {}) {
    this.maxMissed = maxMissed;
    this.gate = gate;
    this.lostGate = lostGate;
    this.tracks = []; // {id, cx, cy, w, h, missed, beauty, landmarks}
  }

  /** @param {{cx:number, cy:number, w:number, h:number, landmarks:any[]}[]} faces */
  update(faces) {
    const pairs = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      const t = this.tracks[ti];
      const size = Math.max(t.w, t.h, 1e-3);
      const gate = t.missed > 0 ? this.lostGate : this.gate;
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const d = Math.hypot(f.cx - t.cx, f.cy - t.cy) / size;
        if (d < gate) pairs.push({ ti, fi, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    const usedT = new Set();
    const usedF = new Set();
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedF.has(p.fi)) continue;
      usedT.add(p.ti);
      usedF.add(p.fi);
      const t = this.tracks[p.ti];
      const f = faces[p.fi];
      t.cx = f.cx;
      t.cy = f.cy;
      t.w = f.w;
      t.h = f.h;
      t.landmarks = f.landmarks;
      t.missed = 0;
    }

    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!usedT.has(ti)) {
        const t = this.tracks[ti];
        t.missed++;
        t.landmarks = null;
      }
    }
    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);

    for (let fi = 0; fi < faces.length; fi++) {
      if (usedF.has(fi)) continue;
      const f = faces[fi];
      this.tracks.push({
        id: this.#freeId(),
        cx: f.cx,
        cy: f.cy,
        w: f.w,
        h: f.h,
        landmarks: f.landmarks,
        missed: 0,
        beauty: true,
      });
    }
    return this.tracks;
  }

  // 取目前沒人用的最小編號，畫面上的人數少時編號不會越來越大。
  #freeId() {
    const used = new Set(this.tracks.map((t) => t.id));
    let id = 1;
    while (used.has(id)) id++;
    return id;
  }

  toggle(id) {
    const t = this.tracks.find((x) => x.id === id);
    if (t) t.beauty = !t.beauty;
    return t?.beauty;
  }

  set(id, on) {
    const t = this.tracks.find((x) => x.id === id);
    if (t) t.beauty = !!on;
  }
}

/** 從 478 點 landmark 算 bbox（正規化座標）。 */
export function faceBox(landmarks) {
  let x0 = 1,
    y0 = 1,
    x1 = 0,
    y1 = 0;
  for (const p of landmarks) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}
