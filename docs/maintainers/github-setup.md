# GitHub setup checklist (after the first push)

**This repository was prepared locally; nothing has been pushed or configured on GitHub yet.** After the first push to `https://github.com/hohshen/xixi-beauty-cam`, a maintainer needs to do the items below in the GitHub web UI (or with `gh`). Items are ordered by importance; tick them off as you go.

## 1. First push

- [ ] Add the remote `origin` = `https://github.com/hohshen/xixi-beauty-cam.git` and publish the `main` branch to it with upstream tracking.
- [ ] Confirm the **CI** workflow runs and passes on `main` (Actions tab). The README badge only turns green after this run.
- [x] The action versions pinned in `.github/workflows/ci.yml` (`actions/checkout@v6.0.0`, `actions/setup-node@v6.0.0`) were checked to exist on 2026-11-11. Optional hardening: pin each action to its full commit SHA with the tag as a comment.

## 2. Security

- [ ] **Settings → Security → Private vulnerability reporting: Enable.** `SECURITY.md` and the issue chooser link to it, so this is required.
- [ ] **Settings → Security → Dependabot alerts: Enable**, and **Dependabot security updates: Enable**. (`.github/dependabot.yml` already handles version updates for GitHub Actions.)
- [ ] **Settings → Security → Secret scanning** and **Push protection: Enable** (free for public repositories).
- [ ] **Code scanning (CodeQL): Set up → Default** for JavaScript.
- [ ] **Settings → Actions → General → Workflow permissions:** _Read repository contents_ (the workflow already declares `contents: read`).

## 3. Branch protection for `main`

**Settings → Rules → Rulesets → New branch ruleset** (or classic branch protection), target `main`:

- [ ] Require a pull request before merging (1 approval; dismiss stale approvals on new commits).
- [ ] Require review from Code Owners (`.github/CODEOWNERS` assigns everything to `@hohshen`).
- [ ] Require status checks to pass: **Test and lint (Node LTS)**. Require branches to be up to date.
- [ ] Block force pushes and deletions.
- [ ] Optional: require linear history; require signed commits.

## 4. Repository settings

- [ ] **About:** description "A browser beauty camera that lets you switch the filter off for individual people. Everything runs on-device." Website: leave empty until the hosted version exists.
- [ ] **Topics:** `beauty-camera`, `webcam`, `webgl2`, `mediapipe`, `face-landmarks`, `privacy`, `on-device`, `javascript`.
- [ ] **Features:** Issues on; Discussions on (`SUPPORT.md` mentions it) or edit `SUPPORT.md` if you keep it off; Wiki off; Projects optional.
- [ ] **Pull Requests:** allow squash merging only, default commit message = "Pull request title"; enable "Automatically delete head branches".
- [ ] **Labels:** create `bug`, `enhancement`, `filter` (used by the issue forms), plus `good first issue` and `help wanted`.
- [ ] Social preview image (Settings → General): optional; use an illustration, not a photo of a real person.

## 5. Things only the maintainer can fill in

- [ ] `CODE_OF_CONDUCT.md`: replace the `TODO` in the _Enforcement_ section with a contact method for conduct reports. Do not use a personal address you do not want published.
- [ ] Decide whether the license choice (Apache-2.0, same as MediaPipe) is final before the first release.

## 6. First release

- [ ] Create an annotated tag `v0.1.0` on the release commit and publish the tag to `origin`.
- [ ] Create a GitHub Release from the tag, using the `0.1.0` section of `CHANGELOG.md` as the notes.
- [ ] Later releases: move **Unreleased** entries under a new version heading in `CHANGELOG.md`, bump `version` in `package.json`, tag `vX.Y.Z`.

## Not set up on purpose

- **npm publishing:** `package.json` is `"private": true` so the package cannot be published to npm by accident. It does not affect the open-source license.
- **Hosting (e.g. Cloudflare Pages):** planned separately. When added, the page must still make only the requests listed in [docs/architecture.md](../architecture.md#network-requests).
