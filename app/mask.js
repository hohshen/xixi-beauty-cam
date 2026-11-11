// SPDX-License-Identifier: Apache-2.0
// 逐人遮罩：畫在與影像同比例（可縮小）的 2D canvas 上，座標為未鏡像的正規化影像座標。
// R 通道 = 「美顏開」的人（磨皮、美白範圍）；G 通道 = 「美顏關」的人（瘦臉、大眼的保護區）。
// 關掉的人 R 為 0、G 為 1，shader 在那裡不美顏也不位移，直接輸出原圖。

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{cx:number, cy:number, w:number, beauty:boolean, landmarks:any[]|null}[]} tracks
 * @param {number[]} ovalOrder  FACE_OVAL 的 landmark 索引（依輪廓順序）
 */
export function drawFaceMask(ctx, tracks, ovalOrder) {
  const { width: w, height: h } = ctx.canvas;
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter'; // R、G 兩通道各自疊加，互不覆蓋

  for (const t of tracks) {
    if (!t.landmarks) continue;
    const faceW = t.w * w;
    const feather = Math.max(2, faceW * 0.06);
    ctx.filter = `blur(${feather.toFixed(1)}px)`;
    // 美顏區往中心內縮 6%，讓柔邊落在輪廓線上，不往外溢到頭髮與背景。
    // 保護區往外擴 25%，柔邊落在輪廓外，整張臉（含下巴、臉頰邊緣）都在 G≈1 內。
    const cx = t.cx * w,
      cy = t.cy * h,
      scale = t.beauty ? 0.94 : 1.25;
    ctx.fillStyle = t.beauty ? '#f00' : '#0f0';
    ctx.beginPath();
    ovalOrder.forEach((idx, i) => {
      const p = t.landmarks[idx];
      const x = cx + (p.x * w - cx) * scale;
      const y = cy + (p.y * h - cy) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
}
