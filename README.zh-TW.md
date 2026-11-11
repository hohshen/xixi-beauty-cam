# xixi-beauty-cam

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/hohshen/xixi-beauty-cam/actions/workflows/ci.yml/badge.svg)](https://github.com/hohshen/xixi-beauty-cam/actions/workflows/ci.yml)

[English](README.md) | 繁體中文

**在瀏覽器裡執行的美顏相機，可以針對畫面中的某個人關掉美顏。** 它把兩件事分開：**濾鏡**是整張照片的調色，**美顏**是只套在臉上的修飾。xixi-beauty-cam 會在每張臉上標「人物 1」「人物 2」……，點一下標籤，那個人的臉就不修飾，其他人照樣美顏，整張畫面仍套同一個濾鏡。

<p align="center">
  <img src="docs/images/hero.svg" width="560" alt="兩張卡通臉：人物 1 美顏開，人物 2 美顏關、維持原貌">
</p>

> **狀態：早期原型（0.1.0）。** 影像管線與濾鏡、美顏兩種檔案格式有自動測試，完整介面目前只在桌面版 Chrome 確認過。見[已知限制](docs/architecture.md#known-limitations)。

## 快速開始

不需要建置，也沒有執行期相依，就是一個靜態網頁。

```sh
git clone https://github.com/hohshen/xixi-beauty-cam.git
cd xixi-beauty-cam
python3 -m http.server 8000 --directory app   # 或 npm start
```

用 Chrome 開 <http://localhost:8000/>，按「**開啟鏡頭**」並允許鏡頭權限。`localhost` 屬於安全來源，不用 HTTPS 也能開鏡頭。沒有鏡頭或身邊只有一個人時，按「**用照片模擬鏡頭**」選一張合照。

## 功能

| 功能               | 說明                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **濾鏡分頁**       | 套在**整張畫面**的調色：曝光、對比、飽和、色溫、色調、褪色、暗角、顆粒。所有人和背景一起套，美顏關的人也一樣，整張照片色調一致。 |
| **美顏分頁**       | 只套在**臉上**的修飾：磨皮、美白、瘦臉、大眼，不做色調變化。兩個分頁各有自己的預設列與強度條，並各自記住上次的選擇。             |
| **逐人開關美顏**   | 每張偵測到的臉都有標籤，點一下就關掉那個人的美顏。被關掉的人臉部（含周圍保護區）只套濾鏡，與「只套濾鏡」的畫面逐像素相同。       |
| **自製與分享**     | 在「進階」微調後另存為自己的濾鏡或美顏，匯出成 `.xixi-filter.json` 或 `.xixi-beauty.json` 傳給別人；拖進頁面會自動放進對的分頁。 |
| **拍照**           | 快門把目前畫面存成 PNG，含濾鏡與美顏，不含標籤與介面。                                                                           |
| **用照片模擬鏡頭** | 讓一張照片走完全相同的流程，不用找一群人也能測多人畫面。                                                                         |
| **檢視與量測**     | 遮罩檢視、「美顏差異 ×20」（比對只套濾鏡的畫面，美顏關的人應全黑）、fps 與各階段耗時面板。                                       |

流程一句話：鏡頭 → [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) → 跨幀追蹤 → 逐人遮罩與變形參數 → 一個 WebGL2 shader pass（先對美顏開的臉變形、雙邊濾波磨皮、提亮，再對整張畫面套濾鏡調色）→ canvas。細節見 [docs/architecture.md](docs/architecture.md)。

## 隱私

**鏡頭影像不會離開你的裝置。** 偵測與渲染都在瀏覽器分頁裡完成。頁面除了載入自己的檔案、jsDelivr 上固定版本的 MediaPipe 函式庫，以及 Google Cloud Storage 上的 Face Landmarker 模型之外，不發任何網路請求；沒有分析、遙測、錯誤回報、帳號或上傳。照片在本機產生，只有你按下載才會存檔。濾鏡檔只在本機當資料讀取，不會被執行。

可以在 DevTools → Network 自己確認，應有的請求清單見 [docs/architecture.md](docs/architecture.md#network-requests)。

## 瀏覽器支援

| 瀏覽器                  | 狀態                             |
| ----------------------- | -------------------------------- |
| Chrome／Edge（桌面）    | 開發與測試環境                   |
| Firefox、Safari（桌面） | 尚未驗證                         |
| 手機瀏覽器              | 版面支援直式螢幕，尚未在實機驗證 |

需求：WebGL2、WebAssembly、ES modules、`getUserMedia`（需在 `https://` 或 `localhost` 下開啟）。

## 自製濾鏡與美顏

兩種都是小 JSON 檔。濾鏡（`*.xixi-filter.json`）是八個 -100～100 的調色數字；美顏預設（`*.xixi-beauty.json`）是四個 0～100 的修飾數字。可以在 app 裡調好匯出，也可以手寫：

```json
{
  "format": "xixi-filter",
  "version": 1,
  "id": "soft-film",
  "name": "淡淡底片",
  "license": "CC0-1.0",
  "params": { "contrast": -5, "saturation": -10, "temperature": 8, "fade": 15, "vignette": 10, "grain": 5 }
}
```

```json
{
  "format": "xixi-beauty",
  "version": 1,
  "id": "soft-glow",
  "name": "柔光",
  "license": "CC0-1.0",
  "params": { "smooth": 60, "whiten": 30, "slim": 10, "eye": 5 }
}
```

兩者的差別、完整格式與「怎麼加進內建清單」見[濾鏡與美顏指南](docs/filters.zh-TW.md)。

## 參與貢獻

歡迎回報問題、提想法、貢獻濾鏡、美顏預設或程式。開發環境、測試與 PR 流程見 [CONTRIBUTING.md](CONTRIBUTING.md)，請遵守[行為準則](CODE_OF_CONDUCT.md)。資安問題請依 [SECURITY.md](SECURITY.md) 私下回報；使用問題見 [SUPPORT.md](SUPPORT.md)。

```sh
npm ci          # 只裝開發工具（ESLint、Prettier）
npm test        # 單元測試 + 濾鏡與美顏檔驗證
npm run lint    # ESLint + Prettier 檢查
```

## 第三方元件

執行時從固定網址載入，不包含在本 repo 內。見 [NOTICE](NOTICE)。

| 元件                                                           | 版本      | 授權                   | 來源                                                                                                             |
| -------------------------------------------------------------- | --------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| MediaPipe Tasks Vision（`@mediapipe/tasks-vision`）JS 與 WASM  | 1.2.2     | Apache-2.0             | <https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/>                                                    |
| Face Landmarker 模型 `face_landmarker.task`（float16，版本 1） | float16/1 | Apache-2.0（依模型卡） | <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task> |

## 授權

程式碼：[Apache License 2.0](LICENSE)。`app/filters/` 的內建濾鏡與 `app/beauty/` 的內建美顏預設以 CC0-1.0 釋出（各檔內有註明）。
