# Security Policy

## Supported versions

xixi-beauty-cam is an early-stage project. Only the latest release and the `main` branch receive security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public issues, discussions or pull requests.**

Use GitHub's **Private Vulnerability Reporting** instead:

1. Go to the repository's [**Security** tab](https://github.com/hohshen/xixi-beauty-cam/security).
2. Click **Report a vulnerability** ([direct link](https://github.com/hohshen/xixi-beauty-cam/security/advisories/new)).
3. Describe the issue, the affected version or commit, steps to reproduce, and the impact you expect.

Only the maintainers can see the report. We aim to acknowledge it within 7 days and to agree on a fix and disclosure timeline with you. We are happy to credit you in the advisory unless you prefer to stay anonymous.

## Scope

Things we especially want to hear about:

- Any way camera frames, photos, face landmarks or masks could leave the user's device.
- A crafted `.xixi-filter.json` or `.xixi-beauty.json` file (or index) that executes code, injects HTML, loads remote resources, or breaks the page for other presets.
- Loading of unpinned or unexpected third-party scripts.

Vulnerabilities in MediaPipe itself should be reported to the [MediaPipe project](https://github.com/google-ai-edge/mediapipe/security).

Please do not include photos or videos of real people in a report; use synthetic images.
