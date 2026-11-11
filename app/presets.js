// SPDX-License-Identifier: Apache-2.0
// 預設檔的載入與驗證。不碰 DOM，node 可直接測。
// 兩種預設，格式分開：
// - 濾鏡（*.xixi-filter.json）：套在整張畫面的調色，所有人和背景一起套。內建的在 filters/。
// - 美顏預設（*.xixi-beauty.json）：只套在「美顏開」的人臉上（磨皮、美白、瘦臉、大眼），不調色。內建的在 beauty/。
// 參數值不寫在這裡：內建預設在各自資料夾的 *.json，清單在 index.json，格式見 schema.json 與 docs/filters.md。
//
// 安全原則：預設檔只是資料。
// - 只用 JSON.parse 解析，不 eval、不 new Function、不動態 import。
// - 只挑認得的欄位複製到新物件（不 spread、不 Object.assign），不認得的欄位與 __proto__ 之類的鍵都碰不到。
// - 檔案裡的字串一律當純文字，介面用 textContent 顯示；不載入檔案裡的任何網址。
// - 內建清單只接受同資料夾的檔名（不接受網址或路徑）。

export const FORMAT_VERSION = 1; // 這版 app 寫出的格式版本
export const MAX_FILE_BYTES = 64 * 1024; // 單一預設檔上限，正常的檔案不到 1 KB

/**
 * 一種預設的定義。params 依順序列出參數：{ key: [最小值, 最大值, 中文標籤] }。
 * 0 一律表示「這一項不作用」。
 */
function defineKind(d) {
  const keys = Object.keys(d.params);
  return Object.freeze({
    ...d,
    keys,
    range: Object.fromEntries(keys.map((k) => [k, { min: d.params[k][0], max: d.params[k][1] }])),
    labels: Object.fromEntries(keys.map((k) => [k, d.params[k][2]])),
    fileRe: new RegExp(`^[a-z0-9][a-z0-9-]{0,63}${d.ext.replace(/\./g, '\\.')}$`),
  });
}

export const FILTER = defineKind({
  kind: 'filter',
  label: '濾鏡',
  format: 'xixi-filter',
  indexFormat: 'xixi-filter-index',
  ext: '.xixi-filter.json',
  dir: 'filters',
  defaultId: 'none',
  storageKey: 'xixi-beauty-cam.custom-filters',
  selectedKey: 'xixi-beauty-cam.filter',
  params: {
    exposure: [-100, 100, '曝光'],
    contrast: [-100, 100, '對比'],
    saturation: [-100, 100, '飽和'],
    temperature: [-100, 100, '色溫'],
    tint: [-100, 100, '色調'],
    fade: [-100, 100, '褪色'],
    vignette: [-100, 100, '暗角'],
    grain: [0, 100, '顆粒'],
  },
});

export const BEAUTY = defineKind({
  kind: 'beauty',
  label: '美顏',
  format: 'xixi-beauty',
  indexFormat: 'xixi-beauty-index',
  ext: '.xixi-beauty.json',
  dir: 'beauty',
  defaultId: 'natural',
  storageKey: 'xixi-beauty-cam.custom-beauty',
  selectedKey: 'xixi-beauty-cam.beauty',
  params: {
    smooth: [0, 100, '磨皮'],
    whiten: [0, 100, '美白'],
    slim: [0, 100, '瘦臉'],
    eye: [0, 100, '大眼'],
  },
});

export const KINDS = [FILTER, BEAUTY];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TEXT_LIMITS = { name: 20, author: 40, description: 60, license: 40 };
// 控制字元與雙向文字覆寫字元：避免名稱顯示時被反轉或藏字
// eslint-disable-next-line no-control-regex -- intentionally strips control characters
const UNSAFE_CHARS = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fileErr = (message) => ({ ok: false, errors: [{ field: '(整個檔案)', message }] });

export function kindOfFormat(format) {
  return KINDS.find((k) => k.format === format) ?? null;
}

/** 參數夾到該項的範圍並取整數。 */
export function clampParam(kind, key, v) {
  const { min, max } = kind.range[key];
  return Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
}

function cleanText(v) {
  return v.replace(UNSAFE_CHARS, '').trim();
}

/**
 * 驗證一個已解析的預設物件。
 * 回傳 { ok: true, kind, preset, warnings } 或 { ok: false, errors }；errors／warnings 是 [{ field, message }]。
 * preset 是 app 內部用的物件：{ id, name, desc, author, license, params: { 該種預設的參數 } }。
 */
export function validatePreset(kind, data) {
  const errors = [];
  const warnings = [];
  const err = (field, message) => errors.push({ field, message });
  if (!isObj(data)) return fileErr('必須是 JSON 物件 {…}');

  if (!own(data, 'format')) err('format', `缺少，應為 "${kind.format}"`);
  else if (data.format !== kind.format) {
    const other = kindOfFormat(data.format);
    err('format', other ? `這是${other.label}檔（"${other.format}"），不是${kind.label}檔` : `應為 "${kind.format}"`);
  }

  if (!own(data, 'version')) err('version', '缺少，應為 1 以上的整數');
  else if (!Number.isInteger(data.version) || data.version < 1) err('version', '應為 1 以上的整數');
  else if (data.version > FORMAT_VERSION)
    warnings.push({ field: 'version', message: `檔案是第 ${data.version} 版，這個 app 只認得第 ${FORMAT_VERSION} 版的欄位，其餘忽略` });

  if (!own(data, 'id')) err('id', '缺少');
  else if (typeof data.id !== 'string' || !ID_RE.test(data.id)) err('id', '只能用小寫英數與連字號，開頭須為英數，最長 64 字');

  const text = {};
  for (const [k, max] of Object.entries(TEXT_LIMITS)) {
    if (!own(data, k)) {
      if (k === 'name') err('name', '缺少');
      text[k] = '';
      continue;
    }
    if (typeof data[k] !== 'string') {
      err(k, '應為文字');
      continue;
    }
    const s = cleanText(data[k]);
    if (k === 'name' && !s) err('name', '不可為空');
    else if ([...s].length > max) err(k, `最長 ${max} 字（目前 ${[...s].length} 字）`);
    text[k] = s;
  }

  const params = {};
  const shape = `{ ${kind.keys.join(', ')} }`;
  if (!own(data, 'params')) err('params', `缺少，應為 ${shape}`);
  else if (!isObj(data.params)) err('params', `應為物件 ${shape}`);
  else {
    for (const k of kind.keys) {
      const { min, max } = kind.range[k];
      if (!own(data.params, k)) {
        params[k] = 0; // 缺的參數用 0（不作用）
        continue;
      }
      const v = data.params[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        err(`params.${k}`, `應為數字（${min}–${max}）`);
        continue;
      }
      params[k] = clampParam(kind, k, v);
      if (params[k] !== v) warnings.push({ field: `params.${k}`, message: `${v} 已調整為 ${params[k]}（範圍 ${min}–${max} 的整數）` });
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    kind,
    warnings,
    preset: {
      id: data.id,
      name: text.name,
      desc: text.description,
      author: text.author,
      license: text.license,
      params,
    },
  };
}

/**
 * 解析預設檔的文字內容（JSON.parse，不執行任何東西）。
 * 給 kind 就只收那一種；不給就依 format 欄位自動判斷是濾鏡還是美顏預設（匯入時用）。
 */
export function parsePresetText(text, kind = null) {
  if (typeof text !== 'string') return fileErr('讀不到文字內容');
  if (text.length > MAX_FILE_BYTES) return fileErr(`檔案太大（上限 ${MAX_FILE_BYTES / 1024} KB）`);
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    return fileErr(`不是合法的 JSON：${e.message}`);
  }
  if (kind) return validatePreset(kind, data);
  if (!isObj(data)) return fileErr('必須是 JSON 物件 {…}');
  const k = kindOfFormat(data.format);
  if (!k) {
    const want = KINDS.map((x) => `"${x.format}"（${x.label}）`).join(' 或 ');
    return { ok: false, errors: [{ field: 'format', message: own(data, 'format') ? `認不得，應為 ${want}` : `缺少，應為 ${want}` }] };
  }
  return validatePreset(k, data);
}

/** 把內部預設物件轉成要寫出的檔案內容（固定欄位順序，不帶內部狀態）。 */
export function toPresetFile(kind, p) {
  return {
    format: kind.format,
    version: FORMAT_VERSION,
    id: p.id,
    name: p.name,
    author: p.author ?? '',
    description: p.desc ?? '',
    license: p.license ?? '',
    params: Object.fromEntries(kind.keys.map((k) => [k, p.params[k] ?? 0])),
  };
}

export function presetFileText(kind, p) {
  return JSON.stringify(toPresetFile(kind, p), null, 2) + '\n';
}

export function presetFileName(kind, p) {
  return `${p.id}${kind.ext}`;
}

/** 撞到已有的 id 時加尾碼（-2、-3…），長度仍維持在 64 字內。 */
export function uniqueId(id, taken) {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(id)) return id;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const cand = id.slice(0, 64 - suffix.length) + suffix;
    if (!set.has(cand)) return cand;
  }
}

/** 自訂預設的 id：名稱多半是中文，不拿來當 id，改用時間戳記。 */
export function newCustomId(taken, now = Date.now()) {
  return uniqueId(`my-${now.toString(36)}`, taken);
}

/** 全部參數都是 0：不作用（「原圖」濾鏡、「無美顏」）。 */
export function isIdentity(kind, params) {
  return kind.keys.every((k) => params[k] === 0);
}

/**
 * 依 <dir>/index.json 載入一種內建預設。readText(檔名) 回傳該檔文字：
 * 瀏覽器用 fetch（相對於 <dir>/），node 測試用 readFileSync。
 * 回傳 { presets, defaultId, errors }；個別檔案壞掉只略過那一個並記在 errors，不讓整個 app 起不來。
 */
export async function loadBuiltinPresets(kind, readText) {
  const errors = [];
  const fail = (field, message) => ({ presets: [], defaultId: kind.defaultId, errors: [{ file: 'index.json', field, message }] });
  let index;
  try {
    index = JSON.parse(await readText('index.json'));
  } catch (e) {
    return fail('(整個檔案)', e.message);
  }
  if (!isObj(index) || index.format !== kind.indexFormat || !Array.isArray(index.presets)) {
    return fail('format／presets', `應為 { "format": "${kind.indexFormat}", "presets": [檔名…] }`);
  }
  const presets = [];
  const seen = new Set();
  for (const file of index.presets) {
    if (typeof file !== 'string' || !kind.fileRe.test(file)) {
      errors.push({ file: String(file), field: 'presets[]', message: `只接受同資料夾的 <id>${kind.ext} 檔名，不接受網址或路徑` });
      continue;
    }
    let r;
    try {
      r = parsePresetText(await readText(file), kind);
    } catch (e) {
      errors.push({ file, field: '(整個檔案)', message: `讀不到：${e.message}` });
      continue;
    }
    if (!r.ok) {
      for (const x of r.errors) errors.push({ file, ...x });
      continue;
    }
    if (seen.has(r.preset.id)) {
      errors.push({ file, field: 'id', message: `與前面的預設重複（${r.preset.id}）` });
      continue;
    }
    seen.add(r.preset.id);
    presets.push({ ...r.preset, builtin: true });
  }
  const defaultId = typeof index.default === 'string' && seen.has(index.default) ? index.default : (presets[0]?.id ?? kind.defaultId);
  return { presets, defaultId, errors };
}

// ---- 自訂預設（存在瀏覽器 localStorage，濾鏡與美顏各一個鍵）----
// 存的是預設檔格式的陣列，讀回來一樣走 validatePreset；讀寫失敗（私密視窗、封鎖網站資料、空間不足）都吞掉。

export function loadCustomPresets(kind, storage) {
  let list;
  try {
    list = JSON.parse(storage?.getItem(kind.storageKey) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const r = validatePreset(kind, item);
    if (r.ok) out.push({ ...r.preset, custom: true });
  }
  return out;
}

/** 回傳 true 表示存成功。 */
export function saveCustomPresets(kind, storage, presets) {
  try {
    storage.setItem(kind.storageKey, JSON.stringify(presets.map((p) => toPresetFile(kind, p))));
    return true;
  } catch {
    return false;
  }
}
