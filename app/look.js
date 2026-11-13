// SPDX-License-Identifier: Apache-2.0
// 一個分頁的狀態（不碰 DOM，node 可直接測）：目前預設、強度、進階微調 → renderer／warp 要的參數。
// 濾鏡分頁與美顏分頁各有一個 Look，互不影響；「風格」分頁沒有自己的 Look，點一下用 applyStyle 同時選兩個分頁。
// 預設清單由呼叫端傳入，這裡不寫死任何參數。

/** 依 id 找預設，找不到退回預設 id，再找不到退回第一個。 */
export function findPreset(id, presets, defaultId) {
  return presets.find((p) => p.id === id) ?? presets.find((p) => p.id === defaultId) ?? presets[0];
}

const clampTo = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

export class Look {
  /** @param kind presets.js 的 FILTER 或 BEAUTY */
  constructor(kind, presets, defaultId = kind.defaultId) {
    this.kind = kind;
    this.presets = presets;
    this.defaultId = defaultId;
    this.select(defaultId);
  }

  /** 換一份預設清單（新增或移除自訂預設後）；目前的預設還在就保留強度與微調，不在了就退回預設。 */
  setPresets(presets) {
    this.presets = presets;
    const still = presets.find((p) => p.id === this.preset?.id);
    if (still) this.preset = still;
    else this.select(this.defaultId);
    return this;
  }

  /** 選預設：強度回到 100%，進階微調回到該預設的定義值。 */
  select(id) {
    this.preset = findPreset(id, this.presets, this.defaultId);
    this.strength = 100;
    this.base = Object.fromEntries(this.kind.keys.map((k) => [k, this.preset.params[k]]));
    return this;
  }

  setStrength(v) {
    this.strength = clampTo(v, 0, 100);
    return this;
  }

  /** 「進階」微調目前預設的某一項（依該項範圍夾值），不改預設檔的定義、不儲存。 */
  tune(key, v) {
    const r = this.kind.range[key];
    if (!r) throw new Error(`未知參數 ${key}`);
    this.base[key] = clampTo(v, r.min, r.max);
    return this;
  }

  get tuned() {
    return this.kind.keys.some((k) => this.base[k] !== this.preset.params[k]);
  }

  /** 目前看到的效果（進階的值 × 強度）是不是「不作用」。 */
  get identity() {
    return this.strength === 0 || this.kind.keys.every((k) => this.base[k] === 0);
  }

  /**
   * 傳給 renderer 與 WarpBuilder 的參數：每一項 = 進階的值 / 100 × 強度。
   * 美顏是 0..1，濾鏡是 -1..1（顆粒 0..1）；0 一律表示不作用。
   */
  params() {
    const s = this.strength / 100;
    return Object.fromEntries(this.kind.keys.map((k) => [k, (this.base[k] / 100) * s]));
  }

  /** 目前看到的效果換算回檔案的整數值（另存時用）。 */
  effectiveParams() {
    const s = this.strength / 100;
    return Object.fromEntries(this.kind.keys.map((k) => [k, Math.round(this.base[k] * s)]));
  }
}

/**
 * 套用風格：pair 是 { filter: 濾鏡的 Look, beauty: 美顏的 Look }。
 * 引用的預設在清單裡就選它（強度回到 100%、微調清掉，和點預設列一樣）；不在就保持原樣、記進 missing，不退回預設。
 * 只動兩個分頁的選擇，不碰逐人的「美顏 開／關」。回傳 { missing: [{ field, kind, id }] }。
 */
export function applyStyle(style, pair) {
  const missing = [];
  for (const [field, look] of Object.entries(pair)) {
    const id = style[field];
    if (look.presets.some((p) => p.id === id)) look.select(id);
    else missing.push({ field, kind: look.kind, id });
  }
  return { missing };
}

/** 目前兩個分頁選的預設剛好是這個風格引用的（之後在分頁裡微調也還算）。 */
export function styleActive(style, pair) {
  return Object.entries(pair).every(([field, look]) => look.preset?.id === style[field]);
}

// 記住各分頁上次選的預設。私密視窗、封鎖網站資料時 storage 會丟例外，一律吞掉，退回預設。
export function loadSelectedId(kind, storage, presets, defaultId = kind.defaultId) {
  try {
    const id = storage?.getItem(kind.selectedKey);
    return id && presets.some((p) => p.id === id) ? id : defaultId;
  } catch {
    return defaultId;
  }
}

export function saveSelectedId(kind, storage, id) {
  try {
    storage?.setItem(kind.selectedKey, id);
  } catch {
    /* 存不了就算了，下次用預設 */
  }
}
