// SPDX-License-Identifier: Apache-2.0
// 濾鏡檔（*.xixi-filter.json）與美顏預設檔（*.xixi-beauty.json）的格式測試（不需要瀏覽器）：node tests/preset-format.test.mjs
// 兩種格式各跑五種情況：合法、缺欄位、超出範圍、多餘欄位、惡意文字；
// 另外檢查匯入時依 format 自動分類、schema.json 與驗證程式一致、自訂預設的存取、程式碼只把檔案當資料。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FILTER,
  BEAUTY,
  KINDS,
  validatePreset,
  parsePresetText,
  toPresetFile,
  presetFileText,
  presetFileName,
  loadBuiltinPresets,
  loadCustomPresets,
  saveCustomPresets,
  uniqueId,
  newCustomId,
} from '../app/presets.js';

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
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const fields = (r) => (r.errors ?? []).map((e) => e.field);
const clone = (o) => JSON.parse(JSON.stringify(o));

// 只實作 schema.json 用到的關鍵字，用來交叉核對：檔案照 schema 寫，驗證程式就要收
function schemaCheck(s, v, path = '') {
  const errs = [];
  if ('const' in s && v !== s.const) errs.push(`${path} const`);
  if (s.type === 'object') {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${path} type`];
    for (const k of s.required ?? []) if (!(k in v)) errs.push(`${path}.${k} required`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v) errs.push(...schemaCheck(sub, v[k], `${path}.${k}`));
  }
  if (s.type === 'string') {
    if (typeof v !== 'string') return [`${path} type`];
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errs.push(`${path} pattern`);
    if (s.minLength != null && [...v].length < s.minLength) errs.push(`${path} minLength`);
    if (s.maxLength != null && [...v].length > s.maxLength) errs.push(`${path} maxLength`);
  }
  if (s.type === 'integer' && !Number.isInteger(v)) errs.push(`${path} type`);
  if (s.type === 'number' && typeof v !== 'number') errs.push(`${path} type`);
  if (s.minimum != null && typeof v === 'number' && v < s.minimum) errs.push(`${path} minimum`);
  return errs;
}

// 每種格式的超出範圍案例：[輸入, 夾完的值]
const OUT_OF_RANGE = {
  filter: {
    in: { exposure: 150, contrast: -120, saturation: 33.6, grain: -5 },
    out: { exposure: 100, contrast: -100, saturation: 34, grain: 0 },
  },
  beauty: { in: { smooth: 150, whiten: -20, slim: 33.6, eye: 100 }, out: { smooth: 100, whiten: 0, slim: 34, eye: 100 } },
};

for (const kind of KINDS) {
  const L = kind.label;
  const schema = JSON.parse(read(`../app/${kind.dir}/schema.json`));
  const VALID = clone(schema.examples[0]);
  const other = KINDS.find((k) => k !== kind);

  // ---- 0. schema.json ----
  section(`${L}：schema.json`);
  ok(
    schema.$schema?.includes('2020-12') && schema.properties.format.const === kind.format,
    `schema.json 存在，format 固定為 "${kind.format}"`,
  );
  ok(
    JSON.stringify(Object.keys(schema.properties.params.properties)) === JSON.stringify(kind.keys),
    `schema 的 params 與程式一致（${kind.keys.join('、')}）`,
  );
  ok(
    schema.additionalProperties === undefined && schema.properties.params.additionalProperties === undefined,
    'schema 不禁止多餘欄位（留空間給新參數）',
  );
  for (const k of schema.required) {
    const d = clone(VALID);
    delete d[k];
    ok(
      !validatePreset(kind, d).ok && fields(validatePreset(kind, d)).includes(k),
      `schema 必填的 ${k}：缺了驗證程式也會擋，並指出欄位 ${k}`,
    );
  }

  // ---- 1. 合法 ----
  section(`${L}：合法`);
  let r = validatePreset(kind, VALID);
  ok(r.ok && r.warnings.length === 0 && r.kind === kind, 'schema 的範例檔驗證通過、沒有警告');
  ok(schemaCheck(schema, VALID).length === 0, '範例檔也符合 schema.json');
  ok(
    r.preset.name === VALID.name &&
      r.preset.author === VALID.author &&
      r.preset.desc === VALID.description &&
      r.preset.license === VALID.license,
    '名稱、作者、說明、授權都讀對',
  );
  ok(
    kind.keys.every((k) => r.preset.params[k] === VALID.params[k]),
    `${kind.keys.length} 個參數都讀對`,
  );
  const builtin = await loadBuiltinPresets(kind, (name) => read(`../app/${kind.dir}/${name}`));
  ok(
    builtin.errors.length === 0 && builtin.presets.length === 6,
    `內建 6 個${L}檔全部通過（${builtin.presets.map((p) => p.name).join('、')}）`,
  );
  const index = JSON.parse(read(`../app/${kind.dir}/index.json`));
  ok(
    index.presets.every((f) => schemaCheck(schema, JSON.parse(read(`../app/${kind.dir}/${f}`))).length === 0),
    `內建 6 個${L}檔都符合 schema.json`,
  );
  ok(
    index.presets.every((f) => f === `${JSON.parse(read(`../app/${kind.dir}/${f}`)).id}${kind.ext}`),
    `內建檔名都是 <id>${kind.ext}`,
  );
  const back = parsePresetText(presetFileText(kind, r.preset));
  ok(
    back.ok && back.kind === kind && JSON.stringify(toPresetFile(kind, back.preset)) === JSON.stringify(toPresetFile(kind, r.preset)),
    '匯出再匯入，內容與分類都不變（來回一致）',
  );
  ok(presetFileName(kind, r.preset) === `${VALID.id}${kind.ext}`, `匯出的檔名是 <id>${kind.ext}`);
  ok(parsePresetText('﻿' + JSON.stringify(VALID)).ok, '開頭有 BOM 的檔案（Windows 記事本存的）也能讀');

  // ---- 2. 缺欄位 ----
  section(`${L}：缺欄位`);
  r = validatePreset(kind, { format: kind.format, version: 1, id: 'minimal', name: '最少', params: {} });
  ok(r.ok && r.preset.author === '' && r.preset.desc === '' && r.preset.license === '', '只有必填欄位也合法；作者、說明、授權當成空字串');
  ok(r.ok && kind.keys.every((k) => r.preset.params[k] === 0), 'params 是空物件 → 每個參數都是 0（不作用）');
  const first = kind.keys[0];
  r = validatePreset(kind, { ...clone(VALID), params: { [first]: 40 } });
  ok(
    r.ok && r.preset.params[first] === 40 && kind.keys.slice(1).every((k) => r.preset.params[k] === 0),
    `只給 ${first} → 其餘缺的參數用 0`,
  );
  r = validatePreset(kind, { name: '只有名字' });
  ok(!r.ok && ['format', 'version', 'id', 'params'].every((f) => fields(r).includes(f)), `一次列出所有缺的欄位：${fields(r).join('、')}`);
  r = parsePresetText(JSON.stringify({ ...clone(VALID), format: undefined }));
  ok(!r.ok && fields(r).includes('format'), '匯入時沒有 format → 擋下，指出 format（不猜是哪一種）');
  r = validatePreset(kind, { ...clone(VALID), name: '   ' });
  ok(!r.ok && fields(r).includes('name'), '名稱只有空白 → 擋下，指出 name');
  ok(
    !parsePresetText(`{"format": "${kind.format}",`).ok && fields(parsePresetText('{')).includes('(整個檔案)'),
    '不是合法 JSON → 擋下，指出整個檔案',
  );
  ok(!validatePreset(kind, [VALID]).ok && !validatePreset(kind, null).ok && !parsePresetText('"x"').ok, '陣列、null、字串都不是預設檔');

  // ---- 3. 超出範圍 ----
  section(`${L}：超出範圍`);
  const oor = OUT_OF_RANGE[kind.kind];
  r = validatePreset(kind, { ...clone(VALID), params: oor.in });
  ok(
    r.ok && Object.entries(oor.out).every(([k, x]) => r.preset.params[k] === x),
    `${Object.entries(oor.in)
      .map(([k, x]) => `${k} ${x} → ${oor.out[k]}`)
      .join('、')}（夾到範圍內的整數）`,
  );
  ok(
    r.warnings.map((x) => x.field).join() ===
      Object.keys(oor.in)
        .filter((k) => oor.in[k] !== oor.out[k])
        .map((k) => `params.${k}`)
        .join(),
    `被調整的參數有警告：${r.warnings.map((x) => x.message).join('；')}`,
  );
  r = parsePresetText(JSON.stringify({ ...VALID, params: { ...VALID.params, [first]: 1 } }).replace(`"${first}":1`, `"${first}":1e400`));
  ok(!r.ok && fields(r).includes(`params.${first}`), `1e400（JSON 解析成 Infinity）→ 擋下，指出 params.${first}`);
  const bad = Object.fromEntries(kind.keys.slice(0, 4).map((k, i) => [k, ['50', null, true, [1]][i]]));
  r = validatePreset(kind, { ...clone(VALID), params: bad });
  ok(!r.ok && Object.keys(bad).every((k) => fields(r).includes(`params.${k}`)), '參數不是數字（"50"、null、true、[1]）→ 逐一指出欄位');
  ok(
    !validatePreset(kind, { ...clone(VALID), version: 0 }).ok && !validatePreset(kind, { ...clone(VALID), version: 1.5 }).ok,
    'version 0 或 1.5 → 擋下',
  );
  ok(
    !validatePreset(kind, { ...clone(VALID), name: '名'.repeat(21) }).ok &&
      validatePreset(kind, { ...clone(VALID), name: '名'.repeat(20) }).ok,
    '名稱 21 字擋下、20 字可以',
  );
  ok(
    !validatePreset(kind, { ...clone(VALID), id: 'Bad ID' }).ok &&
      !validatePreset(kind, { ...clone(VALID), id: '-x' }).ok &&
      !validatePreset(kind, { ...clone(VALID), id: 'a'.repeat(65) }).ok,
    'id 有大寫空白、開頭是連字號、超過 64 字 → 擋下',
  );
  ok(!parsePresetText(JSON.stringify({ ...VALID, description: 'x'.repeat(70000) })).ok, '檔案超過 64 KB → 擋下');

  // ---- 4. 多餘欄位 ----
  section(`${L}：多餘欄位`);
  const foreignKey = other.keys[0]; // 另一種預設的參數，放進來也只會被忽略
  const extra = parsePresetText(
    JSON.stringify({
      ...VALID,
      version: 2,
      script: 'https://evil.example/x.js',
      onload: 'alert(1)',
      thumbnail: 'https://evil.example/track.png',
      params: { ...VALID.params, lipstick: 80, [foreignKey]: 50, constructor: 1 },
    }).replace(/^\{/, '{"__proto__":{"polluted":true},'),
  );
  ok(
    extra.ok && extra.kind === kind,
    `有不認得的欄位（script、onload、thumbnail、params.lipstick、params.${foreignKey}、__proto__）仍然可以匯入`,
  );
  ok(
    JSON.stringify(Object.keys(extra.preset).sort()) === JSON.stringify(['author', 'desc', 'id', 'license', 'name', 'params']) &&
      JSON.stringify(Object.keys(extra.preset.params)) === JSON.stringify(kind.keys),
    `讀出來的預設只有認得的欄位，params 只有 ${kind.keys.join('、')}`,
  );
  ok(!(foreignKey in extra.preset.params), `${L}檔裡放${other.label}的參數（${foreignKey}）會被忽略，不會跨分頁作用`);
  ok(
    !('script' in extra.preset) && !('thumbnail' in extra.preset) && !('lipstick' in extra.preset.params),
    '檔案裡的網址欄位不會被帶進 app',
  );
  ok({}.polluted === undefined && Object.getPrototypeOf(extra.preset) === Object.prototype, '__proto__ 鍵沒有污染物件原型');
  ok(
    extra.warnings.some((x) => x.field === 'version'),
    'version 2（比 app 新）→ 可以讀，但給警告',
  );
  ok(!('script' in toPresetFile(kind, extra.preset)), '再匯出時多餘欄位不會被寫回去');

  // ---- 5. 惡意文字 ----
  section(`${L}：惡意文字`);
  let alerted = false;
  globalThis.alert = () => {
    alerted = true;
  };
  const evil = {
    ...VALID,
    name: '<script>alert(1)</script>',
    author: '<img src=x onerror=alert(1)>',
    description: '"><svg onload=alert(1)>',
    license: 'javascript:alert(1)',
  };
  r = parsePresetText(JSON.stringify(evil));
  ok(!r.ok && fields(r).includes('name'), '名稱 <script>alert(1)</script> 有 25 字，超過 20 字上限 → 擋下');
  r = parsePresetText(JSON.stringify({ ...evil, name: '<script>x()</script>' }));
  ok(
    r.ok && r.preset.name === '<script>x()</script>' && r.preset.author === evil.author && r.preset.desc === evil.description,
    '20 字內的 HTML 原樣保留成純文字（不轉義也不刪，交給 textContent 顯示）',
  );
  ok(r.ok && r.preset.license === 'javascript:alert(1)', 'javascript: 字樣只是一段文字，app 不會把任何欄位當網址打開');
  ok(!alerted, '解析過程沒有執行檔案裡的任何程式（alert 沒被呼叫）');
  r = validatePreset(kind, { ...clone(VALID), name: '‮柔光\u0000\u0007', author: '⁦小明⁩' });
  ok(r.ok && r.preset.name === '柔光' && r.preset.author === '小明', '控制字元與雙向覆寫字元（U+202E 等）會被去掉，名稱不會被反轉顯示');
}

// ---- 6. 匯入時自動分類 ----
section('匯入時依 format 自動分類');
const fEx = clone(JSON.parse(read('../app/filters/schema.json')).examples[0]);
const bEx = clone(JSON.parse(read('../app/beauty/schema.json')).examples[0]);
let r = parsePresetText(JSON.stringify(fEx));
ok(r.ok && r.kind === FILTER, '"xixi-filter" → 濾鏡分頁');
r = parsePresetText(JSON.stringify(bEx));
ok(r.ok && r.kind === BEAUTY, '"xixi-beauty" → 美顏分頁');
r = parsePresetText(JSON.stringify(bEx), FILTER);
ok(!r.ok && fields(r).includes('format') && /美顏檔/.test(r.errors[0].message), '指定要濾鏡卻給美顏檔 → 擋下，說明這是美顏檔');
r = parsePresetText(JSON.stringify({ ...fEx, format: 'beauty-cam-filter' }));
ok(!r.ok && fields(r).includes('format'), '舊的 0.1.0 開發版格式 "beauty-cam-filter" → 擋下，指出 format');
ok(FILTER.ext !== BEAUTY.ext && FILTER.format !== BEAUTY.format, `兩種檔案的副檔名與 format 都不同（${FILTER.ext}、${BEAUTY.ext}）`);

// ---- 7. 程式碼靜態檢查：預設檔只當資料 ----
section('程式碼只把檔案當資料');
const src = Object.fromEntries(['app.js', 'presets.js', 'look.js'].map((f) => [f, read(`../app/${f}`)]));
const code = Object.values(src).join('\n');
const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 註解裡寫「不用 eval」不算
ok(
  !/\beval\s*\(|new\s+Function\b|\bimport\s*\(|setTimeout\s*\(\s*['"`]|document\.write/.test(noComments),
  'app.js、presets.js、look.js 沒有 eval、new Function、動態 import、字串 setTimeout、document.write',
);
const htmlSinks = code.split('\n').filter((l) => /innerHTML|outerHTML|insertAdjacentHTML/.test(l));
ok(htmlSinks.length === 1 && /人物 \$\{t\.id\}/.test(htmlSinks[0]), '只有 1 處用到 innerHTML（人物編號標籤），不含預設檔的文字');
ok(
  /name\.textContent = p\.name/.test(src['app.js']) && /desc\.textContent = p\.desc/.test(src['app.js']),
  '預設列的名稱與說明用 textContent 顯示',
);
ok(
  (src['app.js'].match(/fetch\(/g) || []).length === 1 &&
    /fetch\(new URL\(`\$\{kind\.dir\}\/\$\{name\}`, import\.meta\.url\)\)/.test(src['app.js']) &&
    FILTER.dir === 'filters' &&
    BEAUTY.dir === 'beauty',
  'app.js 只有一處 fetch，只讀 filters/ 與 beauty/ 底下的內建檔',
);
ok(
  /JSON\.parse/.test(src['presets.js']) && !/\.\.\.data\b|Object\.assign\(/.test(src['presets.js']),
  'presets.js 用 JSON.parse 解析，逐欄挑選，不把檔案物件整個展開',
);

// 內建清單不接受網址或路徑，也不接受另一種的副檔名
for (const kind of KINDS) {
  const asked = [];
  const okFile = `ok${kind.ext}`;
  const ex = clone(JSON.parse(read(`../app/${kind.dir}/schema.json`)).examples[0]);
  const fakeFiles = {
    'index.json': JSON.stringify({
      format: kind.indexFormat,
      version: 1,
      default: 'ok',
      presets: [
        `https://evil.example/a${kind.ext}`,
        `../secret${kind.ext}`,
        `sub/x${kind.ext}`,
        `x${KINDS.find((k) => k !== kind).ext}`,
        okFile,
      ],
    }),
    [okFile]: JSON.stringify({ ...ex, id: 'ok' }),
  };
  const loaded = await loadBuiltinPresets(kind, async (n) => {
    asked.push(n);
    if (!(n in fakeFiles)) throw new Error('not found');
    return fakeFiles[n];
  });
  ok(
    JSON.stringify(asked) === JSON.stringify(['index.json', okFile]),
    `${kind.label}清單裡的網址、路徑與另一種副檔名根本不會去讀，只讀了 ${asked.join('、')}`,
  );
  ok(loaded.presets.length === 1 && loaded.errors.length === 4, `${kind.label}清單壞掉的項目略過並回報，其餘照常載入`);
}

// ---- 8. 自訂預設的存取與 id ----
section('自訂預設');
const mem = new Map();
const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
const mineF = { ...validatePreset(FILTER, fEx).preset, custom: true };
const mineB = { ...validatePreset(BEAUTY, bEx).preset, custom: true };
ok(
  saveCustomPresets(FILTER, storage, [mineF]) && saveCustomPresets(BEAUTY, storage, [mineB, mineB]),
  '自訂濾鏡與自訂美顏分開寫進 localStorage',
);
ok(
  loadCustomPresets(FILTER, storage).length === 1 && loadCustomPresets(BEAUTY, storage).length === 2,
  '讀回來各自的數量正確，不會混在一起',
);
ok(
  JSON.parse(mem.get(FILTER.storageKey))[0].format === 'xixi-filter' && JSON.parse(mem.get(BEAUTY.storageKey))[0].format === 'xixi-beauty',
  'localStorage 存的也是各自的檔案格式',
);
ok(loadCustomPresets(FILTER, storage)[0].custom === true, '讀回來的標記為自訂');
mem.set(BEAUTY.storageKey, JSON.stringify([{ ...bEx, id: 'Bad ID' }, bEx, fEx]));
ok(loadCustomPresets(BEAUTY, storage).length === 1, 'localStorage 被改壞的那一筆、格式不對的那一筆都會被略過');
mem.set(FILTER.storageKey, '{not json');
ok(loadCustomPresets(FILTER, storage).length === 0, 'localStorage 內容不是 JSON → 當成沒有自訂濾鏡');
const broken = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceeded');
  },
};
ok(
  loadCustomPresets(FILTER, broken).length === 0 &&
    saveCustomPresets(BEAUTY, broken, [mineB]) === false &&
    loadCustomPresets(BEAUTY, null).length === 0,
  'storage 丟例外或不存在 → 不會讓頁面壞掉，存檔回報失敗',
);
ok(uniqueId('glam', ['glam', 'glam-2']) === 'glam-3' && uniqueId('new', ['glam']) === 'new', '匯入時 id 撞名自動加尾碼（glam → glam-3）');
ok(uniqueId('a'.repeat(64), ['a'.repeat(64)]).length === 64, '加尾碼後 id 仍在 64 字內');
const nid = newCustomId([], 1700000000000);
ok(/^my-[a-z0-9]+$/.test(nid) && validatePreset(FILTER, { ...fEx, id: nid }).ok, `自訂預設的 id 用時間戳記產生（${nid}），符合格式`);

console.log(`\n${fail === 0 ? '全部通過' : '有失敗'}：${pass} 通過、${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
