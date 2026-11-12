// SPDX-License-Identifier: Apache-2.0
// 預覽版面的 node 檢查（不需要瀏覽器或鏡頭）：node tests/layout.test.mjs
// 鎖住 0.2.1 的修正：手機直拿時預覽、照片、濾鏡縮圖都是直式並填滿畫面；橫拿與桌機維持 0.2.0 的 contain。
import { readFileSync } from 'node:fs';
import { camRequest, centerCrop, frameFit, isPortrait, simSize, visibleRect } from '../app/layout.js';

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
const BASE = { w: 1280, h: 720 };
const PIXEL7 = { w: 412, h: 915 }; // Chrome DevTools 的 Pixel 7 直式
const PIXEL7_LAND = { w: 915, h: 412 };
const DESKTOP = { w: 1440, h: 900 };

section('直式時要求直式畫面');
ok(isPortrait(PIXEL7.w, PIXEL7.h) && !isPortrait(PIXEL7_LAND.w, PIXEL7_LAND.h), '高 > 寬才算直式');
{
  const s = simSize(BASE, PIXEL7.w, PIXEL7.h);
  ok(s.w === 720 && s.h === 1280, `直式視窗的模擬鏡頭畫布是直式 720×1280（實際 ${s.w}×${s.h}）`);
  const l = simSize(BASE, DESKTOP.w, DESKTOP.h);
  ok(l.w === 1280 && l.h === 720, '橫式視窗的模擬鏡頭畫布維持 1280×720');
}
// 鏡頭不管給直式（正常轉向）還是橫式（0.2.0 在 Android 實機遇到的情況），直式視窗的預覽、照片都要是直式且填滿
for (const [name, sw, sh] of [
  ['鏡頭給直式 720×1280', 720, 1280],
  ['鏡頭給橫式 1280×720', 1280, 720],
  ['鏡頭給 4:3 橫式 640×480', 640, 480],
]) {
  const f = frameFit(sw, sh, PIXEL7.w, PIXEL7.h);
  ok(f.cover && f.width >= PIXEL7.w && f.height >= PIXEL7.h, `${name}：預覽填滿整個畫面、沒有黑邊（${f.width}×${f.height}）`);
  const r = visibleRect(sw, sh, PIXEL7.w, PIXEL7.h);
  ok(r.h > r.w, `${name}：照片是直式（${r.w}×${r.h}）`);
  ok(Math.abs(r.w / r.h - PIXEL7.w / PIXEL7.h) < 0.01, `${name}：照片比例和畫面一致（${(r.w / r.h).toFixed(3)}）`);
  ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= sw && r.y + r.h <= sh, `${name}：照片範圍在影像內`);
  const t = centerCrop(r, 72 / 96);
  ok(t.h > t.w && t.w <= r.w + 1e-9 && t.h <= r.h + 1e-9, `${name}：濾鏡縮圖取直式範圍`);
}
{
  const c = camRequest(BASE);
  ok(c.w === 1280 && c.h === 720, '向鏡頭要畫面不依方向對調寬高（直式由瀏覽器轉向；對調後 Android Chrome 反而回傳橫式）');
  const c2 = camRequest({ w: 720, h: 1280 });
  ok(c2.w === 1280 && c2.h === 720, '基準尺寸寫成直式也一律換成橫式去要');
}

section('橫拿與桌機維持 0.2.0 的 contain');
for (const [name, v] of [
  ['手機橫拿 915×412', PIXEL7_LAND],
  ['桌機 1440×900', DESKTOP],
]) {
  const f = frameFit(1280, 720, v.w, v.h);
  const k = Math.min(v.w / 1280, v.h / 720);
  ok(
    !f.cover && f.width === Math.round(1280 * k) && f.height === Math.round(720 * k),
    `${name}：#frame 尺寸和 0.2.0 相同（${f.width}×${f.height}）`,
  );
  const r = visibleRect(1280, 720, v.w, v.h);
  ok(r.x === 0 && r.y === 0 && r.w === 1280 && r.h === 720, `${name}：照片是整張畫布 1280×720`);
}

section('app.js 有用上');
const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
ok(/from '\.\/layout\.js'/.test(app), 'app.js 引用 layout.js');
ok(/frameFit\(src\.width, src\.height, innerWidth, innerHeight\)/.test(app), 'fitFrame 用 frameFit 算 #frame');
ok(/function shotCanvas\(\)[\s\S]*?visibleRect\(/.test(app), '拍照只取 visibleRect 的範圍');
ok(/visibleRect\(src\.width, src\.height, innerWidth, innerHeight\)/.test(app), '縮圖取看得到的範圍');
ok(!/innerHeight > innerWidth[^\n]*\{ w: h, h: w \}/.test(app) && !/\{ w: h, h: w \}/.test(app), '不再對調寬高去要鏡頭');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
