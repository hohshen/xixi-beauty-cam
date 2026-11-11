# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/hohshen/xixi-beauty-cam/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hohshen/xixi-beauty-cam/releases/tag/v0.1.0
