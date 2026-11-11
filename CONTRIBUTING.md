# Contributing to xixi-beauty-cam

Thanks for helping! This guide covers, in order: the dev setup, tests and lint, commit messages, the pull request flow, and how to contribute a filter. By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

**Short version:** fork → branch → change → `npm test && npm run lint` → Conventional Commit → pull request.

## Ground rules

- **Images stay on the device.** Do not add analytics, telemetry, error reporting, uploads or any network request beyond the pinned library and model. PRs that send camera frames, photos, landmarks or masks anywhere will not be merged.
- **Pin every external URL** to an exact version (no `@latest`, no major-only tags), and list new third-party components with their license in `README.md` and `NOTICE`. Only use components whose license allows redistribution and this use.
- **No real people in the repo.** Test images, screenshots and fixtures must not contain identifiable faces. Use drawn or generated cartoon faces (see `tests/browser/warp-test.html`).
- **No new runtime dependencies** without discussing it in an issue first. The app is plain ES modules served as static files; there is no build step.

## Development setup

Requirements: a recent Chrome (or another browser with WebGL2), Node.js 20 or newer (CI uses the current LTS), and Python 3 or any static file server.

```sh
git clone https://github.com/<your-account>/xixi-beauty-cam.git
cd xixi-beauty-cam
npm ci                                           # dev tools only: ESLint, Prettier
python3 -m http.server 8000 --directory app      # or: npm start
```

Open <http://localhost:8000/>. URL options: `?w=640&h=480` sets the camera resolution, `?autostart` starts the camera on load, `?jitter=0` turns off the simulated camera shake in photo mode.

Repository layout:

| Path       | Contents                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`     | The web app (static files). `app/filters/` holds the built-in color filters and `app/beauty/` the built-in beauty presets, each with an index and a JSON Schema. |
| `tests/`   | Node tests (`*.test.mjs`) and the browser warp test (`tests/browser/warp-test.html`).                                                                            |
| `scripts/` | `validate-presets.mjs`: schema validation for filter and beauty preset files.                                                                                    |
| `docs/`    | User and contributor documentation. `docs/maintainers/` is for maintainers.                                                                                      |

Architecture and data flow: [docs/architecture.md](docs/architecture.md).

## Tests and lint

```sh
npm test                 # node unit tests + filter / beauty preset schema validation (no browser needed)
npm run lint             # ESLint + Prettier check
npm run format           # apply Prettier formatting
```

CI runs the same commands on every push and pull request.

The warp and shader code also has a browser test that draws cartoon faces with synthetic landmarks and compares pixels. Serve the repo root and open it in Chrome:

```sh
python3 -m http.server 8001
# open http://localhost:8001/tests/browser/warp-test.html — every line should be ✅
```

For UI changes, please also walk through the relevant steps in the [manual test checklist](docs/testing.md), and use **Difference ×20** view to confirm people with beauty off stay pure black.

Every source file starts with an SPDX header:

```js
// SPDX-License-Identifier: Apache-2.0
```

(`/* … */` in CSS, `<!-- … -->` in HTML, `#` in YAML.) JSON files cannot carry comments and are covered by the repository license, except built-in filters, which declare `CC0-1.0` in their `license` field.

## Commit messages

Use [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/). CI checks every commit in a pull request with [commitlint](https://commitlint.js.org/) (`@commitlint/config-conventional`, rules in [commitlint.config.js](commitlint.config.js)).

```
<type>(<optional scope>): <subject>

<optional body: why the change is needed>

<optional footer, e.g. BREAKING CHANGE: ...>
```

- **Subject:** English, imperative mood ("add", not "added"), lower case first letter, no trailing period. The whole first line stays within 72 characters.
- **Body:** separated from the subject by a blank line; explain _why_, not _what_. Wrap lines at 72 characters.
- **One commit, one change.** Split unrelated changes into separate commits; each commit should pass `npm test` and `npm run lint` on its own.

Check your last commit locally with `npm run lint:commits`, or a range with `npx commitlint --from origin/main --to HEAD`.

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `style`, `build`, `ci`, `chore`. Useful scopes: `renderer`, `warp`, `tracker`, `filters`, `ui`. Examples:

```
feat(filters): add "soft-glow" built-in filter
fix(tracker): keep IDs stable when two faces swap places
docs: explain the difference view in the README
```

A commit with a body:

```
fix(renderer): clamp brightening before the color grade

Strong brightening pushed skin values above 1.0, so the grade
afterwards clipped highlights to white. Clamp first so filters see
the same range they were designed for.
```

Mark breaking changes (for example, an incompatible filter format change) with `!` after the type and a `BREAKING CHANGE:` footer.

## Pull request flow

1. For anything bigger than a small fix, open an issue first so we can agree on the approach.
2. Fork the repository and create a branch from `main`, e.g. `feat/soft-glow-filter`.
3. Make focused changes; add or update tests when behavior changes.
4. Run `npm test` and `npm run lint` locally.
5. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
6. Open a pull request and fill in the template. Include before/after evidence for visual changes using cartoon or synthetic faces only, plus fps numbers for performance-sensitive changes (renderer, warp, mask).
7. A maintainer reviews it. CI must pass before merging. We squash-merge, so the PR title should also follow Conventional Commits.

## Contributing a filter or beauty preset

Filters (whole-frame color grading) and beauty presets (face-only retouching) are data files, so adding one needs no JavaScript changes. The difference and both formats: [docs/filters.md](docs/filters.md).

1. Make it in the app (open the _Filter_ or _Beauty_ tab → _Advanced_ → save → export) or write it by hand.
2. Pick a unique `id` (lowercase letters, digits and `-`). Name a filter `<id>.xixi-filter.json` and put it in `app/filters/`; name a beauty preset `<id>.xixi-beauty.json` and put it in `app/beauty/`.
3. Add the file name to the index in the same folder (`app/filters/index.json` or `app/beauty/index.json`). The order is the order in the bar.
4. Set `"license": "CC0-1.0"` (required for built-in filters) and put your name or handle in `author`.
5. Validate: `npm run validate:presets` (or `node scripts/validate-presets.mjs path/to/your-file.json` for a single file), then `npm test`.
6. Open the app and look at the result on a few faces. In the PR, describe the intended look and the parameter values. You can also start with the **New filter** issue form if you only want to propose an idea.

## Reporting bugs and security issues

- Bugs and feature requests: use the [issue forms](https://github.com/hohshen/xixi-beauty-cam/issues/new/choose).
- Security vulnerabilities: **do not open a public issue.** Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), and built-in filter and beauty preset files under CC0-1.0.
