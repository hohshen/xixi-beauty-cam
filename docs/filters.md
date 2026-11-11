# Filters and beauty presets

English | [繁體中文](filters.zh-TW.md)

**xixi-beauty-cam has two separate kinds of look, each with its own tab, its own file format and its own intensity slider:**

|                   | **Filter** (濾鏡)                                                                       | **Beauty preset** (美顏)                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Applies to        | The **whole frame**: everyone, beauty on or off, and the background                     | **Faces only**, and only faces whose label says beauty **on**                              |
| What it changes   | Color grading: exposure, contrast, saturation, temperature, tint, fade, vignette, grain | Skin smoothing, whitening (skin brightening), face slimming, eye enlarging. No color shift |
| Per-person switch | No. A person switched off still gets the filter, so the photo keeps one tone            | Yes. Tap a face label to keep that face untouched                                          |
| Parameter range   | −100 to 100 (grain 0 to 100), 0 = unchanged                                             | 0 to 100, 0 = none                                                                         |
| File              | `<id>.xixi-filter.json`, `"format": "xixi-filter"`                                      | `<id>.xixi-beauty.json`, `"format": "xixi-beauty"`                                         |
| Built-ins         | `app/filters/` (default 原圖 _Original_)                                                | `app/beauty/` (default 自然 _Natural_)                                                     |
| Schema            | [`app/filters/schema.json`](../app/filters/schema.json)                                 | [`app/beauty/schema.json`](../app/beauty/schema.json)                                      |

Render order in the single shader pass: **beauty first** (inside the beauty-on face mask), **then the filter** over the whole frame. The _Difference ×20_ view compares the result with the frame that has only the filter applied, so a person with beauty off is pure black.

Both kinds are data only; the app never executes anything in them.

```
tune in the app ──► Save as my filter / beauty ──► Export ──► share ──► recipient drags it onto the page
                    (stored in your browser)                          (sorted into the right tab by "format")
```

## 1. Make one in three steps

1. **Tune it.** Start the app (see the [README](../README.md#quick-start)). Choose the **濾鏡** (_Filter_) or **美顏** (_Beauty_) tab, pick a preset close to what you want, press **進階** (_Advanced_) and adjust the sliders and the intensity.
2. **Save and export.** In _Advanced_, press **另存為我的濾鏡／美顏** (_Save as my filter / beauty_), enter a name (up to 20 characters) and optionally an author. It appears at the end of that tab's bar, marked **自訂** (_custom_). What is saved is what you see: each value multiplied by the intensity. With it selected, press **匯出這個濾鏡／美顏** (_Export_) to download `my-xxxx.xixi-filter.json` or `my-xxxx.xixi-beauty.json`.
3. **Share.** The recipient drags the file onto the page, or uses **匯入檔案** (_Import file_) in _Advanced_ or the ⋯ menu. Filters and beauty presets can be mixed in one import: each file goes to the tab its `format` says, and the app switches to that tab. Invalid files are rejected with the failing field, for example `params.exposure 應為數字（-100–100）`.

Notes:

- Remove a custom preset with the × on its thumbnail. Built-ins cannot be removed.
- Custom presets live in localStorage (one key per kind). Another browser, clearing site data or a private window loses them, so export the ones you want to keep.
- The app remembers the last choice of each tab separately.
- Same `id` with different content is renamed to `id-2`, `id-3`, …; identical content is not added twice.

## 2. Format

Both formats share the same fields; only `format`, the file extension and `params` differ.

| Field         | Required | Type and limits                                                          | Meaning                                                                                    |
| ------------- | -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `format`      | yes      | `"xixi-filter"` or `"xixi-beauty"`                                       | Which kind this is; decides the tab on import                                              |
| `version`     | yes      | integer ≥ 1                                                              | Format version. Newer versions are read with a warning, unknown fields ignored             |
| `id`          | yes      | lowercase letters, digits and `-`, starts with a letter or digit, max 64 | ID; also the file name `<id>.xixi-filter.json` / `<id>.xixi-beauty.json`                   |
| `name`        | yes      | 1–20 characters                                                          | Shown in the bar, as plain text                                                            |
| `author`      | no       | up to 40 characters                                                      | Shown in the tooltip                                                                       |
| `description` | no       | up to 60 characters                                                      | Shown under the name                                                                       |
| `license`     | no       | up to 40 characters, SPDX ID recommended (`CC0-1.0`, `CC-BY-4.0`)        | License of this file                                                                       |
| `params`      | yes      | object, see below                                                        | Missing parameters count as 0; out-of-range values are clamped and rounded, with a warning |

**Filter `params`** (`xixi-filter`)

| Key           | Range    | Effect at +100 / −100                                       |
| ------------- | -------- | ----------------------------------------------------------- |
| `exposure`    | −100…100 | +1 stop / −1 stop                                           |
| `contrast`    | −100…100 | 1.5× / 0.5× around mid-gray                                 |
| `saturation`  | −100…100 | 2× / black and white                                        |
| `temperature` | −100…100 | warmer (more red, less blue) / cooler                       |
| `tint`        | −100…100 | magenta / green                                             |
| `fade`        | −100…100 | lifted blacks and softer whites (film look) / deeper blacks |
| `vignette`    | −100…100 | darker corners / brighter corners                           |
| `grain`       | 0…100    | film grain, regenerated every frame                         |

**Beauty `params`** (`xixi-beauty`): `smooth` (skin smoothing), `whiten` (skin brightening), `slim` (face slimming), `eye` (eye enlarging), each 0…100. Curves are in [architecture.md](architecture.md#parameter-curves).

A key from the other kind (for example `smooth` in a filter file) is ignored, so a filter can never act on faces only and a beauty preset can never re-color the frame.

### Examples

`soft-film.xixi-filter.json`:

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

`soft-glow.xixi-beauty.json`:

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

The smallest valid file: `{ "format": "xixi-beauty", "version": 1, "id": "just-smooth", "name": "Smooth only", "params": { "smooth": 50 } }`.

## 3. Propose a built-in

1. Make it in the app and export it.
2. Pick an unused `id`, name the file `<id>.xixi-filter.json` (into `app/filters/`) or `<id>.xixi-beauty.json` (into `app/beauty/`).
3. Add the file name to the `presets` array of that folder's `index.json`. Array order is bar order; `default` is selected on first launch. Only bare file names with the right extension are accepted, never URLs or paths.
4. Set `license` to `CC0-1.0` (required for built-ins).
5. Run `npm run validate:presets` and `npm test`. Check a single file with `node scripts/validate-presets.mjs path/to/file.xixi-filter.json`.
6. Open a pull request with a short description of the look. Screenshots must not show identifiable faces.

## 4. Safety rules

Preset files come from strangers, so the app treats them strictly as data:

- Parsed with `JSON.parse` only. No `eval`, `new Function` or dynamic `import`.
- Only known fields are copied into a new object; unknown fields (including `__proto__`) are dropped and never written back on export.
- Text is shown with `textContent`, never as HTML. Control and bidi-override characters are stripped. URLs in files are never loaded.
- Numbers are clamped to their range; non-numbers, `Infinity` and files over 64 KB are rejected.
- The built-in index accepts only bare `<id>.xixi-filter.json` / `<id>.xixi-beauty.json` file names in its own folder.

Each rule has a Node test in `tests/preset-format.test.mjs`, run for both formats. If you find a way around them, please report it privately (see [SECURITY.md](../SECURITY.md)).
