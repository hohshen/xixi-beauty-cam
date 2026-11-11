// SPDX-License-Identifier: Apache-2.0
// PWA、離線、隱私與手機相容的 node 檢查（不需要瀏覽器、鏡頭或網路）：node tests/pwa.test.mjs
// 檢查：manifest 與圖示、service worker 的快取清單與 app/ 裡的檔案一致、快取版本、
// vendor 檔案的 SHA-256、頁面不引用其他網域、CSP（index.html 與 _headers 一致）、
// 手機相容的靜態結構（playsinline、安全區域、前後鏡頭、分享），以及自動降級的邏輯。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { AutoQuality, QUALITY_LEVELS, MAX_LEVEL } from '../app/quality.js';
import { FRAG } from '../app/renderer.js';

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
const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(path(p), 'utf8');
const APP = path('../app/');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [relative(APP, full).split(sep).join('/')];
  });
}
const files = walk(APP);
const html = read('../app/index.html');
const app = read('../app/app.js');
const sw = read('../app/sw.js');
const css = read('../app/style.css');
const headers = read('../app/_headers');
const pkg = JSON.parse(read('../package.json'));

// ---- manifest 與圖示 ----
section('manifest 與圖示');
const manifest = JSON.parse(read('../app/manifest.webmanifest'));
ok(/<link rel="manifest" href="manifest\.webmanifest"/.test(html), 'index.html 連到 manifest.webmanifest');
ok(manifest.display === 'standalone', 'display: standalone');
ok(manifest.orientation === 'portrait', 'orientation: portrait（直式優先）');
ok(manifest.start_url === './' && manifest.scope === './', 'start_url 與 scope 都是相對路徑，放在任何子路徑都能用');
ok(manifest.name && manifest.short_name && manifest.short_name.length <= 12, `有 name 與 short_name（「${manifest.short_name}」）`);
function pngSize(rel) {
  const b = readFileSync(join(APP, rel));
  return b.toString('ascii', 1, 4) === 'PNG' ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : null;
}
for (const icon of manifest.icons) {
  const exists = files.includes(icon.src);
  const size = icon.type === 'image/png' && exists ? pngSize(icon.src) : icon.sizes;
  ok(exists && size === icon.sizes, `圖示 ${icon.src}（${icon.sizes}、${icon.purpose}）存在且尺寸相符`);
}
ok(
  manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'),
  '有 192 與 512 的圖示（Chrome 安裝條件）',
);
ok(
  manifest.icons.some((i) => i.purpose === 'maskable'),
  '有 maskable 圖示（Android 自適應圖示）',
);
ok(
  /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/.test(html) && pngSize('icons/apple-touch-icon.png') === '180x180',
  'iOS apple-touch-icon 180×180',
);
ok(/apple-mobile-web-app-capable/.test(html) && /viewport-fit=cover/.test(html), 'iOS 主畫面全螢幕與 viewport-fit=cover');

// ---- service worker ----
section('service worker 與離線快取');
const precache = [...sw.matchAll(/^ {2}'([^']+)',$/gm)].map((m) => m[1]);
// 不需要快取的：sw.js 本身、主機設定、說明文件、只給驗證腳本用的 schema
const NOT_CACHED = (f) => f === 'sw.js' || f === '_headers' || f.endsWith('README.md') || f.endsWith('schema.json');
const shouldCache = files.filter((f) => !NOT_CACHED(f));
const missing = shouldCache.filter((f) => !precache.includes(f));
const extra = precache.filter((f) => f !== './' && !files.includes(f));
ok(missing.length === 0, `app/ 裡每個執行時會用到的檔案都在快取清單（漏了：${missing.join('、') || '無'}）`);
ok(extra.length === 0, `快取清單沒有不存在的檔案（多了：${extra.join('、') || '無'}）`);
ok(precache.includes('./') && precache.includes('index.html'), '快取包含頁面本身（./ 與 index.html）');
const version = sw.match(/const CACHE_VERSION = '([^']+)'/)?.[1] ?? '';
ok(
  new RegExp(`^xixi-beauty-cam-${pkg.version.replace(/\./g, '\\.')}-\\d+$`).test(version),
  `CACHE_VERSION「${version}」是 xixi-beauty-cam-<package.json 版本>-<序號>`,
);
ok(
  /self\.skipWaiting\(\)/.test(sw) && /self\.clients\.claim\(\)/.test(sw),
  '安裝後立刻接手頁面（skipWaiting、clients.claim），按開啟鏡頭時 WASM 與模型直接讀快取',
);
ok(/url\.origin !== self\.location\.origin\) return/.test(sw), 'service worker 只處理同網域請求');
ok(/serviceWorker\.register\(new URL\('\.\/sw\.js', import\.meta\.url\)/.test(app), 'app.js 註冊 sw.js（相對路徑）');

// ---- vendor ----
section('MediaPipe 放在專案內（固定版本、雜湊）');
const VENDOR = {
  'vendor/mediapipe/tasks-vision@1.2.2/vision_bundle.mjs': 'b65acb59b370cd6561afd9d04c29ed7a87e7ed6386922ac1b263af1f1ad06b7d',
  'vendor/mediapipe/tasks-vision@1.2.2/wasm/vision_wasm_internal.js': 'f2b9c17131ea79716ec6bf07b117a087b2749a6f8a1e2f1f2e77a9382092db5b',
  'vendor/mediapipe/tasks-vision@1.2.2/wasm/vision_wasm_internal.wasm': 'f5bd25147ac89d506074293ce2675969b10e827180db95a0d9689c2ed80764ab',
  'vendor/mediapipe/models/face_landmarker/float16/1/face_landmarker.task':
    '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
};
const vendorReadme = read('../app/vendor/README.md');
for (const [rel, hash] of Object.entries(VENDOR)) {
  const buf = readFileSync(join(APP, rel));
  const got = createHash('sha256').update(buf).digest('hex');
  ok(got === hash && vendorReadme.includes(hash), `${rel}（${(buf.length / 1e6).toFixed(1)} MB）雜湊與 vendor/README.md 相符`);
  // Cloudflare Pages 單檔上限 25 MiB
  ok(buf.length < 25 * 1024 * 1024, `${rel.split('/').pop()} 小於 Cloudflare Pages 的單檔上限 25 MiB`);
}

// ---- 隱私：只連自己的網域 ----
section('隱私：執行時只連自己的網域');
// schema.json 只給驗證腳本用（$schema 是識別字串，不會被載入），不在執行時的檔案內
const own = shouldCache.filter((f) => /\.(js|html|css|json|webmanifest)$/.test(f) && !f.startsWith('vendor/'));
const urlHits = own.flatMap((f) => {
  // 只看程式碼，不看註解：去掉 // 與 /* */ 與 <!-- --> 之後再找網址
  const code = readFileSync(join(APP, f), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  return [...code.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => `${f}: ${m[0]}`);
});
ok(urlHits.length === 0, `app/ 自己的程式與資料不引用任何外部網址（${urlHits.join('、') || '無'}）`);
ok(!/jsdelivr|storage\.googleapis/.test(app), 'app.js 不再從 jsDelivr 或 Google Storage 載入');
ok(/from '\.\/vendor\/mediapipe\/tasks-vision@1\.2\.2\/vision_bundle\.mjs'/.test(app), 'MediaPipe 從 vendor/ 載入');
const metaCsp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';
const csp = Object.fromEntries(
  metaCsp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([k, ...v]) => [k, v]),
);
ok(csp['connect-src']?.join(' ') === "'self'", "CSP connect-src 只有 'self'（擋掉影像外傳，也擋掉 MediaPipe 內建的使用統計）");
ok(csp['default-src']?.join(' ') === "'self'", "CSP default-src 'self'");
ok(
  csp['script-src']?.includes("'wasm-unsafe-eval'") &&
    !csp['script-src']?.includes("'unsafe-eval'") &&
    !csp['script-src']?.includes("'unsafe-inline'"),
  'CSP script-src 允許 WASM 但不允許 eval 與行內程式',
);
const headerCsp = headers.match(/Content-Security-Policy: (.+)/)?.[1] ?? '';
ok(headerCsp === `${metaCsp}; frame-ancestors 'none'`, '_headers 的 CSP 與 index.html 相同（另加只能用標頭設定的 frame-ancestors）');
ok(
  !/<script(?![^>]*\bsrc=)[^>]*>/.test(html) && !/\sstyle="/.test(html) && !/\son[a-z]+="/.test(html),
  'index.html 沒有行內 script、style 屬性與事件屬性（CSP 會擋）',
);
ok(!/innerHTML\s*=\s*`[^`]*style=/.test(app), 'app.js 不用 innerHTML 寫 style 屬性');

// ---- 手機相容（靜態結構） ----
section('手機相容');
ok(/<video id="cam" playsinline muted autoplay>/.test(html), '<video> 有 playsinline、muted、autoplay（iOS 不跳全螢幕）');
ok(!/#cam\s*\{\s*display:\s*none/.test(css), '鏡頭的 <video> 不用 display: none（iOS 可能不更新影格）');
ok(/facingMode: \{ ideal: facing \}/.test(app) && /id="flip"/.test(html), '前後鏡頭切換（facingMode ideal，按鈕在快門旁）');
ok(/stopCamera\(\);\s*const s = await navigator\.mediaDevices\.getUserMedia/.test(app), '換鏡頭前先關掉舊的（iOS 同時只能開一個鏡頭）');
ok(/const left = mirror \?/.test(app) && /mirror,\n/.test(app), '後鏡頭不鏡像：畫面、標籤與縮圖都依 mirror');
ok(
  /env\(safe-area-inset-top/.test(css) && /--safe-l/.test(css) && /--safe-r/.test(css) && /var\(--safe-b\)/.test(css),
  '安全區域（瀏海、Home 指示條、橫式兩側）',
);
ok(/@media \(orientation: landscape\) and \(max-height: 520px\)/.test(css), '手機橫式改用右側操作欄');
ok(/screen\.orientation\?\.addEventListener\?\.\('change'/.test(app), '轉向時重新計算畫面大小');
ok(/touch-action: manipulation/.test(css) && /overscroll-behavior: none/.test(css), '觸控：不雙擊縮放、不下拉重新整理');
ok(
  /navigator\.share\(\{ files: \[file\] \}\)/.test(app) && /navigator\.canShare/.test(app),
  '拍照：觸控裝置用 Web Share API 分享檔案（iOS 可存進相簿）',
);
ok(/downloadBlob\(blob, name\)/.test(app), '不能分享時改成下載');
ok(
  /id="shotShare"/.test(html) && /\$\('shotShare'\)\.addEventListener\('click'/.test(app),
  '分享在使用者點按鈕時才呼叫（Safari 需要使用者手勢）',
);
ok(/visibilitychange/.test(app), '切到背景再回來時恢復鏡頭');

// ---- 自動降級 ----
section('自動降級（fps 長時間低於 24）');
ok(QUALITY_LEVELS[0].detectEvery === 1 && QUALITY_LEVELS[0].radius === 4, 'L0 與原本相同：每幀偵測、雙邊濾波 9×9');
ok(
  QUALITY_LEVELS.every(
    (q, i) => i === 0 || (q.detectEvery >= QUALITY_LEVELS[i - 1].detectEvery && q.radius <= QUALITY_LEVELS[i - 1].radius),
  ),
  '等級越高，偵測頻率與取樣數只會減少',
);
let q = new AutoQuality();
q.update(20);
q.update(20);
ok(q.level === 0, '低於 24 fps 2 秒：還不降級');
ok(q.update(20) && q.level === 1, '連續 3 秒低於 24 fps：降一級');
q.update(25);
q.update(20);
q.update(20);
ok(q.level === 1, '中間有一秒恢復就重新計時');
for (let i = 0; i < 30; i++) q.update(10);
ok(q.level === MAX_LEVEL, `一直很慢就降到最低 L${MAX_LEVEL}，不會超過`);
for (let i = 0; i < 14; i++) q.update(30);
ok(q.level === MAX_LEVEL, '有餘裕 14 秒：還不升級（升級比降級慢，避免來回跳）');
q.update(30);
ok(q.level === MAX_LEVEL - 1, '連續 15 秒 ≥ 28 fps：升一級');
q = new AutoQuality({ fixed: '2' });
for (let i = 0; i < 10; i++) q.update(5);
ok(q.level === 2 && !q.auto, '?quality=2 固定等級時不自動調整');
q.setFixed('auto');
ok(q.auto && q.level === 2, '改回自動時從目前等級繼續');
q.reset();
ok(q.level === 0, '換來源時自動模式回到 L0');
q = new AutoQuality({ fixed: 3 });
const detected = [0, 1, 2, 3, 4, 5].filter((n) => q.shouldDetect(n));
ok(detected.join(',') === '0,2,4', 'L3 隔幀偵測（第 0、2、4 幀）');
ok(new AutoQuality({ fixed: 99 }).level === MAX_LEVEL && new AutoQuality({ fixed: -1 }).level === 0, '固定等級超出範圍時夾在 0..最高');
ok(/uniform int uRadius;/.test(FRAG) && /for \(int j = -uRadius; j <= uRadius; j\+\+\)/.test(FRAG), 'shader 的雙邊濾波半徑由 uRadius 控制');
ok(/radius: quality\.current\.radius/.test(app) && /quality\.shouldDetect\(frameNo\)/.test(app), 'app.js 每幀依等級決定偵測與取樣數');
ok(/畫質 \$\{quality\.current\.label\}/.test(app), 'fps 面板顯示目前等級');

console.log(`\n${fail === 0 ? '全部通過' : '有失敗'}：${pass} 通過、${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
