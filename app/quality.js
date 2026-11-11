// SPDX-License-Identifier: Apache-2.0
// 自動降級：預覽 fps 長時間低於目標時，一級一級降低偵測頻率與雙邊濾波的取樣數；
// 長時間有餘裕時再一級一級升回來。只看每秒一次的 fps 量測，不碰 DOM，方便在 Node 測試。

/**
 * 等級表。L0 是原本的畫質。
 * - detectEvery：每幾張影格做一次人臉偵測（其餘影格沿用上一次的 landmark）
 * - radius：雙邊濾波半徑，取樣數 = (2r+1)²；取樣間距等比放大，磨皮範圍大致不變
 */
export const QUALITY_LEVELS = [
  { level: 0, detectEvery: 1, radius: 4, label: 'L0 原畫質' },
  { level: 1, detectEvery: 1, radius: 3, label: 'L1 磨皮取樣 49' },
  { level: 2, detectEvery: 2, radius: 3, label: 'L2 隔幀偵測' },
  { level: 3, detectEvery: 2, radius: 2, label: 'L3 隔幀偵測＋磨皮取樣 25' },
  { level: 4, detectEvery: 3, radius: 2, label: 'L4 每 3 幀偵測' },
];

export const MAX_LEVEL = QUALITY_LEVELS.length - 1;

export class AutoQuality {
  /**
   * @param {object} opt
   * @param {number} opt.lowFps       低於這個 fps 視為不夠順（卡片要求 24）
   * @param {number} opt.downAfter    連續幾秒低於 lowFps 才降一級
   * @param {number} opt.highFps      高於這個 fps 視為有餘裕
   * @param {number} opt.upAfter      連續幾秒高於 highFps 才升一級（比降級慢，避免來回跳）
   * @param {number|null} opt.fixed   指定固定等級（0..MAX_LEVEL）；null 表示自動
   */
  constructor({ lowFps = 24, downAfter = 3, highFps = 28, upAfter = 15, fixed = null } = {}) {
    this.lowFps = lowFps;
    this.downAfter = downAfter;
    this.highFps = highFps;
    this.upAfter = upAfter;
    this.level = 0;
    this.lowSecs = 0;
    this.highSecs = 0;
    this.setFixed(fixed);
  }

  get auto() {
    return this.fixed === null;
  }

  get current() {
    return QUALITY_LEVELS[this.level];
  }

  /** @param {number|string|null} level  null 或 'auto' = 自動 */
  setFixed(level) {
    const n = Number(level);
    if (level === null || level === undefined || level === '' || level === 'auto' || !Number.isFinite(n)) {
      this.fixed = null;
    } else {
      this.fixed = Math.min(MAX_LEVEL, Math.max(0, Math.round(n)));
      this.level = this.fixed;
    }
    this.lowSecs = 0;
    this.highSecs = 0;
    return this;
  }

  /** 換來源（鏡頭、照片）或切前後鏡頭時從頭量；自動模式回到 L0。 */
  reset() {
    if (this.auto) this.level = 0;
    this.lowSecs = 0;
    this.highSecs = 0;
  }

  /**
   * 每秒呼叫一次，傳入這一秒的 fps。
   * @param {number} fps
   * @returns {boolean} 等級有沒有改變
   */
  update(fps) {
    if (!this.auto) return false;
    if (fps < this.lowFps) {
      this.lowSecs++;
      this.highSecs = 0;
    } else if (fps >= this.highFps) {
      this.highSecs++;
      this.lowSecs = 0;
    } else {
      this.lowSecs = 0;
      this.highSecs = 0;
    }
    if (this.lowSecs >= this.downAfter && this.level < MAX_LEVEL) {
      this.level++;
      this.lowSecs = 0;
      return true;
    }
    if (this.highSecs >= this.upAfter && this.level > 0) {
      this.level--;
      this.highSecs = 0;
      return true;
    }
    return false;
  }

  /** 這一張影格要不要做人臉偵測；frameNo 是處理過的影格序號（從 0 起）。 */
  shouldDetect(frameNo) {
    return frameNo % this.current.detectEvery === 0;
  }
}
