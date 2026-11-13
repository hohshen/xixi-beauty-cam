// SPDX-License-Identifier: Apache-2.0
// 0.3.1 的介面行為（不需要瀏覽器）：node tests/ui.test.mjs
// 檢查：第一次開是「風格」分頁、一鍵回原圖（濾鏡與美顏都是 none、風格不再打勾）、
// 版本號與 package.json／sw.js 一致、新版 service worker 接手時的判斷（第一次安裝不算、只通知一次、不自己 reload）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FILTER, BEAUTY, STYLE, loadBuiltinPresets, isIdentity } from '../app/presets.js';
import { Look, applyStyle, styleActive, resetToOriginal, initialTab, DEFAULT_TAB } from '../app/look.js';
import { APP_VERSION, versionLabel, watchServiceWorker } from '../app/version.js';

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

const filters = await loadBuiltinPresets(FILTER, (name) => read(`../app/filters/${name}`));
const beauty = await loadBuiltinPresets(BEAUTY, (name) => read(`../app/beauty/${name}`));
const styles = await loadBuiltinPresets(STYLE, (name) => read(`../app/styles/${name}`));
const html = read('../app/index.html');
const app = read('../app/app.js');
const sw = read('../app/sw.js');
const pkg = JSON.parse(read('../package.json'));
const lock = JSON.parse(read('../package-lock.json'));

// ---- 1. 預設分頁 ----
section('第一次開是「風格」分頁');
ok(DEFAULT_TAB === 'style', 'DEFAULT_TAB 是 style');
ok(
  initialTab(null) === 'style' && initialTab(undefined) === 'style' && initialTab('') === 'style',
  '沒記過分頁（第一次開、私密視窗）→ 風格',
);
ok(initialTab('garbage') === 'style', '記到不認得的值 → 風格');
ok(initialTab('filter') === 'filter' && initialTab('beauty') === 'beauty' && initialTab('style') === 'style', '記過分頁就回到上次的分頁');
ok(/setTab\(initialTab\(saved\)\)/.test(app), 'app.js 啟動時用 initialTab 決定分頁');
ok(
  /id="tab-style"[^>]*aria-selected="true"/.test(html) &&
    /id="tab-filter"[^>]*aria-selected="false"/.test(html) &&
    /id="tab-beauty"[^>]*aria-selected="false"/.test(html),
  'index.html 靜態狀態：風格分頁選中（程式載入前看到的也是風格）',
);
ok(
  /<section id="panel-style"[^>]*data-kind="style">/.test(html) &&
    /<section id="panel-filter"[^>]*hidden>/.test(html) &&
    /<section id="panel-beauty"[^>]*hidden>/.test(html),
  'index.html 靜態狀態：只有風格面板顯示',
);
{
  // 預設套用的濾鏡與美顏不變
  const f = new Look(FILTER, filters.presets, filters.defaultId);
  const b = new Look(BEAUTY, beauty.presets, beauty.defaultId);
  ok(f.preset.id === 'none' && b.preset.id === 'natural', `預設套用不變：濾鏡 ${f.preset.id}、美顏 ${b.preset.id}`);
}

// ---- 2. 一鍵回原圖 ----
section('一鍵回原圖');
for (const s of styles.presets) {
  const pair = { filter: new Look(FILTER, filters.presets, filters.defaultId), beauty: new Look(BEAUTY, beauty.presets, beauty.defaultId) };
  applyStyle(s, pair);
  pair.filter.setStrength(60).tune(pair.filter.kind.keys[0], 37);
  pair.beauty.setStrength(40);
  ok(styleActive(s, pair), `套用風格「${s.name}」後打勾`);
  resetToOriginal(pair);
  ok(
    pair.filter.preset.id === 'none' && pair.beauty.preset.id === 'none',
    `回原圖後濾鏡 ${pair.filter.preset.id}、美顏 ${pair.beauty.preset.id}`,
  );
  ok(
    pair.filter.identity &&
      pair.beauty.identity &&
      !pair.filter.tuned &&
      Object.values(pair.filter.params()).every((v) => v === 0) &&
      Object.values(pair.beauty.params()).every((v) => v === 0),
    '回原圖後兩個分頁的參數全是 0、微調清掉',
  );
  ok(
    styles.presets.every((x) => !styleActive(x, pair)),
    '回原圖後沒有任何風格打勾',
  );
}
{
  // 清單裡沒有 none：找全 0 的；連全 0 都沒有就強度 0
  const noNone = filters.presets.filter((p) => p.id !== 'none');
  const l = new Look(FILTER, noNone, 'film');
  resetToOriginal({ filter: l });
  ok(l.identity, `清單沒有 none 時仍回到不作用（${l.preset.id}、強度 ${l.strength}%）`);
  ok(isIdentity(FILTER, filters.presets.find((p) => p.id === 'none').params), '內建濾鏡 none 是全 0');
}
const resetFn = app.slice(app.indexOf('function resetOriginal'), app.indexOf('function buildStyleControls'));
ok(
  /resetToOriginal\(lookPair\(\)\)/.test(resetFn) &&
    /tabs\.style\.selectedId = null/.test(resetFn) &&
    /for \(const t of TAB_LIST\)[\s\S]*?syncLook\(t\)/.test(resetFn) &&
    !/tracker/.test(resetFn),
  'app.js 回原圖：兩個分頁回 none、清掉風格選擇、同步畫面，不碰逐人美顏開關',
);
const shutterRow = html.match(/<div id="shutterRow">[\s\S]*?<\/div>/)?.[0] ?? '';
ok(/id="resetBtn"/.test(shutterRow), '「原圖」按鈕在快門列（不在任何分頁面板裡，三個分頁都看得到）');
ok(!/<section[^>]*>(?:(?!<\/section>)[\s\S])*id="resetBtn"/.test(html), '「原圖」按鈕不在分頁面板裡');
ok(/\$\('resetBtn'\)\.addEventListener\('click', resetOriginal\)/.test(app), 'app.js 綁定「原圖」按鈕');

// ---- 3. 版本號 ----
section('版本號');
const cacheVersion = sw.match(/const CACHE_VERSION = '([^']+)'/)?.[1] ?? '';
ok(APP_VERSION === pkg.version, `version.js 的 APP_VERSION（${APP_VERSION}）= package.json（${pkg.version}）`);
ok(lock.version === pkg.version && lock.packages[''].version === pkg.version, `package-lock.json 的版本（${lock.version}）= package.json`);
ok(cacheVersion.startsWith(`xixi-beauty-cam-${APP_VERSION}-`), `sw.js 的 CACHE_VERSION（${cacheVersion}）對應 ${APP_VERSION}`);
ok(versionLabel() === `v${pkg.version}`, `畫面顯示「${versionLabel()}」`);
ok(
  /<span id="version"><\/span>/.test(html) && /\$\('version'\)\.textContent = versionLabel\(\)/.test(app),
  '版本號由 version.js 寫進 #version，頁面不寫死',
);
ok(/'version\.js',/.test(sw), 'version.js 在 service worker 的快取清單裡');

// ---- 4. 新版接手 ----
section('新版 service worker 接手');
function fakeContainer(controller) {
  const listeners = [];
  return {
    controller,
    addEventListener: (type, fn) => type === 'controllerchange' && listeners.push(fn),
    fire() {
      listeners.forEach((fn) => fn());
    },
  };
}
{
  const c = fakeContainer(null);
  const calls = { first: 0, update: 0 };
  watchServiceWorker(c, { onFirstInstall: () => calls.first++, onUpdate: () => calls.update++ });
  c.fire();
  ok(calls.first === 1 && calls.update === 0, '第一次安裝（原本沒有 controller）：不算新版、不提示更新');
  c.fire();
  ok(calls.update === 1, '同一頁之後真的有新版接手：提示一次');
  c.fire();
  ok(calls.update === 1, '再接手也只提示一次');
}
{
  const c = fakeContainer({});
  const calls = { first: 0, update: 0 };
  watchServiceWorker(c, { onFirstInstall: () => calls.first++, onUpdate: () => calls.update++ });
  c.fire();
  c.fire();
  ok(calls.first === 0 && calls.update === 1, '原本就有 controller：新版接手時提示一次，不重複');
}
ok(
  !/reload/.test(
    read('../app/version.js')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, ''),
  ),
  'version.js 不會自己重新載入',
);
const reloads = [...app.matchAll(/location\.reload\(\)/g)].length;
ok(
  reloads === 1 && /\$\('updateBtn'\)\.addEventListener\('click', \(\) => location\.reload\(\)\)/.test(app),
  'app.js 只在使用者點「有新版，點此更新」時重新載入（不會無限重新載入）',
);
ok(/<button id="updateBtn"[^>]*hidden>有新版，點此更新<\/button>/.test(html), '「有新版，點此更新」預設隱藏');

console.log(`\n${fail === 0 ? '全部通過' : '有失敗'}：${pass} 通過、${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
