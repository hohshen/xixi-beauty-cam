<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- PR title must follow Conventional Commits, e.g. "feat(filters): add soft-glow filter". -->

## What and why

<!-- What does this change and why? Link the issue: "Closes #123". -->

## How it was tested

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `tests/browser/warp-test.html` passes in Chrome (if renderer, warp or mask changed)
- [ ] Manually checked the relevant steps in `docs/testing.md` (if UI changed)

<!-- For visual or performance changes, add before/after evidence (cartoon or synthetic faces only) and fps numbers with resolution and device. -->

## Checklist

- [ ] No new network requests, analytics or uploads; images stay on the device
- [ ] New external URLs are pinned to an exact version and listed in `README.md` and `NOTICE`
- [ ] No photos of real people, personal data or secrets added
- [ ] New source files have an `SPDX-License-Identifier: Apache-2.0` header
- [ ] `CHANGELOG.md` updated under **Unreleased** (for user-visible changes)
- [ ] Docs updated (README / `docs/`) if behavior changed
