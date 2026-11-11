// SPDX-License-Identifier: Apache-2.0
// 濾鏡與美顏預設的 node 檢查（不需要瀏覽器、鏡頭或網路）：node tests/presets.test.mjs
// 檢查：兩組內建預設合法、預設值、強度與進階微調算出的參數、
// 濾鏡參數傳到整張畫面的調色 uniform、美顏參數只傳到美顏遮罩與變形、美顏關的人不進美顏遮罩與變形、
// localStorage 失敗時的退路，以及 index.html／app.js 的靜態結構（兩個分頁、各自的預設列與強度條）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FILTER, BEAUTY, loadBuiltinPresets } from '../app/presets.js';
import { Look, findPreset, loadSelectedId, saveSelectedId } from '../app/look.js';
import { WarpBuilder, SLIM_N } from '../app/warp.js';
import { Renderer, FRAG, gradeUniforms } from '../app/renderer.js';
import { drawFaceMask } from '../app/mask.js';

let pass = 0,
  fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log(`✅ ${msg}`);
  } else {
    fail++;
    console.log(`❌ ${msg}`);
  }
}
const section = (t) => console.log(`\n## ${t}`);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// 內建預設和 app 一樣依 <dir>/index.json 從檔案載入
const filters = await loadBuiltinPresets(FILTER, (name) => read(`../app/filters/${name}`));
const beauty = await loadBuiltinPresets(BEAUTY, (name) => read(`../app/beauty/${name}`));
const F = filters.presets;
const B = beauty.presets;
const fp = (id) => findPreset(id, F, filters.defaultId);
const bp = (id) => findPreset(id, B, beauty.defaultId);

// ---- 1. 兩組內建預設 ----
section('內建濾鏡（整張畫面的調色）');
ok(filters.errors.length === 0 && F.length === 6, `filters/index.json 與 6 個濾鏡檔都載入成功（錯誤 ${filters.errors.length} 個）`);
ok(filters.defaultId === 'none' && fp('none').name === '原圖', '預設濾鏡是「原圖」（不調色）');
ok(
  FILTER.keys.every((k) => fp('none').params[k] === 0),
  '「原圖」八項都是 0',
);
// 卡片給的起始值（2026-11-11）。改值時這張表一起改，並在 PR 寫理由。
const TABLE = {
  原圖: [0, 0, 0, 0, 0, 0, 0, 0],
  清新: [5, -5, 10, -5, 0, 0, 0, 0],
  暖陽: [3, 5, 5, 25, 5, 5, 10, 0],
  冷白: [8, 0, -10, -20, 0, 5, 0, 0],
  膠片: [0, -10, -15, 10, 5, 25, 20, 15],
  黑白: [0, 15, -100, 0, 0, 5, 15, 10],
};
for (const [name, vals] of Object.entries(TABLE)) {
  const p = F.find((x) => x.name === name);
  ok(
    p && FILTER.keys.every((k, i) => p.params[k] === vals[i]),
    `「${name}」= ${FILTER.keys.map((k, i) => `${FILTER.labels[k]} ${vals[i]}`).join('、')}`,
  );
}
ok(
  F.every((p) =>
    FILTER.keys.every((k) => Number.isInteger(p.params[k]) && p.params[k] >= FILTER.range[k].min && p.params[k] <= FILTER.range[k].max),
  ),
  '每個濾鏡的值都是範圍內的整數（-100–100，顆粒 0–100）',
);

section('內建美顏預設（只在臉上，不調色）');
ok(beauty.errors.length === 0 && B.length === 6, `beauty/index.json 與 6 個美顏檔都載入成功（錯誤 ${beauty.errors.length} 個）`);
ok(beauty.defaultId === 'natural' && bp(beauty.defaultId).name === '自然', '預設美顏是「自然」');
for (const n of ['無美顏', '自然', '清透', '亮白', '精緻', '網紅'])
  ok(
    B.some((p) => p.name === n),
    `有「${n}」`,
  );
ok(!B.some((p) => p.name === '原圖'), '美顏列不再叫「原圖」（「原圖」只用在濾鏡）');
ok(
  BEAUTY.keys.every((k) => bp('none').params[k] === 0),
  '「無美顏」四個值都是 0',
);
ok(
  B.every((p) => BEAUTY.keys.every((k) => Number.isInteger(p.params[k]) && p.params[k] >= 0 && p.params[k] <= 100)),
  '每個美顏預設的四個值都是 0–100 的整數',
);
ok(
  JSON.stringify(BEAUTY.keys) === '["smooth","whiten","slim","eye"]' && BEAUTY.keys.every((k) => !FILTER.keys.includes(k)),
  '美顏只有磨皮、美白、瘦臉、大眼，與濾鏡的參數沒有重疊（美顏不調色）',
);
ok(fp('不存在').id === 'none' && bp('不存在').id === 'natural', '未知 id 退回各自的預設');

// ---- 2. 參數計算 ----
section('強度與進階微調');
const bl = new Look(BEAUTY, B, beauty.defaultId);
ok(bl.preset.id === 'natural' && bl.strength === 100, '新的美顏 Look 是「自然」100%');
for (const p of B) {
  const v = bl.select(p.id).params();
  ok(
    BEAUTY.keys.every((k) => near(v[k], p.params[k] / 100)),
    `美顏「${p.name}」→ ${BEAUTY.keys.map((k) => `${k} ${v[k].toFixed(2)}`).join(' ')}`,
  );
}
bl.select('glam').setStrength(50);
let v = bl.params();
ok(near(v.smooth, 0.375) && near(v.whiten, 0.25) && near(v.slim, 0.275) && near(v.eye, 0.25), '網紅 × 強度 50% → 四個值等比減半');
ok(
  Object.values(bl.setStrength(0).params()).every((x) => x === 0),
  '強度 0% → 四個值都是 0',
);
ok(bl.setStrength(150).strength === 100 && bl.setStrength(-5).strength === 0, '強度超出範圍會夾在 0–100');
bl.select('natural').tune('slim', 80);
ok(near(bl.params().slim, 0.8) && near(bl.params().smooth, 0.35) && bl.tuned, '進階微調只改那一項，並標記已微調');
ok(bp('natural').params.slim === 10, '進階微調不改預設檔的定義');
ok(bl.tune('eye', 150).base.eye === 100 && bl.tune('eye', -3).base.eye === 0, '美顏微調夾在 0–100');
bl.select('natural');
ok(!bl.tuned && bl.strength === 100 && near(bl.params().slim, 0.1), '重選同一個預設 = 還原（強度 100%、微調清掉）');
let threw = false;
try {
  bl.tune('saturation', 1);
} catch {
  threw = true;
}
ok(threw, '美顏分頁不接受濾鏡的參數（saturation）');

const fl = new Look(FILTER, F, filters.defaultId);
ok(fl.preset.id === 'none' && fl.identity, '新的濾鏡 Look 是「原圖」，不作用');
fl.select('mono');
v = fl.params();
ok(near(v.saturation, -1) && near(v.contrast, 0.15) && near(v.grain, 0.1), '黑白 → 飽和 -1.00、對比 0.15、顆粒 0.10');
fl.setStrength(50);
v = fl.params();
ok(near(v.saturation, -0.5) && near(v.vignette, 0.075), '黑白 × 強度 50% → 負值也等比縮放（飽和 -0.50）');
ok(
  fl.tune('temperature', -250).base.temperature === -100 && fl.tune('grain', -20).base.grain === 0,
  '濾鏡微調依各項範圍夾值（色溫 -100、顆粒最小 0）',
);
ok(
  JSON.stringify(fl.select('warm').setStrength(50).effectiveParams()) ===
    JSON.stringify({ exposure: 2, contrast: 3, saturation: 3, temperature: 13, tint: 3, fade: 3, vignette: 5, grain: 0 }),
  '另存時存的是「值 × 強度」取整數',
);

// ---- 3. 濾鏡 → 整張畫面的調色 uniform；美顏 → 只進美顏遮罩與變形 ----
section('渲染：濾鏡套整張畫面、美顏只套美顏開的臉');
// 假的 WebGL2：記錄每個 uniform 最後被設成什麼值
function fakeGl() {
  const set = new Map();
  const handler = {
    get(_, name) {
      if (name === 'getUniformLocation') return (_p, n) => n;
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
      if (name === 'getAttribLocation') return () => 0;
      if (/^uniform/.test(name))
        return (loc, ...vals) => set.set(loc, vals.length === 1 && ArrayBuffer.isView(vals[0]) ? Array.from(vals[0]) : vals);
      if (typeof name === 'string' && /^[A-Z_0-9]+$/.test(name)) return name;
      return () => ({});
    },
  };
  return { gl: new Proxy({}, handler), set };
}
const { gl, set } = fakeGl();
const r = new Renderer({ getContext: () => gl, width: 0, height: 0 });
const frame = { width: 64, height: 48 };
const close = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
fl.select('warm');
bl.select('glam');
r.draw(frame, frame, { beauty: bl.params(), filter: fl.params(), warp: null });
ok(set.get('uGrade')[0] === 1, '選了「暖陽」→ 打開整張畫面的調色（uGrade = 1）');
ok(
  close(set.get('uGradeA'), [0.03, 0.05, 0.05, 0.25]) && close(set.get('uGradeB'), [0.05, 0.05, 0.1, 0]),
  `濾鏡參數原樣傳到調色 uniform：A ${set.get('uGradeA').join(', ')}／B ${set.get('uGradeB').join(', ')}`,
);
ok(near(set.get('uSmooth')[0], 0.75) && near(set.get('uBright')[0], 0.5), '美顏的磨皮、美白傳到美顏 uniform（網紅 0.75、0.50）');
fl.select('none');
r.draw(frame, frame, { beauty: bl.params(), filter: fl.params() });
ok(set.get('uGrade')[0] === 0, '「原圖」→ 調色整段跳過（uGrade = 0），輸出與不套濾鏡逐像素相同');
r.draw(frame, frame, { beauty: bl.select('none').params(), filter: fl.select('mono').params() });
ok(
  set.get('uGrade')[0] === 1 && set.get('uSmooth')[0] === 0 && set.get('uBright')[0] === 0,
  '「無美顏」＋「黑白」→ 只調色，美顏 uniform 全是 0（兩組互不影響）',
);
ok(gradeUniforms({ grain: -0.5 }).b[3] === 0 && !gradeUniforms({ grain: -0.5 }).on, '顆粒負值視同 0');

// shader 的結構：調色在美顏之後、不乘遮罩；差異檢視比對「只套濾鏡」的畫面
const main = FRAG.slice(FRAG.indexOf('void main()'));
const iBeauty = main.indexOf('if (m > 0.0)');
const iGrade = main.indexOf('result = grade(result, vUV);');
ok(iBeauty > 0 && iGrade > iBeauty, 'shader 先做美顏（遮罩 R 內），再對整張畫面調色');
ok(!/grade\([^)]*\)\s*\*\s*m|mix\([^;]*grade\(/.test(main), '調色不乘美顏遮罩，也不和原圖混合：整張畫面都套');
ok(/abs\(result - grade\(src, vUV\)\)/.test(main), '差異檢視比對「只套濾鏡、不套美顏」的畫面，美顏關的人是全黑');
ok(/float m = texture\(uMask, uv\)\.r \* \(1\.0 - protect\)/.test(main), '美顏遮罩在保護區（美顏關的人）內歸 0');

// 遮罩：美顏關的人只畫進 G（保護區），不畫進 R（美顏範圍）
function fakeCtx() {
  const fills = [];
  const ctx = {
    canvas: { width: 128, height: 96 },
    fillStyle: '',
    filter: '',
    globalCompositeOperation: '',
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      fills.push(ctx.fillStyle);
    },
  };
  return { ctx, fills };
}
// 假 landmark：478 點都放在一張 200×240 的臉框內，足夠讓 faceGeometry 算出非零幾何
function fakeLandmarks(cx, cy) {
  const lm = [];
  for (let i = 0; i < 478; i++) {
    const a = (i / 478) * Math.PI * 2;
    lm.push({ x: (cx + Math.cos(a) * 100 * ((i % 7) / 7 + 0.3)) / 1280, y: (cy + Math.sin(a) * 120 * ((i % 5) / 5 + 0.3)) / 720, z: 0 });
  }
  return lm;
}
const tracks = [
  { id: 1, beauty: true, cx: 0.25, cy: 0.5, w: 0.15, landmarks: fakeLandmarks(300, 360) },
  { id: 2, beauty: false, cx: 0.7, cy: 0.5, w: 0.15, landmarks: fakeLandmarks(900, 360) },
];
const oval = Array.from({ length: 36 }, (_, i) => i * 13);
const m = fakeCtx();
drawFaceMask(m.ctx, tracks, oval);
ok(JSON.stringify(m.fills) === '["#f00","#0f0"]', '遮罩：美顏開的人物 1 畫進 R（美顏範圍），美顏關的人物 2 只畫進 G（保護區）');

// 變形：只有美顏開的人進 warp
const wb = new WarpBuilder({ smooth: 1 });
let w = wb.build(tracks, 1280, 720, bl.select('none').params());
ok(w.count === 0, '「無美顏」：沒有任何臉送進變形');
w = wb.build(tracks, 1280, 720, bl.select('glam').params());
ok(w.count === 1, '「網紅」：只有美顏開的人物 1 送進變形，美顏關的人物 2 沒有');
ok(Math.abs(w.eye[3] - 0.32 * 0.5) < 1e-6, `大眼放大量 = EYE_MAX × 0.50（${w.eye[3].toFixed(3)}）`);
const full = Array.from(w.slimPt.slice(0, SLIM_N * 4));
w = wb.build(tracks, 1280, 720, bl.select('glam').setStrength(50).params());
ok(near(w.slimPt[2], full[2] / 2) && near(w.slimPt[3], full[3] / 2), '強度 50% → 瘦臉位移剛好減半');
w = wb.build(tracks, 1280, 720, { ...bl.select('glam').params(), ...fl.select('mono').params() });
ok(w.count === 1, '濾鏡參數不影響變形：只看美顏的瘦臉、大眼');
tracks[0].beauty = false;
w = wb.build(tracks, 1280, 720, bl.select('glam').params());
const m2 = fakeCtx();
drawFaceMask(m2.ctx, tracks, oval);
ok(w.count === 0 && !m2.fills.includes('#f00'), '兩人都關掉美顏時，最強的美顏也沒有人變形、遮罩沒有美顏範圍');

// ---- 4. localStorage：兩個分頁各記各的 ----
section('記住上次的選擇');
const mem = new Map();
const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, val) => mem.set(k, String(val)) };
ok(
  loadSelectedId(FILTER, storage, F, 'none') === 'none' && loadSelectedId(BEAUTY, storage, B, 'natural') === 'natural',
  '沒存過 → 各自的預設',
);
saveSelectedId(FILTER, storage, 'film');
saveSelectedId(BEAUTY, storage, 'bright');
ok(
  loadSelectedId(FILTER, storage, F, 'none') === 'film' && loadSelectedId(BEAUTY, storage, B, 'natural') === 'bright',
  '濾鏡存「膠片」、美顏存「亮白」→ 下次各自讀回',
);
ok(FILTER.selectedKey !== BEAUTY.selectedKey && FILTER.storageKey !== BEAUTY.storageKey, '兩組用不同的 localStorage 鍵，互不覆蓋');
mem.set(BEAUTY.selectedKey, 'deleted');
ok(loadSelectedId(BEAUTY, storage, B, 'natural') === 'natural', '存的預設已被刪掉 → 預設');
const broken = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceeded');
  },
};
let noThrow = true;
try {
  saveSelectedId(FILTER, broken, 'mono');
  ok(loadSelectedId(FILTER, broken, F, 'none') === 'none', 'storage 丟例外 → 讀到預設');
} catch {
  noThrow = false;
}
ok(noThrow && loadSelectedId(BEAUTY, null, B, 'natural') === 'natural', 'storage 丟例外或不存在都不會讓頁面壞掉');

// ---- 5. 靜態結構 ----
section('頁面結構');
const html = read('../app/index.html');
const app = read('../app/app.js');
const tabsHtml = html.match(/<div id="tabs" role="tablist"[\s\S]*?<\/div>/)?.[0] ?? '';
const tabNames = [...tabsHtml.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((x) => x[1].trim());
ok(JSON.stringify(tabNames) === '["濾鏡","美顏"]', `底部只有兩個分頁：${tabNames.join('、')}`);
for (const k of ['filter', 'beauty']) {
  const panel = html.match(new RegExp(`<section id="panel-${k}"[\\s\\S]*?</section>`))?.[0] ?? '';
  ok(
    /class="strength"[^>]*type="range"/.test(panel) && /class="preset-bar"/.test(panel),
    `「${k === 'filter' ? '濾鏡' : '美顏'}」分頁有自己的強度條與預設列`,
  );
  ok(
    new RegExp(`<div id="${k}Advanced" class="advanced" hidden>`).test(panel),
    `「${k === 'filter' ? '濾鏡' : '美顏'}」分頁的「進階」預設收起`,
  );
}
ok((html.match(/type="range"/g) || []).length === 2, '主畫面只有兩條滑桿（兩個分頁各一條強度）；進階滑桿收在「進階」裡由程式產生');
const order = ['id="tabs"', 'id="panel-filter"', 'id="panel-beauty"', 'id="shutterRow"'].map((s) => html.indexOf(s));
ok(
  order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])),
  '由上而下：分頁 → 濾鏡／美顏面板 → 快門（快門在最下方）',
);
ok(/<div id="menu" hidden>[\s\S]*id="viewMode"[\s\S]*id="stats"/.test(html), 'fps 面板與檢視模式收在角落選單裡（預設收起）');
ok(!/params:\s*\{\s*\w+:\s*[1-9]/.test(app), 'app.js 沒有寫死預設參數（只從檔案讀；載入失敗時的備用預設是全 0）');
ok(
  !/(smooth|whiten|exposure|saturation):\s*-?\d/.test(read('../app/presets.js') + read('../app/look.js')),
  'presets.js、look.js 沒有寫死任何預設的參數值',
);
ok(
  /build\(tracker\.tracks, src\.width, src\.height, effect\.beauty\)/.test(app) &&
    /renderer\.draw\(src\.el, maskCanvas, \{ beauty: effect\.beauty, filter: effect\.filter/.test(app),
  'app.js 每幀把美顏參數傳給 warp 與 renderer 的美顏，把濾鏡參數傳給 renderer 的調色',
);
const all = [
  'index.html',
  'style.css',
  'app.js',
  'presets.js',
  'look.js',
  'renderer.js',
  'filters/index.json',
  'beauty/index.json',
  ...F.map((p) => `filters/${p.id}.xixi-filter.json`),
  ...B.map((p) => `beauty/${p.id}.xixi-beauty.json`),
]
  .map((f) => read('../app/' + f))
  .join('\n');
ok(!/ulike|looks/i.test(all), '頁面程式沒有出現 Ulike 或 Looks 字樣');

console.log(`\n${fail === 0 ? '全部通過' : '有失敗'}：${pass} 通過、${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
