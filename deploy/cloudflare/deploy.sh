#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Deploy app/ to Cloudflare Pages (project: xixi-beauty-cam).
# Run it from the repository root every time you want to publish an update:
#
#   deploy/cloudflare/deploy.sh             # main → production; other branches → preview
#   deploy/cloudflare/deploy.sh --preview   # always a preview deployment
#   deploy/cloudflare/deploy.sh --dry-run   # checks only; prints the Wrangler command
#
# See deploy/cloudflare/README.md. This script never stores credentials: it uses your
# `npx wrangler login` session, or CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from the environment.

set -euo pipefail

readonly PROJECT_NAME="xixi-beauty-cam"
readonly PRODUCTION_BRANCH="main"
readonly WRANGLER_VERSION="4.78.0"
readonly CONFIG_DIR="deploy/cloudflare"

preview=false
dry_run=false

usage() {
  cat <<'USAGE'
用法：deploy/cloudflare/deploy.sh [--preview] [--dry-run] [--help]

把 app/ 部署到 Cloudflare Pages（專案 xixi-beauty-cam）。請在 repo 根目錄執行。

  （不加參數）  在 main 分支：正式部署；在其他分支：自動改成 preview 部署
  --preview     強制 preview 部署（在 main 也一樣）
  --dry-run     只跑所有檢查，印出將執行的 wrangler 指令，不部署、不連 Cloudflare
  --help        顯示本說明

部署前依序檢查：在 repo 根目錄、工作區乾淨、分支、npm test、npm run lint、
預設檔驗證、app/sw.js 的 CACHE_VERSION 與 package.json 版本一致。任何一步失敗就停。

登入：優先用 `npx wrangler login` 的登入；也可以在 shell 設定環境變數
CLOUDFLARE_API_TOKEN 與 CLOUDFLARE_ACCOUNT_ID（不要寫進任何檔案）。
說明見 deploy/cloudflare/README.md。
USAGE
}

fail() {
  printf '\n✗ %s\n' "$1" >&2
  shift
  local line
  for line in "$@"; do
    printf '  %s\n' "${line}" >&2
  done
  exit 1
}

step() {
  printf '\n▶ %s\n' "$1"
}

ok() {
  printf '  ✓ %s\n' "$1"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --preview) preview=true ;;
    --dry-run) dry_run=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "不認得的參數：$1" "可用的參數只有 --preview、--dry-run、--help。"
      ;;
  esac
  shift
done

# 1. Location -------------------------------------------------------------------
step "檢查位置"
command -v git > /dev/null 2>&1 || fail "找不到 git。" "請先安裝 git（macOS：執行 xcode-select --install）。"
root="$(git rev-parse --show-toplevel 2> /dev/null || true)"
if [ -z "${root}" ] || [ "$(pwd -P)" != "$(cd "${root}" && pwd -P)" ]; then
  fail "請在 repo 根目錄執行（目前在 $(pwd)）。" \
    "先 cd 到 xixi-beauty-cam 的根目錄（有 package.json 與 app/ 的那一層），再執行 deploy/cloudflare/deploy.sh。"
fi
if [ ! -f package.json ] || [ ! -d app ] || [ ! -f "${CONFIG_DIR}/wrangler.toml" ]; then
  fail "這裡不像 xixi-beauty-cam 的 repo 根目錄：缺 package.json、app/ 或 ${CONFIG_DIR}/wrangler.toml。" \
    "確認你 cd 到的是 xixi-beauty-cam，而且已切到含 deploy/cloudflare/ 的分支。"
fi
ok "repo 根目錄：${root}"

# 2. Clean working tree ----------------------------------------------------------
step "檢查工作區"
dirty="$(git status --porcelain)"
if [ -n "${dirty}" ]; then
  printf '%s\n' "${dirty}" | sed 's/^/    /' >&2
  fail "工作區有未提交的變更（上面列出的檔案）。" \
    "部署的內容要能對到一個 commit。請先 git add 並 git commit，或用 git stash push -u 暫存，再重跑。"
fi
ok "工作區乾淨"

# 3. Branch -------------------------------------------------------------------------
step "檢查分支"
branch="$(git symbolic-ref --quiet --short HEAD || true)"
if [ -z "${branch}" ]; then
  fail "目前不在任何分支上（detached HEAD）。" "請先 git switch ${PRODUCTION_BRANCH}（正式部署）或 git switch <分支>（preview）。"
fi
if [ "${branch}" = "${PRODUCTION_BRANCH}" ] && [ "${preview}" = false ]; then
  deploy_branch="${PRODUCTION_BRANCH}"
  mode="正式（production）"
elif [ "${branch}" = "${PRODUCTION_BRANCH}" ]; then
  # A preview from main needs a branch name other than the production branch.
  deploy_branch="preview"
  mode="預覽（preview，--preview）"
else
  deploy_branch="${branch}"
  if [ "${preview}" = true ]; then
    mode="預覽（preview，--preview）"
  else
    mode="預覽（preview，因為不在 ${PRODUCTION_BRANCH} 分支）"
  fi
fi
ok "分支 ${branch} → 部署為 ${mode}，Cloudflare 分支名 ${deploy_branch}"

# 4. Tests, lint, preset validation -------------------------------------------------
step "跑測試、lint 與預設檔驗證"
command -v node > /dev/null 2>&1 || fail "找不到 node。" "請安裝 Node.js 20 以上（https://nodejs.org/ 下載 LTS 版），再重跑。"
command -v npm > /dev/null 2>&1 || fail "找不到 npm。" "npm 隨 Node.js 一起安裝；請重新安裝 Node.js LTS。"
command -v npx > /dev/null 2>&1 || fail "找不到 npx。" "npx 隨 Node.js 一起安裝；請重新安裝 Node.js LTS。"
if [ ! -d node_modules ]; then
  fail "還沒安裝開發工具（沒有 node_modules/）。" "請先在 repo 根目錄執行 npm ci，再重跑。"
fi
npm test || fail "npm test 沒通過。" "看上面的錯誤訊息修好後，commit 再重跑。"
ok "npm test 通過"
npm run lint || fail "npm run lint 沒通過。" "格式問題可執行 npm run format 自動修正，commit 後再重跑。"
ok "npm run lint 通過"
npm run validate:presets || fail "預設檔驗證沒通過。" "依上面指出的檔案與欄位修正 app/filters/ 或 app/beauty/ 的預設檔。"
ok "預設檔驗證通過"

# 5. Service worker cache version ---------------------------------------------------
step "檢查快取版本"
pkg_version="$(node -p "require('./package.json').version")"
cache_version="$(sed -n "s/^const CACHE_VERSION = '\([^']*\)';.*/\1/p" app/sw.js | head -n 1)"
if [ -z "${cache_version}" ]; then
  fail "在 app/sw.js 找不到 CACHE_VERSION。" "app/sw.js 要有一行 const CACHE_VERSION = 'xixi-beauty-cam-<版本>-<序號>';"
fi
case "${cache_version}" in
  "xixi-beauty-cam-${pkg_version}-"[0-9]*) ;;
  *)
    fail "app/sw.js 的 CACHE_VERSION（${cache_version}）和 package.json 的版本（${pkg_version}）不一致。" \
      "不一致時使用者的手機會一直用舊的離線快取。請先 bump 版本：" \
      "  1. package.json 的 version 改成新版本（例如 npm version patch --no-git-tag-version）" \
      "  2. app/sw.js 的 CACHE_VERSION 改成 xixi-beauty-cam-<新版本>-1" \
      "  3. CHANGELOG.md 補上這一版，commit 後再重跑。"
    ;;
esac
ok "CACHE_VERSION ${cache_version} 與 package.json ${pkg_version} 一致"

# 6. Deploy ----------------------------------------------------------------------------
commit_hash="$(git rev-parse HEAD)"
commit_message="$(git log -1 --format=%s)"
cmd=(npx --yes "wrangler@${WRANGLER_VERSION}" pages deploy ../../app
  --project-name "${PROJECT_NAME}"
  --branch "${deploy_branch}"
  --commit-hash "${commit_hash}"
  --commit-message "${commit_message}")

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  auth="環境變數 CLOUDFLARE_API_TOKEN"
else
  auth="npx wrangler login 的登入"
fi

step "部署"
printf '  版本：%s（%s）\n  方式：%s\n  登入：%s\n  指令（在 %s 執行）：\n   ' \
  "${pkg_version}" "${commit_hash:0:7}" "${mode}" "${auth}" "${CONFIG_DIR}"
printf ' %q' "${cmd[@]}"
printf '\n'

if [ "${dry_run}" = true ]; then
  printf '\n✓ --dry-run：所有檢查都通過，沒有部署。拿掉 --dry-run 就會真的部署。\n'
  exit 0
fi

log="$(mktemp "${TMPDIR:-/tmp}/xixi-deploy.XXXXXX")"
trap 'rm -f "${log}"' EXIT
if ! (cd "${CONFIG_DIR}" && "${cmd[@]}") 2>&1 | tee "${log}"; then
  fail "wrangler 部署失敗。" \
    "常見原因與修法：" \
    "  - 沒登入或登入過期：執行 npx wrangler@${WRANGLER_VERSION} login 後重跑" \
    "  - 找不到專案：第一次要先建立，執行 npx wrangler@${WRANGLER_VERSION} pages project create ${PROJECT_NAME} --production-branch ${PRODUCTION_BRANCH}" \
    "  - 用 API token：token 要有 Cloudflare Pages:Edit 權限，並同時設定 CLOUDFLARE_ACCOUNT_ID" \
    "其他錯誤見 deploy/cloudflare/README.md 的「常見錯誤」。"
fi

url="$(grep -Eo 'https://[A-Za-z0-9.-]+\.pages\.dev' "${log}" | tail -n 1 || true)"
printf '\n✓ 部署完成\n  版本：%s（commit %s）\n  方式：%s\n' "${pkg_version}" "${commit_hash:0:7}" "${mode}"
if [ -n "${url}" ]; then
  printf '  這次部署的網址：%s\n' "${url}"
fi
if [ "${deploy_branch}" = "${PRODUCTION_BRANCH}" ]; then
  printf '  正式網址：https://%s.pages.dev/\n' "${PROJECT_NAME}"
else
  printf '  分支預覽網址：https://<分支別名>.%s.pages.dev/（別名由 Cloudflare 依分支名 %s 產生）\n' "${PROJECT_NAME}" "${deploy_branch}"
fi
