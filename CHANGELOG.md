# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-11-13

### Added

- "原圖" button next to the shutter: one tap sets both the filter and the beauty tab back to none (original picture) and clears the checked style. It sits in the shutter row, so it is reachable from all three tabs, upright and sideways. Per-face beauty on/off is unchanged.
- The version (for example `v0.3.1`) is shown small at the top center of the screen. It comes from `app/version.js`, which `tests/ui.test.mjs` checks against `package.json` and the service worker's `CACHE_VERSION`.
- When a new version has been downloaded in the background and takes over the page, a "有新版，點此更新" button appears at the top; tapping it reloads into the new version. Nothing reloads by itself, and the first install (no previous version) shows the usual "offline files saved" message instead.
- `tests/ui.test.mjs`: default tab, reset to original, version consistency and the update logic.

### Changed

- The app opens on the "風格" (style) tab the first time. After that it reopens on the last tab used. The filter and beauty applied by default are unchanged (原圖 / 自然).

## [0.3.0] - 2026-11-13

### Added

- Styles: a new "風格" (style) tab. One tap switches the filter tab and the beauty tab together to the presets the style names (strength 100%, fine-tuning cleared); you can still adjust each tab afterwards, and the style stays checked with an "（已調整）" mark. Per-face beauty on/off is unchanged.
- `xixi-style` preset format (`app/styles/*.xixi-style.json`, with `index.json` and `schema.json`): a style stores only one filter id and one beauty id, no parameters and no URLs. Styles can be exported and imported (drag and drop or the import button) like the other two formats; when a style names a preset that is not in the list, the other half is still applied and a message says which file is missing.
- Four built-in styles, listed after the existing presets: 柔霧粉 (soft-pink), 鮮彩冷調 (vivid-cool), 冷綠清透 (cool-green) and 冷白顆粒 (cool-grain).
- Four filters (`fit-f1`–`fit-f4`: 柔霧粉, 鮮彩冷調, 冷綠清透, 冷白顆粒) and four beauty presets (`fit-f1`–`fit-f4`: 柔膚, 輕修, 精修, 小臉) used by the styles. Their parameters were fitted from reference photos; the beauty values are rough estimates.
- `scripts/validate-presets.mjs` checks the style format; tests for the style format and for one-tap switching.

### Changed

- The default filter (none) and beauty preset (natural) are unchanged; no style is applied on first open.
- `docs/filters.md` and `docs/filters.zh-TW.md` have a new section on styles.

## [0.2.1] - 2026-11-12

### Fixed

- Phones held upright: the preview is now portrait and fills the whole screen (cover) instead of a 16:9 strip in the middle; filter thumbnails are 3:4 portrait and photos are cropped to what the preview shows, so they are portrait too. Landscape phones and desktops keep the 0.2.0 layout (whole frame, no crop).
- The camera is always asked for a landscape size (1280×720) and the browser rotates it; 0.2.0 swapped it to 720×1280 in portrait, which made Android Chrome return a landscape frame.
- "Use a photo as the camera" switches to a portrait 720×1280 canvas in portrait windows.

## [0.2.0] - 2026-11-11

### Added

- Progressive Web App: `manifest.webmanifest` (standalone, portrait), original app icons (`scripts/make-icons.py`), and a service worker that caches the whole app including MediaPipe and the model, so it opens and detects faces offline after the first visit.
- Phones: front/rear camera switch (rear camera is not mirrored), share sheet for captured photos on touch devices (save to Photos on iPhone, download as fallback), landscape layout for short screens, safe-area insets on all sides, resume after backgrounding, no pinch/double-tap zoom or pull-to-refresh.
- Auto quality: when the preview stays under 24 fps for 3 s, the bilateral filter uses fewer samples and face detection runs every 2nd or 3rd frame; the level is shown in the fps panel and can be pinned (`?quality=0..4` or the ⋯ menu).
- `docs/deploy.md` (Cloudflare Pages and other static hosts) and `app/_headers`.
- Phone test steps for iPhone Safari and Android Chrome in the README; `tests/pwa.test.mjs`.

### Changed

- MediaPipe Tasks Vision 1.2.2 (JS, WASM) and the Face Landmarker model are now shipped in `app/vendor/` instead of loaded from jsDelivr and Google Cloud Storage; the app only requests files from its own origin.
- A Content-Security-Policy (`connect-src 'self'`) blocks requests to other hosts, including the usage-statistics logger built into MediaPipe 1.2.2.
- CI: `actions/checkout` 7.0.1 and `actions/setup-node` 7.1.0.

## [0.1.0] - 2026-11-11

First public release.

### Added

- In-browser beauty camera: live preview from the webcam via `getUserMedia`, face detection with MediaPipe Face Landmarker (up to 6 faces), and a single-pass WebGL2 shader for skin smoothing (bilateral filter), brightening, face slimming and eye enlarging.
- Per-person beauty switch: every face is labeled ("人物 N") with a stable ID across frames; people with beauty off and a protection zone around them get no beauty (they still get the whole-frame filter).
- Two tabs, **Filter** and **Beauty**, each with its own preset bar, intensity slider and collapsible *Advanced* panel; the last choice in each tab is remembered.
- Filters: whole-frame color grading (exposure, contrast, saturation, temperature, tint, fade, vignette, grain; -100 to 100) applied to everyone and the background, with six built-in filters (原圖, 清新, 暖陽, 冷白, 膠片, 黑白).
- Beauty presets: face-only retouching (smoothing, brightening, slimming, eye enlarging) with no color shift, applied only to people with beauty on, with six built-in presets (原生, 自然, 清透, 亮白, 精緻, 網紅).
- Custom presets: save your own filter or beauty preset in the browser, export and import `.xixi-filter.json` / `.xixi-beauty.json` files (file picker or drag and drop); imports go to the right tab by their `format` field, with validation that points at the failing field.
- Two file formats (`xixi-filter` and `xixi-beauty`, version 1), each with a JSON Schema and index, and a validation script.
- Photo capture to PNG (with the effect, without labels and UI).
- "Use a photo as the camera" test input, mask view, difference ×20 view (against the filter-only frame) and an fps / timing panel.
- Node test suites for presets and both preset formats, a browser warp test, ESLint and Prettier, commitlint for Conventional Commits, and GitHub Actions CI.

[Unreleased]: https://github.com/hohshen/xixi-beauty-cam/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/hohshen/xixi-beauty-cam/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/hohshen/xixi-beauty-cam/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/hohshen/xixi-beauty-cam/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hohshen/xixi-beauty-cam/releases/tag/v0.1.0
