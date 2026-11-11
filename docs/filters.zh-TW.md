# 濾鏡與美顏預設

[English](filters.md) | 繁體中文

**xixi-beauty-cam 有兩種效果，各有自己的分頁、檔案格式與強度條：**

|          | **濾鏡**                                                | **美顏**                                              |
| -------- | ------------------------------------------------------- | ----------------------------------------------------- |
| 套在哪裡 | **整張畫面**：所有人（美顏開或關都一樣）和背景          | **只在臉上**，而且只套在標籤是「美顏 開」的人         |
| 改什麼   | 調色：曝光、對比、飽和、色溫、色調、褪色、暗角、顆粒    | 磨皮、美白（膚色提亮）、瘦臉、大眼；不做色調變化      |
| 逐人開關 | 沒有。美顏關的人照樣套濾鏡，整張照片的色調才一致        | 有。點臉上的標籤，那個人的臉就保持原樣                |
| 參數範圍 | -100～100（顆粒 0～100），0 為不變                      | 0～100，0 為不修飾                                    |
| 檔案     | `<id>.xixi-filter.json`，`"format": "xixi-filter"`      | `<id>.xixi-beauty.json`，`"format": "xixi-beauty"`    |
| 內建     | `app/filters/`（預設「原圖」）                          | `app/beauty/`（預設「自然」）                         |
| Schema   | [`app/filters/schema.json`](../app/filters/schema.json) | [`app/beauty/schema.json`](../app/beauty/schema.json) |

一個 shader pass 裡的順序：**先美顏**（只在美顏開的臉部遮罩內），**再對整張畫面套濾鏡**。「美顏差異 ×20」檢視比對的是「只套濾鏡」的畫面，所以美顏關的人是全黑。

兩種檔案都只是資料，app 不會執行裡面的任何東西。

```
在 app 裡調 ──► 另存為我的濾鏡／美顏 ──► 匯出 ──► 傳給別人 ──► 對方拖進頁面
               （存在瀏覽器）                               （依 format 自動放進對的分頁）
```

## 1. 三步做出一個

1. **調**：開啟 app（見 [README](../README.zh-TW.md#快速開始)），選「**濾鏡**」或「**美顏**」分頁，挑一個接近的預設，按「**進階**」調各項滑桿與強度。
2. **存下來並匯出**：在「進階」裡按「**另存為我的濾鏡**」或「**另存為我的美顏**」，填名稱（最多 20 字）與作者（可留空）。新的預設出現在該分頁列尾，標著「自訂」。存的是你看到的效果，也就是各項值乘上強度。選中它，再按「**匯出這個濾鏡／美顏**」，會下載 `my-xxxx.xixi-filter.json` 或 `my-xxxx.xixi-beauty.json`。
3. **分享**：對方把檔案拖進頁面，或在「進階」、⋯ 選單按「**匯入檔案**」。濾鏡檔與美顏檔可以一起匯入，每個檔依 `format` 放進對的分頁，並切到那個分頁。不合格的檔案會被擋下並指出欄位，例如 `params.exposure 應為數字（-100–100）`。

補充：

- 自訂的預設可以按縮圖右上角的 × 移除，內建的不能移除。
- 自訂預設存在瀏覽器的 localStorage（濾鏡、美顏各一個鍵）。換瀏覽器、清除網站資料或私密視窗都會不見，要留的請先匯出。
- 兩個分頁各自記住上次的選擇。
- 匯入的 `id` 與現有的相同但內容不同時，自動改成 `id-2`、`id-3`…；內容完全相同就不重複加入。

## 2. 格式

兩種格式欄位相同，只有 `format`、副檔名與 `params` 不同。

| 欄位          | 必填 | 型別與限制                               | 說明                                                                     |
| ------------- | ---- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `format`      | 是   | `"xixi-filter"` 或 `"xixi-beauty"`       | 哪一種；匯入時決定放進哪個分頁                                           |
| `version`     | 是   | 1 以上的整數                             | 格式版本。比 app 新的版本可以讀，但給警告、忽略不認得的欄位              |
| `id`          | 是   | 小寫英數與 `-`，開頭須為英數，最長 64 字 | 代號，也是檔名 `<id>.xixi-filter.json`／`<id>.xixi-beauty.json` 的前半段 |
| `name`        | 是   | 1–20 字                                  | 列上顯示的名稱，純文字                                                   |
| `author`      | 否   | 最長 40 字                               | 滑鼠移上去時顯示                                                         |
| `description` | 否   | 最長 60 字                               | 名稱下方的一句話                                                         |
| `license`     | 否   | 最長 40 字，建議用 SPDX 代號             | 這個檔案的授權                                                           |
| `params`      | 是   | 物件，見下表                             | 缺的參數當 0；超出範圍的值夾到範圍內並四捨五入，會給警告                 |

**濾鏡的 `params`**（`xixi-filter`）

| 參數          | 範圍      | +100／-100 的效果                      |
| ------------- | --------- | -------------------------------------- |
| `exposure`    | -100～100 | 曝光 +1 檔／-1 檔                      |
| `contrast`    | -100～100 | 以中灰為軸 1.5 倍／0.5 倍              |
| `saturation`  | -100～100 | 飽和兩倍／黑白                         |
| `temperature` | -100～100 | 偏暖（加紅減藍）／偏冷                 |
| `tint`        | -100～100 | 偏洋紅／偏綠                           |
| `fade`        | -100～100 | 黑位抬高、白位壓低（底片感）／黑位壓深 |
| `vignette`    | -100～100 | 四角變暗／四角變亮                     |
| `grain`       | 0～100    | 底片顆粒，每幀重新產生                 |

**美顏的 `params`**（`xixi-beauty`）：`smooth` 磨皮、`whiten` 美白（膚色提亮）、`slim` 瘦臉、`eye` 大眼，各 0～100。曲線見 [architecture.md](architecture.md#parameter-curves)。

另一種的參數（例如濾鏡檔裡寫 `smooth`）會被忽略，所以濾鏡不會只作用在臉上，美顏預設也不會改整張畫面的色調。

### 範例

`soft-film.xixi-filter.json`：

```json
{
  "format": "xixi-filter",
  "version": 1,
  "id": "soft-film",
  "name": "淡淡底片",
  "author": "小明",
  "description": "微暖、輕微褪色",
  "license": "CC0-1.0",
  "params": { "exposure": 0, "contrast": -5, "saturation": -10, "temperature": 8, "tint": 0, "fade": 15, "vignette": 10, "grain": 5 }
}
```

`soft-glow.xixi-beauty.json`：

```json
{
  "format": "xixi-beauty",
  "version": 1,
  "id": "soft-glow",
  "name": "柔光",
  "author": "小明",
  "description": "磨皮多一點、微微提亮",
  "license": "CC0-1.0",
  "params": { "smooth": 60, "whiten": 30, "slim": 10, "eye": 5 }
}
```

最小的合法檔案：`{ "format": "xixi-beauty", "version": 1, "id": "just-smooth", "name": "只磨皮", "params": { "smooth": 50 } }`。

## 3. 提議加進內建

1. 在 app 裡做好並匯出。
2. 確認 `id` 沒和現有的重複，檔名改成 `<id>.xixi-filter.json`（放進 `app/filters/`）或 `<id>.xixi-beauty.json`（放進 `app/beauty/`）。
3. 在該資料夾 `index.json` 的 `presets` 陣列加上檔名。陣列順序就是列上的順序，`default` 是第一次開啟時選中的預設。清單只接受同資料夾、副檔名正確的檔名，網址與路徑一律不收。
4. `license` 設為 `CC0-1.0`（內建必填）。
5. 執行：

   ```sh
   npm run validate:presets
   npm test
   ```

   單一檔案可以用 `node scripts/validate-presets.mjs 路徑/檔名.xixi-filter.json` 檢查。

6. 開 pull request，簡短描述效果。截圖不能有可辨識的人臉。

## 4. 安全規則

預設檔來自陌生人，所以 app 只把它當資料：

- 只用 `JSON.parse` 解析，不用 `eval`、`new Function`、動態 `import`。
- 只把認得的欄位複製到新物件；不認得的欄位（含 `__proto__`）丟掉，匯出時也不會寫回去。
- 文字一律用 `textContent` 顯示，不當 HTML。去掉控制字元與雙向覆寫字元。檔案裡的網址一律不載入。
- 數字夾到範圍內；不是數字、`Infinity`、超過 64 KB 的檔案都擋下。
- 內建清單只接受同資料夾的 `<id>.xixi-filter.json`／`<id>.xixi-beauty.json` 檔名。

上面每一條都有 node 測試（`tests/preset-format.test.mjs`，兩種格式各跑一次）。發現繞過的方法請依 [SECURITY.md](../SECURITY.md) 私下回報。
