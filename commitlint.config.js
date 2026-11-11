// SPDX-License-Identifier: Apache-2.0
// Commit message rules: Conventional Commits 1.0 with 72-character lines.
// See CONTRIBUTING.md ("Commit messages").
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 72],
    'footer-max-line-length': [2, 'always', 72],
  },
};
