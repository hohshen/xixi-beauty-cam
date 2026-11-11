# Architecture

**xixi-beauty-cam is a static web app: plain ES modules, one WebGL2 shader pass, and MediaPipe Face Landmarker loaded from pinned URLs.** Each frame goes through detection → tracking → per-person mask and warp parameters → shader (beauty on faces, then the filter on the whole frame) → canvas. Nothing is sent anywhere.

```
camera (<video>) or photo canvas
        │
        ▼
FaceLandmarker.detectForVideo (numFaces 6, skips repeated frames)
        │ landmarks
        ▼
FaceTracker ── stable IDs ──► labels "人物 N" (tap to toggle beauty)
        │
        ├─► mask.js   half-resolution mask: R = beauty on, G = protection zone (beauty off)
        ├─► warp.js   slimming control points, eye centers, warp bounding boxes (beauty-on faces only)
        └─► look.js   two tabs, each: preset × intensity × fine-tuning
                        filter tab → eight −1..1 grading parameters (whole frame)
                        beauty tab → four 0..1 parameters (beauty-on faces only)
                │
                ▼
renderer.js  one WebGL2 pass:
             1. beauty: inverse-mapped warp (×0 inside protection zones)
                → 9×9 bilateral smoothing → log brightening with YCbCr skin weight → mask blend
             2. filter: exposure → temperature/tint → contrast → saturation → fade → vignette → grain,
                applied to every pixel, mask ignored
                │
                ▼
mirrored <canvas> (preview) ──► PNG capture
```

## Modules

| File                              | Responsibility                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/index.html`, `app/style.css` | Full-screen preview, Filter / Beauty tabs (each with intensity, preset bar, Advanced), shutter, overflow menu, labels                                                                                                                              |
| `app/app.js`                      | Video source (camera or photo), detection loop, the two tabs and their thumbnails, save / export / import (sorted by `format`) / drag-and-drop, labels, capture, timing                                                                            |
| `app/presets.js`                  | The two preset kinds (filter, beauty): parameter lists and ranges, loading and validating files, format detection on import, export, custom storage. No DOM; tested in Node                                                                        |
| `app/look.js`                     | State of one tab: current preset, intensity, fine-tuning → per-frame parameters. One instance per tab. No DOM; tested in Node                                                                                                                      |
| `app/tracker.js`                  | Cross-frame tracking: greedy nearest-neighbour on box centers, threshold 0.8 face widths (1.6 for briefly lost tracks); a track is dropped after 45 missed detections; new people get the smallest free number                                     |
| `app/mask.js`                     | Per-person mask. Beauty-on faces: contour shrunk 6%. Beauty-off faces: protection zone, contour grown 25%. Feather radius = 6% of face width                                                                                                       |
| `app/warp.js`                     | Slimming control points (10 points, radius 30% of face width), eye circles, per-face warp boxes (face box + 40% of face width). Geometry smoothed across frames (EMA 0.5); strength applied last so 0 means exactly no displacement                |
| `app/renderer.js`                 | The WebGL2 shader, one pass: beauty inside the beauty-on mask (warp, smoothing, whitening), then the filter's color grading over the whole frame. Beauty-off faces get zero displacement and zero beauty mask, so they equal the filter-only frame |
| `app/filters/`, `app/beauty/`     | Built-in filters (`*.xixi-filter.json`) and beauty presets (`*.xixi-beauty.json`), each with `index.json` (order and default) and `schema.json`                                                                                                    |

Warp math: each output pixel _p_ samples the source at _p + off(p)_. Slimming offset is a weighted average of the control-point displacements times a smooth union 1−Π(1−wᵢ), wᵢ = (1−d²/r²)². Eye enlarging offset is −(p−c)·a·(1−d²/R²)², so scale and slope return continuously to 1 at the radius. Both are 0 outside the warp box.

## Parameter curves

| Parameter              | Effect at 100                                                              | Curve                                                                                           |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Smoothing (`smooth`)   | Bilateral blend 0.35–1 (by skin weight), range tolerance 0.04 → 0.12       | Roughly linear                                                                                  |
| Brightening (`whiten`) | `log(1+(b−1)x)/log b`, `b = 1+5k`, then 25% desaturation toward warm white | Steep at first, then flat: skin luma 0.6 gains +7.8% at 10, +15% at 25, +22% at 50, +29% at 100 |
| Slimming (`slim`)      | Contour points move 12% of their distance to the midline                   | Linear                                                                                          |
| Eyes (`eye`)           | Eye center magnified 1/(1−0.32k)                                           | Roughly linear: 1.03× at 10, 1.13× at 35, 1.19× at 50                                           |

Filter parameters (k = value / 100 × intensity, applied in this order to every pixel; all 0 skips grading entirely):

| Parameter     | Formula                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `exposure`    | `c × 2^k` (±1 stop)                                                     |
| `temperature` | R × (1 + 0.12k), B × (1 − 0.12k)                                        |
| `tint`        | G × (1 − 0.1k) (positive = magenta, negative = green)                   |
| `contrast`    | `(c − 0.5) × (1 + 0.5k) + 0.5`                                          |
| `saturation`  | `mix(luma, c, 1 + k)`; −100 is black and white                          |
| `fade`        | k > 0: `c × (1 − 0.25k) + 0.15k`; k < 0: `(c + 0.1k) / (1 + 0.1k)`      |
| `vignette`    | `c × (1 − 0.6k × smoothstep(0.35, 1, d))`, d = 0 at center, 1 at corner |
| `grain`       | `c + (hash(pixel, frame) − 0.5) × 0.12k`, new pattern every frame       |

## Network requests

The page should request only:

- Its own files: `index.html`, `style.css`, `app.js`, `presets.js`, `look.js`, `tracker.js`, `renderer.js`, `warp.js`, `mask.js`, `filters/index.json`, `beauty/index.json` and the built-in `filters/*.xixi-filter.json` and `beauty/*.xixi-beauty.json`.
- jsDelivr: `vision_bundle.mjs`, `vision_wasm_internal.js` and the `.wasm` file of `@mediapipe/tasks-vision@1.2.2`.
- Google Cloud Storage: `face_landmarker.task` (float16/1).

Photos used as a camera are read through `blob:` URLs. Imported preset files are read with `File.text()`, exported ones are downloaded through `blob:` URLs. URLs inside preset files are never loaded. There is no analytics, telemetry or error-reporting service.

## Browser storage

| Key (localStorage)               | Contents                                   |
| -------------------------------- | ------------------------------------------ |
| `xixi-beauty-cam.filter`         | ID of the last selected filter             |
| `xixi-beauty-cam.beauty`         | ID of the last selected beauty preset      |
| `xixi-beauty-cam.tab`            | Last open tab (`filter` or `beauty`)       |
| `xixi-beauty-cam.custom-filters` | Saved and imported custom filters          |
| `xixi-beauty-cam.custom-beauty`  | Saved and imported custom beauty presets   |
| `xixi-beauty-cam.author`         | Author name last used when saving a preset |

All reads and writes are wrapped in `try/catch`; in private windows the app still works and warns that custom presets will be lost on reload.

## Known limitations

- Only verified on desktop Chrome. Safari, Firefox and mobile devices are not verified yet.
- The built-in beauty values were derived from the shader curves, and the built-in filter values are the planned starting values checked numerically on sample colors; both still need visual tuning on real scenes.
- Filter thumbnails are a rough CSS approximation of exposure, contrast, saturation and temperature; the preview shows the real result.
- Tracking uses position only (no face recognition). After about 1.5 s without a match a track is dropped; a returning person gets the smallest free number and beauty resets to on. Two people swapping places while out of frame may get each other's labels.
- When faces overlap, the protection zone wins: the beauty-on person's side close to the beauty-off person loses slimming, eyes and smoothing.
- Slimming samples from outside the jaw inward, so background within about 0.3 face widths of a beauty-on jaw is stretched slightly (up to ~6% of face width at 100).
- A face missed in one frame has no landmarks in that frame, so it has neither warp nor protection zone for that frame.
- Warp geometry lags 1–2 frames on fast head turns (EMA smoothing).
- Beyond about 45° profile, far-side contour landmarks are estimated and slimming may push into the background or ears.
- The mask covers the face contour only; strong brightening can show a seam at the neck and ears.
- Skin weighting uses a fixed YCbCr range; extreme lighting or skin tones may get a weaker effect (never outside the mask).
- Very small faces (under ~7% of the frame width, or more than ~2 m away) may not be detected by the short-range model.
- Beauty thumbnails show the current frame without the effect, so they look alike.
- Photo-as-camera supports JPEG and PNG stills only.
