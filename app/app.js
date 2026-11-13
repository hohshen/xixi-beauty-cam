// SPDX-License-Identifier: Apache-2.0
// xixi-beauty-cam：鏡頭（或「用照片模擬鏡頭」）→ FaceLandmarker → 追蹤 ID → 逐人遮罩與變形參數
//   → WebGL：美顏（只在美顏開的臉上：瘦臉、大眼、磨皮、美白）→ 濾鏡（整張畫面的調色）→ 預覽／拍照
// 底部兩個分頁，各選各的：
// - 濾鏡：內建在 filters/*.xixi-filter.json（清單 filters/index.json），套在整張畫面，美顏關的人也一起套。
// - 美顏：內建在 beauty/*.xixi-beauty.json（清單 beauty/index.json），只套在美顏開的人臉上，不調色。
// 另有「風格」分頁：styles/*.xixi-style.json 只記一個濾鏡 id 與一個美顏 id，點一下同時切換上面兩個分頁。
// 自訂與匯入的預設存在 localStorage；參數 × 強度由 look.js 算好傳給 renderer 與 warp。預設檔只當資料讀（presets.js 驗證），不執行。
// 所有影像與 landmark 只在本機處理。MediaPipe 的 JS、WASM 與模型都放在 vendor/（固定版本），
// 頁面只向自己的網域發請求；index.html 的 CSP（connect-src 'self'）擋掉其他網域，service worker（sw.js）快取全部檔案，離線也能用。

import { FaceLandmarker, FilesetResolver } from './vendor/mediapipe/tasks-vision@1.2.2/vision_bundle.mjs';
import { FaceTracker, faceBox } from './tracker.js';
import { Renderer } from './renderer.js';
import { WarpBuilder } from './warp.js';
import { drawFaceMask } from './mask.js';
import {
  FILTER,
  BEAUTY,
  STYLE,
  MAX_FILE_BYTES,
  loadBuiltinPresets,
  loadCustomPresets,
  saveCustomPresets,
  parsePresetText,
  presetFileText,
  presetFileName,
  uniqueId,
  newCustomId,
  isIdentity,
  resolveStyle,
  missingRefsText,
} from './presets.js';
import { Look, loadSelectedId, saveSelectedId, applyStyle, styleActive } from './look.js';
import { AutoQuality, QUALITY_LEVELS } from './quality.js';
import { camRequest, centerCrop, frameFit, isPortrait, simSize, visibleRect } from './layout.js';

// 都是同網域的相對路徑；版本與來源見 vendor/README.md
const WASM_BASE = new URL('./vendor/mediapipe/tasks-vision@1.2.2/wasm', import.meta.url).href;
const MODEL_URL = new URL('./vendor/mediapipe/models/face_landmarker/float16/1/face_landmarker.task', import.meta.url).href;

const NUM_FACES = 6; // 卡片要求至少 4
const MASK_SCALE = 0.5; // 遮罩解析度 = 影像的一半，柔邊本來就模糊，不需要全解析度
const LABEL_HIDE_AFTER = 8; // 連續幾次沒偵測到就先隱藏標籤（軌跡仍保留，回來時沿用編號）

const $ = (id) => document.getElementById(id);
const video = $('cam');
const canvas = $('view');
const labels = $('labels');
const statusEl = $('status');
const statsEl = $('stats');
const frameEl = $('frame');

const params = new URLSearchParams(location.search);

const tracker = new FaceTracker({ maxMissed: 45 });
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');
const warpBuilder = new WarpBuilder();
let renderer;
let landmarker;
let stream;
let rafId = null;
let lastFrameId = -1;
let frameNo = 0; // 濾鏡顆粒的亂數種子；也是自動降級「每幾幀偵測一次」的計數
// 前後鏡頭：facing 是想要的方向；mirror 依實際開到的鏡頭決定（前鏡頭與沒回報方向的桌機鏡頭鏡像，後鏡頭不鏡像）
let facing = params.get('facing') === 'environment' ? 'environment' : 'user';
let mirror = true;
// 自動降級：?quality=0..4 固定等級；沒給就自動（fps 連續 3 秒 < 24 降一級，連續 15 秒 ≥ 28 升一級）
const quality = new AutoQuality({ fixed: params.get('quality') });

// 影像來源：真鏡頭（<video>）或模擬鏡頭（照片畫進 canvas，每幀當一張鏡頭影格）。
// 之後的偵測、遮罩、變形、渲染、拍照、量測都只看 src，兩種來源走同一條流程。
const SIM_FPS = 30; // 模擬鏡頭的出幀率，對齊鏡頭的 frameRate ideal 30
const simCanvas = document.createElement('canvas');
const simCtx = simCanvas.getContext('2d');
const sim = { img: null, url: null, frame: 0, lastAt: 0, jitter: params.get('jitter') !== '0' };
let src = null; // { kind: 'camera'|'sim', el, width, height, frameId() }
let pendingShot = false;
let ovalOrder = null;

const ui = {
  viewMode: 0,
  showBox: true,
};

// localStorage 可能整個不能用（私密視窗、預覽環境），存取都包在 try/catch 裡
function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const statusTimer = { id: 0 };
/** 暫時的提示（存檔、匯入結果）；過一段時間自動消失，但不清掉別人後來寫的訊息。 */
function flash(msg, ms = 5000) {
  statusEl.textContent = msg;
  clearTimeout(statusTimer.id);
  statusTimer.id = setTimeout(() => {
    if (statusEl.textContent === msg) statusEl.textContent = '';
  }, ms);
}

// ---------- 兩個分頁：濾鏡（整張畫面的調色）、美顏（只在「美顏開」的臉上，不調色） ----------
// 每個分頁各有：內建預設（<dir>/index.json 列的檔案）、自訂預設（localStorage）、一個 Look（選擇、強度、微調）。
const TAB_KEY = 'xixi-beauty-cam.tab';
const FALLBACK_NAME = { filter: '原圖', beauty: '無美顏' };

async function loadBuiltin(kind) {
  // 檔名在 presets.js 驗證過（只接受同資料夾的 <id>.xixi-filter.json／<id>.xixi-beauty.json／<id>.xixi-style.json）
  const b = await loadBuiltinPresets(kind, async (name) => {
    const res = await fetch(new URL(`${kind.dir}/${name}`, import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  if (b.errors.length) {
    console.warn(`內建${kind.label}有問題`, b.errors);
    flash(`內建${kind.label}有 ${b.errors.length} 個問題：${b.errors.map((e) => `${e.file} ${e.field} ${e.message}`).join('；')}`, 15000);
  }
  return b;
}

/** 自訂的（另存與匯入的）接在內建後面；id 撞到內建的就加尾碼 */
function loadCustom(kind, builtin) {
  const custom = [];
  const taken = new Set(builtin.map((p) => p.id));
  for (const p of loadCustomPresets(kind, safeStorage())) {
    p.id = uniqueId(p.id, taken);
    taken.add(p.id);
    custom.push(p);
  }
  return custom;
}

function makeTab(kind, builtin, defaultId) {
  const panel = $(`panel-${kind.kind}`);
  return {
    kind,
    builtin,
    defaultId,
    custom: loadCustom(kind, builtin),
    panel,
    q: (cls) => panel.querySelector(`.${cls}`),
    items: new Map(), // id -> {btn, thumb, css}
    advEls: {},
    all() {
      return [...this.builtin, ...this.custom];
    },
  };
}

async function loadTab(kind) {
  const b = await loadBuiltin(kind);
  if (!b.presets.length) {
    // 清單整個讀不到（例如直接用 file:// 開頁面）：至少留一個全 0（不作用）的預設讓頁面能用
    const params = Object.fromEntries(kind.keys.map((k) => [k, 0]));
    b.presets.push({ id: 'none', name: FALLBACK_NAME[kind.kind], desc: '', author: '', license: '', params, builtin: true });
    b.defaultId = 'none';
  }
  const tab = makeTab(kind, b.presets, b.defaultId);
  tab.look = new Look(kind, tab.all(), b.defaultId).select(loadSelectedId(kind, safeStorage(), tab.all(), b.defaultId));
  return tab;
}

// 風格分頁：沒有 Look，只有清單與「最後點選的風格」（匯出用）。讀不到清單就是空的列，不影響另外兩個分頁。
async function loadStyleTab() {
  const tab = makeTab(STYLE, (await loadBuiltin(STYLE)).presets, null);
  tab.selectedId = null;
  return tab;
}

const tabs = { filter: await loadTab(FILTER), beauty: await loadTab(BEAUTY) };
const TAB_LIST = [tabs.filter, tabs.beauty]; // 有 Look（選擇、強度、微調）的兩個分頁
tabs.style = await loadStyleTab();
const PANEL_LIST = [tabs.style, ...TAB_LIST]; // 底部三個分頁，順序同 index.html
const lookPair = () => ({ filter: tabs.filter.look, beauty: tabs.beauty.look });
let activeKind = 'filter';
// 每幀傳進 renderer 與 warp 的值；只在操作時重算。filter 作用在整張畫面，beauty 只作用在美顏開的臉。
const effect = { filter: tabs.filter.look.params(), beauty: tabs.beauty.look.params() };

// ---------- 量測 ----------
const perf = {
  frames: 0,
  windowStart: performance.now(),
  fps: 0,
  detectMs: 0,
  maskMs: 0,
  drawMs: 0,
  frameMs: 0,
};
function ema(prev, v) {
  return prev === 0 ? v : prev * 0.9 + v * 0.1;
}

// ---------- 分頁、預設列、強度、進階 ----------
function setTab(kind) {
  if (!tabs[kind]) kind = 'filter';
  activeKind = kind;
  for (const t of PANEL_LIST) {
    const on = t.kind.kind === kind;
    $(`tab-${t.kind.kind}`).setAttribute('aria-selected', String(on));
    t.panel.hidden = !on;
  }
  try {
    safeStorage()?.setItem(TAB_KEY, kind);
  } catch {
    /* 記不住分頁也沒關係 */
  }
  thumbAt = 0;
}

// 預設列：新增或移除自訂預設後整列重畫。檔案裡的文字（名稱、說明、作者）一律用 textContent，不當 HTML 解讀。
function renderBar(tab) {
  const bar = tab.q('preset-bar');
  bar.replaceChildren();
  tab.items.clear();
  tab.all().forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'preset-item';
    const btn = document.createElement('button');
    btn.className = 'preset';
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.dataset.id = p.id;
    btn.title = `${p.name}：${p.desc}` + (p.author ? `（作者：${p.author}）` : '');
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 96;
    paintPlaceholder(thumb, i + (tab.kind === BEAUTY ? 3 : tab.kind === STYLE ? 6 : 0));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = p.desc;
    btn.append(thumb, name, desc);
    item.appendChild(btn);
    if (p.custom) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '自訂';
      btn.appendChild(badge);
      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.type = 'button';
      rm.dataset.id = p.id;
      rm.textContent = '×';
      rm.title = `從${tab.kind.label}列移除「${p.name}」`;
      rm.setAttribute('aria-label', rm.title);
      item.appendChild(rm);
    }
    bar.appendChild(item);
    tab.items.set(p.id, { btn, thumb, css: thumbCss(tab.kind, p) });
  });
  thumbAt = 0; // 開始後下一幀就把新縮圖換成目前畫面
}

function buildControls(tab) {
  const { kind } = tab;
  renderBar(tab);
  tab.q('preset-bar').addEventListener('click', (e) => {
    const rm = e.target.closest('.remove');
    if (rm) {
      removeCustom(tab, rm.dataset.id);
      return;
    }
    const btn = e.target.closest('.preset');
    if (btn) selectPreset(tab, btn.dataset.id);
  });

  // 進階滑桿：標籤與範圍來自 presets.js 的定義（濾鏡 -100～100、顆粒 0～100；美顏 0～100）
  const box = tab.q('adv-sliders');
  for (const k of kind.keys) {
    const row = document.createElement('label');
    row.className = 'adv';
    const label = document.createElement('span');
    label.textContent = kind.labels[k];
    const input = document.createElement('input');
    input.type = 'range';
    input.min = kind.range[k].min;
    input.max = kind.range[k].max;
    input.dataset.key = k;
    const out = document.createElement('output');
    row.append(label, input, out);
    box.appendChild(row);
    tab.advEls[k] = { input, out };
    input.addEventListener('input', (e) => {
      tab.look.tune(k, e.target.value);
      syncLook(tab);
    });
  }

  tab.q('strength').addEventListener('input', (e) => {
    tab.look.setStrength(e.target.value);
    syncLook(tab);
  });
  tab.q('adv-btn').addEventListener('click', () => setAdvanced(tab, tab.q('advanced').hidden));
  tab.q('adv-reset').addEventListener('click', () => selectPreset(tab, tab.look.preset.id));
  tab.q('save-btn').addEventListener('click', () => openSaveForm(tab));
  tab.q('save-form').addEventListener('submit', (e) => saveCurrentAsCustom(tab, e));
  tab.q('save-cancel').addEventListener('click', () => {
    tab.q('save-form').hidden = true;
  });
  tab.q('export-btn').addEventListener('click', () => exportCurrent(tab));
  tab.q('import-btn').addEventListener('click', () => $('importFile').click());
}

// 開始前的縮圖：純色塊（色相依位置分開），開始後換成目前畫面
function paintPlaceholder(c, i) {
  const g = c.getContext('2d');
  const hue = (i * 47 + 200) % 360;
  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, `hsl(${hue} 35% 38%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360} 40% 22%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
}

// 縮圖的 CSS filter：濾鏡用自己的參數；風格用它引用的濾鏡（找不到就不調色）；美顏不調色
function thumbCss(kind, p) {
  if (kind === FILTER) return thumbFilterCss(p.params);
  if (kind === STYLE) {
    const f = tabs.filter.all().find((x) => x.id === p.filter);
    return f ? thumbFilterCss(f.params) : 'none';
  }
  return 'none';
}

// 濾鏡縮圖的近似預覽：用 2D canvas 的 CSS filter 粗略模擬曝光、對比、飽和、色溫（只給縮圖看大概，實際效果以預覽為準）
function thumbFilterCss(p) {
  const parts = [`brightness(${(2 ** (p.exposure / 100)).toFixed(3)})`, `contrast(${(1 + p.contrast / 200).toFixed(3)})`];
  parts.push(`saturate(${Math.max(0, 1 + p.saturation / 100).toFixed(3)})`);
  if (p.temperature > 0) parts.push(`sepia(${(p.temperature / 150).toFixed(3)})`);
  if (p.temperature < 0) parts.push(`hue-rotate(${(p.temperature / 5).toFixed(1)}deg)`);
  return parts.join(' ');
}

// 縮圖：從預覽看得到的範圍取中央一塊、鏡像，約每 500 ms 更新一次（只更新目前分頁；只用 2D drawImage，不跑美顏）。
// 直式視窗用 3:4 直式縮圖（72×96），橫式用正方形（96×96）；CSS 尺寸由 body.portrait 切換。
const THUMB_EVERY = 500;
let thumbAt = 0;
function updateThumbs(now) {
  if (now - thumbAt < THUMB_EVERY) return;
  thumbAt = now;
  const tw = document.body.classList.contains('portrait') ? 72 : 96,
    th = 96;
  const r = centerCrop(visibleRect(src.width, src.height, innerWidth, innerHeight), tw / th);
  for (const { thumb, css } of tabs[activeKind].items.values()) {
    if (thumb.width !== tw || thumb.height !== th) {
      thumb.width = tw;
      thumb.height = th;
    }
    const g = thumb.getContext('2d');
    g.filter = css;
    if (mirror) g.setTransform(-1, 0, 0, 1, thumb.width, 0);
    else g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(src.el, r.x, r.y, r.w, r.h, 0, 0, thumb.width, thumb.height);
  }
}

function selectPreset(tab, id) {
  tab.look.select(id);
  saveSelectedId(tab.kind, safeStorage(), tab.look.preset.id);
  syncLook(tab);
  tab.items.get(tab.look.preset.id)?.btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

// 把一個分頁的 look 狀態同步到畫面與每幀參數
function syncLook(tab) {
  const { look, kind } = tab;
  effect[kind.kind] = look.params();
  const p = look.preset;
  for (const [id, { btn }] of tab.items) btn.setAttribute('aria-checked', String(id === p.id));
  // 「原圖」「無美顏」沒有東西可以調強度；但在進階裡微調過就要能調
  const isNone = isIdentity(kind, p.params) && !look.tuned;
  tab.q('strength').disabled = isNone;
  tab.q('strength-name').textContent = p.name + (look.tuned ? '＊' : '');
  tab.q('strength').value = look.strength;
  tab.q('strength-val').value = `${look.strength}%`;
  for (const k of kind.keys) {
    tab.advEls[k].input.value = look.base[k];
    tab.advEls[k].out.value = look.base[k];
  }
  syncStyle();
}

// ---------- 風格分頁：一個濾鏡＋一個美顏，點一下同時切換兩個分頁 ----------
// 打勾的是「目前兩個分頁選的預設剛好是它引用的」那個風格；之後在分頁裡微調也還算，換了預設就不算。
function syncStyle() {
  const tab = tabs.style;
  if (!tab) return; // 啟動時兩個分頁先同步，風格分頁還沒載入
  const l = lookPair();
  const lists = { filter: tabs.filter.all(), beauty: tabs.beauty.all() };
  for (const [id, { btn }] of tab.items) {
    const s = tab.all().find((x) => x.id === id);
    btn.setAttribute('aria-checked', String(styleActive(s, l)));
    const { missing } = resolveStyle(s, lists);
    btn.classList.toggle('broken', missing.length > 0);
    btn.title = missing.length
      ? `${s.name}：${missingRefsText(missing)}`
      : `${s.name}：${s.desc}` + (s.author ? `（作者：${s.author}）` : '');
  }
  const tuned = TAB_LIST.some((t) => t.look.tuned || t.look.strength !== 100) ? '（已調整）' : '';
  tab.q('style-now').textContent = `濾鏡「${l.filter.preset.name}」＋美顏「${l.beauty.preset.name}」${tuned}`;
  tab.q('export-btn').disabled = !tab.all().some((x) => x.id === tab.selectedId);
}

/** 套用風格：兩個分頁同時切到它引用的預設（存起來、更新畫面）；回傳缺了哪些引用。 */
function applyStyleById(id) {
  const tab = tabs.style;
  const s = tab.all().find((x) => x.id === id);
  if (!s) return null;
  tab.selectedId = id;
  const { missing } = applyStyle(s, lookPair());
  for (const t of TAB_LIST) {
    saveSelectedId(t.kind, safeStorage(), t.look.preset.id);
    syncLook(t);
  }
  return missing;
}

function pickStyle(id) {
  const s = tabs.style.all().find((x) => x.id === id);
  const missing = applyStyleById(id);
  if (!s || !missing?.length) return;
  // 缺的那一項保持原樣，另一項照套；兩項都缺就什麼都沒變
  const rest = missing.length === 2 ? '沒有套用任何效果' : `只套用了${missing[0].field === 'filter' ? '美顏' : '濾鏡'}`;
  flash(`風格「${s.name}」${missingRefsText(missing)}，${rest}；把缺的檔案匯入後再點一次`, 10000);
}

function buildStyleControls(tab) {
  renderBar(tab);
  tab.q('preset-bar').addEventListener('click', (e) => {
    const rm = e.target.closest('.remove');
    if (rm) {
      removeCustom(tab, rm.dataset.id);
      return;
    }
    const btn = e.target.closest('.preset');
    if (btn) pickStyle(btn.dataset.id);
  });
  tab.q('export-btn').addEventListener('click', () => exportStyle(tab));
  tab.q('import-btn').addEventListener('click', () => $('importFile').click());
}

function exportStyle(tab) {
  const s = tab.all().find((x) => x.id === tab.selectedId);
  if (!s) {
    flash('先點一個風格，再匯出');
    return;
  }
  downloadText(presetFileText(STYLE, s), presetFileName(STYLE, s));
  // 風格檔只記 id：引用的是自訂預設時，對方也要有那個檔
  const r = resolveStyle(s, { filter: tabs.filter.all(), beauty: tabs.beauty.all() });
  const extra = Object.keys(STYLE.refs)
    .filter((k) => r[k]?.custom)
    .map((k) => `${STYLE.refs[k].label}「${r[k].name}」`);
  flash(
    extra.length
      ? `已匯出 ${presetFileName(STYLE, s)}；它用到自訂的${extra.join('、')}，請到那個分頁一起匯出給對方`
      : `已匯出 ${presetFileName(STYLE, s)}`,
    8000,
  );
}

function setAdvanced(tab, open) {
  tab.q('advanced').hidden = !open;
  tab.q('adv-btn').setAttribute('aria-expanded', String(open));
  if (!open) tab.q('save-form').hidden = true;
}

// ---------- 自訂預設：另存、移除 ----------
const AUTHOR_KEY = 'xixi-beauty-cam.author';

function persistCustom(tab) {
  const s = safeStorage();
  if (!s || !saveCustomPresets(tab.kind, s, tab.custom))
    flash(`瀏覽器不允許儲存（例如私密視窗），自訂${tab.kind.label}在重新整理後會消失；要保留請先匯出`, 8000);
}

function refreshPresets(tab, selectId) {
  if (tab.kind === STYLE) {
    renderBar(tab);
    if (selectId) applyStyleById(selectId);
    else syncStyle();
    return;
  }
  tab.look.setPresets(tab.all());
  renderBar(tab);
  if (selectId) selectPreset(tab, selectId);
  else {
    saveSelectedId(tab.kind, safeStorage(), tab.look.preset.id);
    syncLook(tab);
  }
}

function openSaveForm(tab) {
  const form = tab.q('save-form');
  form.hidden = false;
  let author = '';
  try {
    author = safeStorage()?.getItem(AUTHOR_KEY) ?? '';
  } catch {
    /* 讀不到就留空 */
  }
  tab.q('save-name').value = '';
  tab.q('save-author').value = author;
  tab.q('save-name').focus();
}

// 存的是目前看到的效果：進階的值 × 強度，四捨五入成整數
function saveCurrentAsCustom(tab, e) {
  e.preventDefault();
  const name = tab.q('save-name').value.trim();
  const author = tab.q('save-author').value.trim();
  if (!name) {
    tab.q('save-name').focus();
    return;
  }
  const p = {
    id: newCustomId(tab.all().map((x) => x.id)),
    name,
    author,
    desc: `以「${tab.look.preset.name}」調整`,
    license: '',
    params: tab.look.effectiveParams(),
    custom: true,
  };
  tab.custom.push(p);
  try {
    safeStorage()?.setItem(AUTHOR_KEY, author);
  } catch {
    /* 記不住作者也沒關係 */
  }
  persistCustom(tab);
  tab.q('save-form').hidden = true;
  refreshPresets(tab, p.id);
  flash(`已存成「${name}」，在${tab.kind.label}列尾端`);
}

function removeCustom(tab, id) {
  const p = tab.custom.find((x) => x.id === id);
  if (!p) return;
  tab.custom = tab.custom.filter((x) => x.id !== id);
  persistCustom(tab);
  if (tab.kind === STYLE) {
    if (tab.selectedId === id) tab.selectedId = null;
    refreshPresets(tab, null); // 移除風格不改目前的濾鏡與美顏
  } else refreshPresets(tab, tab.look.preset.id === id ? tab.defaultId : null);
  // 縮圖與「缺哪個」的提示跟著被移除的濾鏡或美顏變
  if (tab.kind !== STYLE) {
    renderBar(tabs.style);
    syncStyle();
  }
  flash(`已移除「${p.name}」`);
}

// ---------- 分享：匯出、匯入 ----------
function downloadText(text, name) {
  downloadBlob(new Blob([text], { type: 'application/json' }), name);
}

function exportCurrent(tab) {
  const p = tab.look.preset;
  const name = presetFileName(tab.kind, p);
  downloadText(presetFileText(tab.kind, p), name);
  const label = tab.kind.label;
  flash(tab.look.tuned ? `已匯出「${p.name}」原本的值；要匯出微調後的效果，先「另存為我的${label}」再匯出那一個` : `已匯出 ${name}`, 7000);
}

const samePreset = (kind, a, b) =>
  a.name === b.name &&
  (kind.refs ? Object.keys(kind.refs).every((k) => a[k] === b[k]) : kind.keys.every((k) => a.params[k] === b.params[k]));

// 檔案只在瀏覽器內讀成文字，交給 parsePresetText（JSON.parse＋逐欄驗證），不執行、不載入裡面的任何網址。
// 依 format 欄位自動分到對的分頁：xixi-filter → 濾鏡，xixi-beauty → 美顏，xixi-style → 風格。
// 風格放在最後處理：同一批一起匯入的濾鏡、美顏先進清單，風格才找得到；它們因撞名改了 id，風格的引用也跟著改。
async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const msgs = [];
  const last = new Map(); // tab -> 最後匯入（或已存在）的 id
  const parsed = [];
  for (const file of files) {
    if (!/\.json$/i.test(file.name)) {
      msgs.push(`「${file.name}」不是 .xixi-filter.json、.xixi-beauty.json 或 .xixi-style.json`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      msgs.push(`「${file.name}」太大（上限 ${MAX_FILE_BYTES / 1024} KB）`);
      continue;
    }
    let r;
    try {
      r = parsePresetText(await file.text());
    } catch (err) {
      msgs.push(`「${file.name}」讀不到：${err.message}`);
      continue;
    }
    if (!r.ok) {
      msgs.push(`「${file.name}」沒有匯入：${r.errors.map((x) => `${x.field} ${x.message}`).join('；')}`);
      continue;
    }
    parsed.push(r);
  }
  parsed.sort((a, b) => (a.kind === STYLE) - (b.kind === STYLE)); // 穩定排序：風格排最後，其餘照原順序
  const renamed = { filter: new Map(), beauty: new Map() }; // 這一批裡：檔案的 id -> 進清單後的 id
  for (const r of parsed) {
    const tab = tabs[r.kind.kind];
    const label = r.kind.label;
    if (r.kind === STYLE) for (const k of Object.keys(STYLE.refs)) r.preset[k] = renamed[k].get(r.preset[k]) ?? r.preset[k];
    const dup = tab.all().find((x) => x.id === r.preset.id && samePreset(r.kind, x, r.preset));
    let p = dup;
    if (dup) {
      msgs.push(`${label}「${r.preset.name}」已經在${label}列裡`);
    } else {
      p = {
        ...r.preset,
        id: uniqueId(
          r.preset.id,
          tab.all().map((x) => x.id),
        ),
        custom: true,
      };
      tab.custom.push(p);
      const warn = r.warnings.length ? `（${r.warnings.map((x) => `${x.field} ${x.message}`).join('；')}）` : '';
      msgs.push(`已匯入${label}「${p.name}」${warn}`);
    }
    last.set(tab, p.id);
    if (renamed[r.kind.kind]) renamed[r.kind.kind].set(r.preset.id, p.id);
    if (r.kind === STYLE) {
      const { missing } = resolveStyle(p, { filter: tabs.filter.all(), beauty: tabs.beauty.all() });
      if (missing.length) msgs.push(`⚠ 風格「${p.name}」${missingRefsText(missing)}，請把缺的檔案一起匯入`);
    }
  }
  // 先更新濾鏡與美顏，風格最後（套用風格時要看到新匯入的預設）
  for (const [tab, id] of last) {
    if (tab.custom.length) persistCustom(tab);
    if (tab.kind === STYLE) renderBar(tab); // 縮圖要用新匯入的濾鏡
    refreshPresets(tab, id);
  }
  // 切到最後匯入的那一種，使用者馬上看得到結果
  const lastTab = [...last.keys()].pop();
  if (lastTab) setTab(lastTab.kind.kind);
  flash(msgs.join('\n'), 10000);
}

for (const t of TAB_LIST) {
  buildControls(t);
  syncLook(t);
}
buildStyleControls(tabs.style);
syncStyle();
{
  let saved = null;
  try {
    saved = safeStorage()?.getItem(TAB_KEY);
  } catch {
    /* 讀不到就用濾鏡分頁 */
  }
  setTab(saved === 'beauty' || saved === 'style' ? saved : 'filter');
}
$('tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[role="tab"]');
  if (t) setTab(t.dataset.kind);
});
$('importFile').addEventListener('change', (e) => {
  importFiles(e.target.files);
  e.target.value = '';
});

// 拖放：只處理檔案，放到頁面任何地方都算
document.addEventListener('dragover', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
document.addEventListener('drop', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  document.body.classList.remove('dragging');
  importFiles(e.dataTransfer.files);
});

// ---------- 其他 UI ----------
function setMenu(open) {
  $('menu').hidden = !open;
  $('menuBtn').setAttribute('aria-expanded', String(open));
}
$('menuBtn').addEventListener('click', () => setMenu($('menu').hidden));
document.addEventListener('pointerdown', (e) => {
  if (!$('menu').hidden && !e.target.closest('#menuWrap')) setMenu(false);
});
$('menuCam').addEventListener('click', () => {
  setMenu(false);
  start();
});
$('menuSim').addEventListener('click', () => {
  setMenu(false);
  $('simFile').click();
});
$('menuImport').addEventListener('click', () => {
  setMenu(false);
  $('importFile').click();
});
$('viewMode').addEventListener('change', (e) => {
  ui.viewMode = Number(e.target.value);
});
$('showBox').addEventListener('change', (e) => {
  ui.showBox = e.target.checked;
});
$('shot').addEventListener('click', () => {
  pendingShot = true;
});
$('start').addEventListener('click', start);
$('flip').addEventListener('click', flipCamera);
$('simBtn').addEventListener('click', () => $('simFile').click());
$('simFile').addEventListener('change', (e) => {
  startSim(e.target.files[0]);
  e.target.value = '';
});
$('simJitter').checked = sim.jitter;
$('simJitter').addEventListener('change', (e) => {
  sim.jitter = e.target.checked;
});

labels.addEventListener('click', (e) => {
  const tag = e.target.closest('.tag');
  if (!tag) return;
  tracker.toggle(Number(tag.dataset.id));
  renderLabels();
});

// ---------- 初始化 ----------
async function initLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: NUM_FACES,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
  } catch (err) {
    console.warn('GPU delegate 失敗，改用 CPU', err);
    return await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
  }
}

function camSize() {
  return { w: Number(params.get('w')) || 1280, h: Number(params.get('h')) || 720 };
}

// 向鏡頭要畫面：網址有 ?w= / ?h= 就照網址；否則一律要橫式（1280×720），由瀏覽器依手機方向轉成直式。
// 0.2.0 在直式時對調成 720×1280 去要，Android Chrome 反而給了橫式畫面（見 layout.js 檔頭）。
function camRequestSize() {
  return params.has('w') || params.has('h') ? camSize() : camRequest(camSize());
}

// #frame 的大小：直式視窗 cover（填滿整個畫面、裁掉多的），橫式視窗 contain（整張放得進、不裁切）。
// 標籤以 #frame 的百分比定位，所以兩種模式都對得上臉。模擬鏡頭在轉向後也跟著換成直式／橫式畫布。
function fitFrame() {
  document.body.classList.toggle('portrait', isPortrait(innerWidth, innerHeight));
  if (!src || !src.width || !src.height) return;
  if (src.kind === 'sim') resizeSim();
  const f = frameFit(src.width, src.height, innerWidth, innerHeight);
  frameEl.style.width = `${f.width}px`;
  frameEl.style.height = `${f.height}px`;
  thumbAt = 0;
}
window.addEventListener('resize', fitFrame);
fitFrame();

async function ensurePipeline() {
  if (landmarker) return;
  statusEl.textContent = '載入人臉模型中…';
  renderer = new Renderer(canvas);
  landmarker = await initLandmarker();
  ovalOrder = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map((c) => c.start);
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

function stopSim() {
  if (sim.url) URL.revokeObjectURL(sim.url);
  sim.img = null;
  sim.url = null;
}

// 換來源時清空軌跡與標籤：上一個來源的「人物 N」對新畫面沒有意義
function switchSource(next) {
  src = next;
  lastFrameId = -1;
  quality.reset();
  syncQualityUi();
  tracker.tracks.length = 0;
  warpBuilder.prev?.clear?.();
  renderLabels();
  thumbAt = 0;
  document.body.classList.add('running');
  document.body.classList.toggle('simulating', next.kind === 'sim');
  $('menuCam').textContent = next.kind === 'sim' ? '切回真鏡頭' : '鏡頭已開啟';
  $('menuCam').disabled = next.kind === 'camera';
  $('menuSim').textContent = next.kind === 'sim' ? '換一張照片' : '用照片模擬鏡頭';
  $('shot').disabled = false;
  updateFlipButton();
  fitFrame();
  statusEl.textContent = '';
  if (rafId === null) rafId = requestAnimationFrame(loop);
}

async function start() {
  const btn = $('start');
  btn.disabled = true;
  try {
    statusEl.textContent = '開啟鏡頭中…';
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('這個瀏覽器不能取用鏡頭（需要 https 或 localhost，iOS 請用 Safari 或 iOS 14.3 以後的瀏覽器）');
    }
    const { w, h } = camRequestSize();
    // iOS 同時只能開一個鏡頭：先關掉舊的再要新的（切前後鏡頭時）
    stopCamera();
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: w },
        height: { ideal: h },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    stopSim();
    stream = s;
    const got = s.getVideoTracks()[0]?.getSettings?.().facingMode;
    if (got === 'user' || got === 'environment') facing = got;
    mirror = (got ?? facing) !== 'environment';
    video.srcObject = stream;
    await new Promise((r) => {
      video.onloadedmetadata = r;
    });
    await video.play();
    await ensurePipeline();
    switchSource({
      kind: 'camera',
      el: video,
      get width() {
        return video.videoWidth;
      },
      get height() {
        return video.videoHeight;
      },
      frameId: () => (video.readyState < 2 ? -1 : video.currentTime),
    });
    return true;
  } catch (err) {
    console.error(err);
    statusEl.textContent = `無法啟動：${err.name || ''} ${err.message || err}`;
    btn.disabled = false;
    return false;
  }
}

// 前後鏡頭切換：只在有兩個以上鏡頭時顯示（取得鏡頭權限後 enumerateDevices 才列得出來）
async function updateFlipButton() {
  const flip = $('flip');
  let n = 0;
  try {
    n = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length;
  } catch {
    /* 列不出鏡頭就不顯示切換鈕 */
  }
  flip.hidden = !(src?.kind === 'camera' && n > 1);
  flip.setAttribute('aria-label', facing === 'user' ? '切換到後鏡頭' : '切換到前鏡頭');
  flip.title = flip.getAttribute('aria-label');
}

async function flipCamera() {
  const flip = $('flip');
  flip.disabled = true;
  const prev = facing;
  facing = facing === 'user' ? 'environment' : 'user';
  if (!(await start())) {
    // 另一顆鏡頭打不開（被別的 app 佔用、權限）：開回原本那顆
    facing = prev;
    await start();
  }
  flip.disabled = false;
}

// ---------- 模擬鏡頭 ----------
// 照片只在瀏覽器內讀取（createObjectURL），不經網路、不離開本機。
async function startSim(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png)$/.test(file.type)) {
    statusEl.textContent = '只支援 jpg、png';
    return;
  }
  const btn = $('simBtn');
  btn.disabled = true;
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    stopCamera();
    stopSim();
    mirror = true;
    sim.img = img;
    sim.url = url;
    sim.frame = 0;
    sim.lastAt = 0;
    resizeSim();
    await ensurePipeline();
    switchSource({
      kind: 'sim',
      el: simCanvas,
      get width() {
        return simCanvas.width;
      },
      get height() {
        return simCanvas.height;
      },
      frameId: simFrame,
    });
  } catch (err) {
    console.error(err);
    statusEl.textContent = `無法讀取照片：${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
}

// 模擬鏡頭的畫布：直式視窗用直式（720×1280），橫式用橫式（1280×720），模擬手機鏡頭轉向後的輸出。
// 尺寸改變時清掉軌跡（landmark 座標的比例變了），並讓下一次 simFrame 重畫。
function resizeSim() {
  const { w, h } = simSize(camSize(), innerWidth, innerHeight);
  if (simCanvas.width === w && simCanvas.height === h) return;
  simCanvas.width = w;
  simCanvas.height = h;
  sim.lastAt = 0;
  tracker.tracks.length = 0;
  warpBuilder.prev?.clear?.();
}

// 依鏡頭解析度等比縮放、置中（不足處補黑邊，不裁切）。抖動開啟時加微小的位移與縮放，
// 讓偵測與追蹤像真鏡頭一樣每幀都有變化。每 1/SIM_FPS 秒出一張新影格，否則回傳上一張的編號。
function simFrame() {
  const now = performance.now();
  if (sim.frame > 0 && now - sim.lastAt < 1000 / SIM_FPS - 1) return sim.frame;
  sim.lastAt = now;
  sim.frame++;
  const { img } = sim;
  const W = simCanvas.width,
    H = simCanvas.height;
  let k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
  let dx = 0,
    dy = 0;
  if (sim.jitter) {
    const t = now / 1000;
    k *= 1 + 0.004 * Math.sin(t * 1.3);
    dx = 2 * Math.sin(t * 2.1);
    dy = 1.5 * Math.sin(t * 1.7 + 1);
  }
  const dw = img.naturalWidth * k,
    dh = img.naturalHeight * k;
  simCtx.fillStyle = '#000';
  simCtx.fillRect(0, 0, W, H);
  simCtx.drawImage(img, (W - dw) / 2 + dx, (H - dh) / 2 + dy, dw, dh);
  return sim.frame;
}

// ---------- 每幀 ----------
function loop() {
  rafId = requestAnimationFrame(loop);
  if (!src) return;
  const fid = src.frameId();
  if (fid === -1 || fid === lastFrameId) return; // 同一幀不重算
  lastFrameId = fid;
  const t0 = performance.now();

  // 自動降級 L2 以上隔幀偵測：沒偵測的影格沿用上一次的 landmark（遮罩與變形照樣每幀重畫）
  if (quality.shouldDetect(frameNo)) {
    const result = landmarker.detectForVideo(src.el, t0);
    const faces = (result.faceLandmarks || []).map((lm) => ({ ...faceBox(lm), landmarks: lm }));
    tracker.update(faces);
  }
  const t1 = performance.now();

  drawMask();
  const warp = warpBuilder.build(tracker.tracks, src.width, src.height, effect.beauty);
  const t2 = performance.now();

  renderer.draw(src.el, maskCanvas, {
    beauty: effect.beauty,
    filter: effect.filter,
    viewMode: ui.viewMode,
    mirror,
    warp,
    seed: frameNo++,
    radius: quality.current.radius,
  });
  if (pendingShot) {
    // 同一個 task 內、緩衝區被清掉前讀取，拍到的就是這一幀預覽
    pendingShot = false;
    savePng();
  }
  const t3 = performance.now();

  renderLabels();
  updateThumbs(t3);

  perf.detectMs = ema(perf.detectMs, t1 - t0);
  perf.maskMs = ema(perf.maskMs, t2 - t1);
  perf.drawMs = ema(perf.drawMs, t3 - t2);
  perf.frameMs = ema(perf.frameMs, performance.now() - t0);
  perf.frames++;
  const now = performance.now();
  if (now - perf.windowStart >= 1000) {
    perf.fps = (perf.frames * 1000) / (now - perf.windowStart);
    perf.frames = 0;
    perf.windowStart = now;
    if (quality.update(perf.fps)) {
      console.info(`自動降級：${perf.fps.toFixed(1)} fps → ${quality.current.label}`);
      syncQualityUi();
    }
    statsEl.textContent =
      `預覽 ${perf.fps.toFixed(1)} fps（${src.width}×${src.height}${src.kind === 'sim' ? '，模擬鏡頭' : ''}）\n` +
      `偵測 ${perf.detectMs.toFixed(1)} ms\n` +
      `遮罩＋變形參數 ${perf.maskMs.toFixed(1)} ms\n` +
      `繪製 ${perf.drawMs.toFixed(1)} ms\n` +
      `每幀 JS 合計 ${perf.frameMs.toFixed(1)} ms\n` +
      `畫質 ${quality.current.label}（${quality.auto ? '自動' : '固定'}）\n` +
      `人數 ${tracker.tracks.filter((t) => t.missed === 0).length}\n` +
      TAB_LIST.map((t) => `${t.kind.label} ${t.look.preset.name} ${t.look.strength}%${t.look.tuned ? '（已微調）' : ''}`).join('\n');
  }
}

function drawMask() {
  const w = Math.round(src.width * MASK_SCALE);
  const h = Math.round(src.height * MASK_SCALE);
  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas.width = w;
    maskCanvas.height = h;
  }
  drawFaceMask(maskCtx, tracker.tracks, ovalOrder);
}

// ---------- 標籤 ----------
const labelEls = new Map(); // id -> {box, tag}

function renderLabels() {
  const alive = new Set();
  for (const t of tracker.tracks) {
    if (t.missed > LABEL_HIDE_AFTER) continue;
    alive.add(t.id);
    let el = labelEls.get(t.id);
    if (!el) {
      const box = document.createElement('div');
      box.className = 'face-box';
      const tag = document.createElement('button');
      tag.className = 'tag';
      tag.dataset.id = t.id;
      box.appendChild(tag);
      labels.appendChild(box);
      el = { box, tag, state: '' };
      labelEls.set(t.id, el);
    }
    // 前鏡頭畫面是鏡像的，x 要翻過來；後鏡頭不鏡像
    const left = mirror ? 1 - (t.cx + t.w / 2) : t.cx - t.w / 2;
    el.box.style.left = `${left * 100}%`;
    el.box.style.top = `${(t.cy - t.h / 2) * 100}%`;
    el.box.style.width = `${t.w * 100}%`;
    el.box.style.height = `${t.h * 100}%`;
    const state = `${t.beauty}|${t.missed > 0}|${ui.showBox}`;
    if (el.state !== state) {
      el.state = state;
      el.box.classList.toggle('off', !t.beauty);
      el.box.classList.toggle('lost', t.missed > 0);
      el.box.classList.toggle('nobox', !ui.showBox);
      el.tag.classList.toggle('off', !t.beauty);
      el.tag.innerHTML = `人物 ${t.id}<span class="state">美顏 ${t.beauty ? '開' : '關'}</span>`;
      el.tag.title = t.beauty ? '點一下關閉這個人的美顏' : '點一下開啟這個人的美顏';
    }
  }
  for (const [id, el] of labelEls) {
    if (!alive.has(id)) {
      el.box.remove();
      labelEls.delete(id);
    }
  }
}

// ---------- 拍照 ----------
// 桌機：直接下載 PNG。觸控裝置且瀏覽器能分享檔案（iOS Safari、Android Chrome）：拍完顯示預覽，
// 使用者再點「分享／存到照片」開系統分享面板（iOS 可選「儲存影像」存進相簿），或點「下載」。
// 分享面板一定要在使用者這一次點擊裡打開（Safari 的規定），所以不在拍照那一刻自動跳出。
const shotSheet = { blob: null, url: null, name: '' };

function shotName() {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `xixi-beauty-cam-${ts}.png`;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function canShareFiles(file) {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

// 照片只取預覽看得到的範圍：直式視窗是 cover，照片跟預覽一樣是直式；橫式（contain）時就是整張畫布。
// 要在 renderer.draw 的同一個 task 裡呼叫（WebGL 緩衝區被清掉前），所以先同步複製到 2D canvas。
function shotCanvas() {
  const r = visibleRect(canvas.width, canvas.height, innerWidth, innerHeight);
  if (r.w === canvas.width && r.h === canvas.height) return canvas;
  const out = document.createElement('canvas');
  out.width = r.w;
  out.height = r.h;
  out.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return out;
}

function savePng() {
  shotCanvas().toBlob((blob) => {
    if (!blob) return;
    const name = shotName();
    const touch = matchMedia('(pointer: coarse)').matches;
    if (!touch || !canShareFiles(new File([blob], name, { type: 'image/png' }))) {
      downloadBlob(blob, name);
      return;
    }
    openShotSheet(blob, name);
  }, 'image/png');
}

function openShotSheet(blob, name) {
  closeShotSheet();
  shotSheet.blob = blob;
  shotSheet.name = name;
  shotSheet.url = URL.createObjectURL(blob);
  $('shotImg').src = shotSheet.url;
  $('shotSheet').hidden = false;
}

function closeShotSheet() {
  $('shotSheet').hidden = true;
  $('shotImg').removeAttribute('src');
  if (shotSheet.url) URL.revokeObjectURL(shotSheet.url);
  shotSheet.blob = shotSheet.url = null;
}

$('shotShare').addEventListener('click', async () => {
  if (!shotSheet.blob) return;
  const file = new File([shotSheet.blob], shotSheet.name, { type: 'image/png' });
  try {
    await navigator.share({ files: [file] });
    closeShotSheet();
  } catch (err) {
    if (err?.name === 'AbortError') return; // 使用者自己關掉分享面板
    console.warn('分享失敗，改成下載', err);
    downloadBlob(shotSheet.blob, shotSheet.name);
    closeShotSheet();
  }
});
$('shotDownload').addEventListener('click', () => {
  if (shotSheet.blob) downloadBlob(shotSheet.blob, shotSheet.name);
  closeShotSheet();
});
$('shotClose').addEventListener('click', closeShotSheet);

// ---------- 畫質（自動降級） ----------
function syncQualityUi() {
  $('quality').value = quality.auto ? 'auto' : String(quality.fixed);
}
$('quality').replaceChildren(
  new Option('自動（fps < 24 時降級）', 'auto'),
  ...QUALITY_LEVELS.map((q) => new Option(`固定 ${q.label}`, String(q.level))),
);
syncQualityUi();
$('quality').addEventListener('change', (e) => {
  quality.setFixed(e.target.value);
  if (quality.auto) quality.reset();
});

// ---------- 手機：轉向、切到背景 ----------
// 轉向後影像比例會變（手機鏡頭跟著轉），重新算 #frame；有些瀏覽器 resize 事件比畫面晚，再補一次
screen.orientation?.addEventListener?.('change', () => {
  fitFrame();
  setTimeout(fitFrame, 300);
});
// 手機切到背景再回來：<video> 可能被暫停（接著播），鏡頭也可能被系統收回（track 變 ended，重開鏡頭）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || src?.kind !== 'camera') return;
  if (!stream || stream.getVideoTracks().every((t) => t.readyState === 'ended')) {
    start();
  } else if (video.paused) {
    video.play().catch(() => {});
  }
});

// ---------- 離線（PWA） ----------
// sw.js 在第一次載入時把頁面、MediaPipe 與模型全部存進快取；之後斷網重新整理也能開啟並偵測人臉。
if ('serviceWorker' in navigator && !params.has('nosw')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    flash(hadController ? '新版本已下載，重新整理後使用' : '離線檔案已存好，之後沒有網路也能開啟', 6000);
  });
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './' }).catch((err) => {
    console.warn('service worker 註冊失敗，離線功能不可用', err);
  });
}

// ---------- 釋放 ----------
window.addEventListener('pagehide', () => {
  if (rafId !== null) cancelAnimationFrame(rafId);
  landmarker?.close();
  stopCamera();
  stopSim();
});

// 給本機自動測試與除錯用的唯讀狀態（不會送出任何資料）
window.beautyCam = {
  tracker,
  perf,
  ui,
  tabs,
  setTab,
  selectPreset: (kind, id) => selectPreset(tabs[kind], id),
  applyStyle: pickStyle,
  importFiles,
  get effect() {
    return effect;
  },
  start,
  startSim,
  sim,
  warpBuilder,
  get source() {
    return src?.kind ?? null;
  },
  quality,
  get mirror() {
    return mirror;
  },
  get facing() {
    return facing;
  },
};
if (params.has('autostart')) start();
