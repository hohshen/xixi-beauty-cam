// SPDX-License-Identifier: Apache-2.0
// 預覽版面的純計算（不碰 DOM，tests/layout.test.mjs 用 node 直接測）。
//
// 規則：
// - 直式視窗（高 > 寬，手機直拿）：#frame 以 cover 填滿整個畫面（多出來的部分裁掉），
//   照片、濾鏡縮圖都只取畫面上看得到的範圍，所以三者都是直式、方向一致。
// - 橫式視窗（手機橫拿、桌機）：維持 0.2.0 的 contain（整張放得進視窗、不裁切）。
// - 向鏡頭要畫面一律用鏡頭感光元件的橫式尺寸（例如 1280×720），由瀏覽器依手機方向轉成直式。
//   0.2.0 在直式時把寬高對調成 720×1280 去要，Android Chrome 反而回傳橫式畫面（實機截圖，2026-11-12）。
//   不管鏡頭最後給直的還是橫的，cover 都保證直式預覽填滿畫面。

export const isPortrait = (viewW, viewH) => viewH > viewW;

// 向鏡頭要的解析度：一律用橫式基準尺寸，不依視窗方向對調（理由見檔頭）
export function camRequest(base) {
  return { w: Math.max(base.w, base.h), h: Math.min(base.w, base.h) };
}

// 模擬鏡頭的畫布尺寸：模擬「手機鏡頭轉向後的輸出」，直式視窗用直式畫布
export function simSize(base, viewW, viewH) {
  const long = Math.max(base.w, base.h),
    short = Math.min(base.w, base.h);
  return isPortrait(viewW, viewH) ? { w: short, h: long } : { w: long, h: short };
}

// #frame 的顯示尺寸（CSS 像素）與縮放倍率 k（1 個影像像素 = k 個 CSS 像素）
export function frameFit(srcW, srcH, viewW, viewH) {
  const cover = isPortrait(viewW, viewH);
  const k = cover ? Math.max(viewW / srcW, viewH / srcH) : Math.min(viewW / srcW, viewH / srcH);
  return { cover, k, width: Math.round(srcW * k), height: Math.round(srcH * k) };
}

// 畫面上看得到的影像範圍（影像像素、置中；前鏡頭鏡像時左右對稱，所以不受影響）
export function visibleRect(srcW, srcH, viewW, viewH) {
  const { k } = frameFit(srcW, srcH, viewW, viewH);
  const w = Math.min(srcW, Math.round(viewW / k)),
    h = Math.min(srcH, Math.round(viewH / k));
  return { x: Math.round((srcW - w) / 2), y: Math.round((srcH - h) / 2), w, h };
}

// 在 rect 內取置中、寬高比為 aspect（寬 / 高）的最大範圍；濾鏡縮圖用
export function centerCrop(rect, aspect) {
  let w = rect.w,
    h = w / aspect;
  if (h > rect.h) {
    h = rect.h;
    w = h * aspect;
  }
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}
