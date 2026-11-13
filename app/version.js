// SPDX-License-Identifier: Apache-2.0
// 版本號與「有新版」的判斷（不碰 DOM，node 可直接測）。
// APP_VERSION 要和 package.json 的 version、sw.js 的 CACHE_VERSION（xixi-beauty-cam-<版本>-<序號>）一致；
// tests/ui.test.mjs 會檢查三者。發新版時三個地方一起改。

export const APP_VERSION = '0.3.1';

export function versionLabel(v = APP_VERSION) {
  return `v${v}`;
}

/**
 * 監看 service worker 換手（controllerchange）。
 * - 原本沒有 controller（第一次安裝）：呼叫 onFirstInstall，不算新版。
 * - 原本就有 controller：新版的 sw.js 已裝好並接手，呼叫 onUpdate；同一頁只通知一次。
 * 不在這裡重新載入：由使用者點「有新版，點此更新」才 reload，所以不會無限重新載入。
 * @param container navigator.serviceWorker（或測試用的假物件：controller 與 addEventListener）
 */
export function watchServiceWorker(container, { onFirstInstall = () => {}, onUpdate = () => {} } = {}) {
  let hadController = !!container.controller;
  let notified = false;
  container.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      onFirstInstall();
      return;
    }
    if (notified) return;
    notified = true;
    onUpdate();
  });
}
