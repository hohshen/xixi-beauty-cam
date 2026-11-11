# Deploying

**`app/` is the release folder.** It is a plain static site with no build step: upload the folder as is to any static host that serves HTTPS. This page explains how; it does not deploy anything by itself.

| Requirement         | Why                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| HTTPS               | Browsers only allow the camera (`getUserMedia`) and service workers on `https://` (or `localhost`)      |
| Files up to 14.6 MB | The largest file is `vendor/mediapipe/…/vision_wasm_internal.wasm` (14.6 MB); total size is about 19 MB |
| `.wasm` MIME type   | `application/wasm`, so the browser can compile while downloading (it still works, slower, without it)   |
| No COOP/COEP needed | The bundled MediaPipe build is single-threaded and does not use `SharedArrayBuffer`                     |
| `sw.js` not cached  | `sw.js` and `index.html` must be revalidated (`Cache-Control: no-cache`), or updates never reach users  |

## Cloudflare Pages

Cloudflare Pages reads `app/_headers` for the response headers, so no extra configuration is needed beyond the build settings.

**Recommended: the deploy script.** [`deploy/cloudflare/`](../deploy/cloudflare/README.md) has a `wrangler.toml` and `deploy.sh`. After a one-time setup (install Node, `npx wrangler@4.78.0 login`, `npx wrangler@4.78.0 pages project create xixi-beauty-cam --production-branch main`), every update is one command from the repository root: `deploy/cloudflare/deploy.sh`. It checks for a clean working tree, runs the tests, lint and preset validation, checks that `CACHE_VERSION` in `app/sw.js` matches `package.json`, and deploys `main` to production and any other branch as a preview (`--preview`, `--dry-run`, `--help`). Setup, rollback and common errors are in [`deploy/cloudflare/README.md`](../deploy/cloudflare/README.md) (Traditional Chinese).

### Option A: connect the GitHub repository

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**, choose the repository.
2. Build settings:

   | Setting                | Value                      |
   | ---------------------- | -------------------------- |
   | Framework preset       | None                       |
   | Build command          | _(leave empty)_            |
   | Build output directory | `app`                      |
   | Root directory         | _(leave empty: repo root)_ |
   | Environment variables  | none                       |

3. **Save and Deploy**. Every push to the production branch deploys; other branches and pull requests get preview URLs (`<hash>.<project>.pages.dev`), which are handy for testing on phones (HTTPS).

### Option B: upload directly

- Dashboard: **Create** → **Pages** → **Upload assets**, drag in the contents of `app/` (the files inside it, not the folder above it).
- Or with Wrangler: `npx wrangler pages deploy app --project-name <name>`.

### Headers (`app/_headers`)

| Path                                                  | Headers                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all                                                   | `Content-Security-Policy` (same as the `<meta>` in `index.html`, plus `frame-ancestors 'none'`), `Permissions-Policy: camera=(self)`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` |
| `/sw.js`, `/`, `/index.html`, `/manifest.webmanifest` | `Cache-Control: no-cache`                                                                                                                                                                               |
| `/vendor/*`                                           | `Cache-Control: public, max-age=31536000, immutable` (the version is in the path)                                                                                                                       |

`_headers` sets the `.wasm` file to `application/wasm` and the `.task` model to `application/octet-stream` explicitly, so the result does not depend on the host's MIME table. The project's other files use the Pages defaults (short browser cache plus ETag revalidation), which is fine because the service worker does the offline caching. Cloudflare Pages limits a single file to 25 MiB and a site to 20,000 files (per Cloudflare's documentation; 待查證 whether the limits have changed); this app has about 40 files and `npm test` checks every vendored file is under 25 MiB.

If you serve the app under a sub-path (for example `example.com/cam/`), everything still works: all paths in the app, the manifest and the service worker are relative. Adjust the paths in `_headers` to `/cam/sw.js` and so on.

### After deploying: checks

1. Open the URL in desktop Chrome → DevTools → **Application** → **Manifest**: no errors, the icons show, "Installability" has no warnings.
2. **Application** → **Service workers**: `sw.js` is activated. **Cache storage**: `xixi-beauty-cam-<version>` with about 40 entries.
3. **Network**: every request goes to your own domain. One request to `odml.pa.googleapis.com` is blocked by CSP — that is MediaPipe's built-in statistics logger and is expected.
4. **Network** → _Offline_, reload: the page opens, a photo-as-camera run detects faces.
5. Run the phone checks in the README ([Testing on phones](../README.md#testing-on-phones)).

## Releasing an update

1. Change files in `app/`.
2. Bump `CACHE_VERSION` in `app/sw.js` (`xixi-beauty-cam-<package version>-<n>`; `npm test` checks the format and that the cache list matches `app/`).
3. Deploy (`deploy/cloudflare/deploy.sh` refuses to deploy if the cache version and the package version do not match). Browsers fetch the new `sw.js` on the next visit, download the new version in the background and show 「新版本已下載，重新整理後使用」; the next load uses it.

## Other static hosts

Any host that serves files over HTTPS works (GitHub Pages, Netlify, Vercel, Firebase Hosting, S3 + CloudFront, nginx, …). Upload the contents of `app/` and set:

| Setting    | Value                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build      | none; publish directory `app`                                                                                                                        |
| MIME types | `.wasm` → `application/wasm`, `.webmanifest` → `application/manifest+json`, `.mjs` → `text/javascript`                                               |
| Cache      | `sw.js`, `index.html`, `manifest.webmanifest`: `Cache-Control: no-cache`; `vendor/*`: long-lived (`max-age=31536000, immutable`)                     |
| Headers    | optional but recommended: the same `Content-Security-Policy`, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options` as in `app/_headers` |
| COOP/COEP  | not needed                                                                                                                                           |

Notes per host:

- **Netlify** reads the same `_headers` file format as Cloudflare Pages.
- **GitHub Pages** cannot set headers; the CSP still applies from the `<meta>` tag in `index.html`, and its default `Cache-Control: max-age=600` means updates can take up to 10 minutes to be noticed.
- **nginx**: make sure `types` includes `application/wasm wasm;` (included in recent `mime.types`), and add the headers with `add_header` in the matching `location` blocks.
- **Firebase Hosting / Vercel**: set the headers in `firebase.json` → `hosting.headers` or `vercel.json` → `headers`.

The `_headers` file is ignored by hosts that do not use it, and the service worker does not cache it.
