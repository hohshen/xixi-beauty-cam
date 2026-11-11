# xixi-beauty-cam

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/hohshen/xixi-beauty-cam/actions/workflows/ci.yml/badge.svg)](https://github.com/hohshen/xixi-beauty-cam/actions/workflows/ci.yml)

English | [繁體中文](README.zh-TW.md)

**A beauty camera that runs entirely in your browser and lets you switch beauty off for individual people in the frame.** It separates two things most beauty cameras mix up: a **filter** is color grading for the whole picture, and **beauty** is retouching applied only to faces. xixi-beauty-cam tags every face ("Person 1", "Person 2", …); tap a tag to keep that person's face un-retouched while everyone else still gets beauty, and the whole frame still shares one filter.

<p align="center">
  <img src="docs/images/hero.svg" width="560" alt="Two cartoon faces: Person 1 with the beauty filter on, Person 2 switched off and left untouched">
</p>

> **Status: early prototype (0.1.0).** The image pipeline and both preset formats are covered by automated tests, but the full UI has only been checked on desktop Chrome so far. See [Known limitations](docs/architecture.md#known-limitations).

## Quick start

No build step and no runtime dependencies — it is a static web page.

```sh
git clone https://github.com/hohshen/xixi-beauty-cam.git
cd xixi-beauty-cam
python3 -m http.server 8000 --directory app   # or: npm start
```

Open <http://localhost:8000/> in Chrome, press **開啟鏡頭** (Start camera) and allow camera access. `localhost` is a secure origin, so the camera API works without HTTPS. No camera, or only one person around? Use **用照片模擬鏡頭** (Use a photo as the camera) and pick a group photo.

> The interface is currently in Traditional Chinese. Contributions for other languages are welcome.

## Features

| Feature                      | What it does                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filter tab (濾鏡)**        | Color grading for the **whole frame**: exposure, contrast, saturation, temperature, tint, fade, vignette, grain. Everyone and the background get it, including people with beauty off, so the photo keeps one tone.                             |
| **Beauty tab (美顏)**        | Face retouching for **faces only**: skin smoothing, whitening, slimming, eye enlarging. No color shift. Each tab has its own preset bar and intensity slider and remembers its last choice.                                                     |
| **Per-person beauty on/off** | Every detected face gets a label. Tap it to switch beauty off for that person; their face (and a protection zone around it) gets only the filter, pixel-identical to the filtered original, even when the person next to them is being slimmed. |
| **Make and share**           | Fine-tune under _Advanced_, save your own filter or beauty preset, export it as `.xixi-filter.json` or `.xixi-beauty.json`, and send it to anyone. Dropped files go to the right tab automatically.                                             |
| **Capture**                  | The shutter button saves the current frame as a PNG, with the filter and beauty effect but without labels or UI.                                                                                                                                |
| **Photo as camera**          | Feed a still photo through the exact same pipeline, for testing multi-person scenes without a crowd.                                                                                                                                            |
| **Diagnostics**              | Mask view, "beauty difference ×20" view (compares against the filter-only frame; people with beauty off are pure black), and an fps / per-stage timing panel.                                                                                   |

How it works, in one line: camera → [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) → cross-frame tracking → per-person mask and warp parameters → one WebGL2 shader pass (beauty on beauty-on faces: warp, bilateral smoothing, brightening; then the filter's color grading over the whole frame) → canvas. Details in [docs/architecture.md](docs/architecture.md).

## Privacy

**Your camera image never leaves your device.** All detection and rendering happen in the browser tab. The page makes no network requests other than loading its own files, the pinned MediaPipe library from jsDelivr, and the Face Landmarker model from Google Cloud Storage. There is no analytics, telemetry, error reporting, account or upload. Captured photos are generated locally and only saved when you download them. Filter and beauty preset files are read locally as data and never executed.

You can verify this yourself in DevTools → Network; the expected request list is in [docs/architecture.md](docs/architecture.md#network-requests).

## Browser support

| Browser                   | Status                                                        |
| ------------------------- | ------------------------------------------------------------- |
| Chrome / Edge (desktop)   | Developed and tested here                                     |
| Firefox, Safari (desktop) | Not verified yet                                              |
| Mobile browsers           | Layout supports portrait screens; not verified on devices yet |

Requirements: WebGL2, WebAssembly, ES modules, `getUserMedia` (served over `https://` or `localhost`).

## Make your own filter or beauty preset

Both are tiny JSON files. A filter (`*.xixi-filter.json`) holds eight color-grading numbers from −100 to 100; a beauty preset (`*.xixi-beauty.json`) holds four retouching numbers from 0 to 100. Make one in the app and export it, or write it by hand:

```json
{
  "format": "xixi-filter",
  "version": 1,
  "id": "soft-film",
  "name": "Soft film",
  "license": "CC0-1.0",
  "params": { "contrast": -5, "saturation": -10, "temperature": 8, "fade": 15, "vignette": 10, "grain": 5 }
}
```

```json
{
  "format": "xixi-beauty",
  "version": 1,
  "id": "soft-glow",
  "name": "Soft glow",
  "license": "CC0-1.0",
  "params": { "smooth": 60, "whiten": 30, "slim": 10, "eye": 5 }
}
```

Read the [filter and beauty preset guide](docs/filters.md) for the difference between the two, the full formats and how to propose a built-in.

## Contributing

Bug reports, ideas, new filters, beauty presets and code are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, tests and pull request flow. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md); for questions see [SUPPORT.md](SUPPORT.md).

```sh
npm ci          # dev tools only (ESLint, Prettier)
npm test        # unit tests + filter / beauty preset validation
npm run lint    # ESLint + Prettier check
```

## Third-party components

Loaded at runtime from pinned URLs; not bundled in this repository. See [NOTICE](NOTICE).

| Component                                                         | Version   | License                          | Source                                                                                                           |
| ----------------------------------------------------------------- | --------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| MediaPipe Tasks Vision (`@mediapipe/tasks-vision`), JS + WASM     | 1.2.2     | Apache-2.0                       | <https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/>                                                    |
| Face Landmarker model `face_landmarker.task` (float16, version 1) | float16/1 | Apache-2.0 (per the model cards) | <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task> |

## License

Code: [Apache License 2.0](LICENSE). Built-in filters in `app/filters/` and beauty presets in `app/beauty/` are released under CC0-1.0, as stated in each file.
