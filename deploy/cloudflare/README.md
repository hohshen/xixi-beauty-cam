# 部署到 Cloudflare Pages

**每次更新只要在 repo 根目錄執行一行：`deploy/cloudflare/deploy.sh`。** 在 `main` 分支會正式部署到 `https://xixi-beauty-cam.pages.dev/`，在其他分支會自動改成預覽部署。腳本先跑完所有檢查（工作區乾淨、測試、lint、快取版本），任何一步失敗就停下並用中文說明怎麼修。第一次使用前要先做下面三步設定。

| 檔案            | 用途                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `deploy.sh`     | 檢查並部署；Wrangler 版本固定在腳本裡（`WRANGLER_VERSION`）                                             |
| `wrangler.toml` | Pages 專案名 `xixi-beauty-cam`、輸出資料夾 `../../app`、`compatibility_date`；不含帳號 ID、token 或金鑰 |
| `README.md`     | 本說明                                                                                                  |

## 第一次設定（三步）

1. **安裝 Node.js 20 以上**：到 <https://nodejs.org/> 下載 LTS 版安裝。裝好後在 repo 根目錄執行 `npm ci` 安裝開發工具（測試與 lint 用）。
2. **登入 Cloudflare**：執行 `npx wrangler@4.78.0 login`，瀏覽器會開 Cloudflare 的授權頁，按允許。登入資訊存在你自己的電腦（Wrangler 的使用者設定資料夾），不會進 repo。
3. **建立 Pages 專案**（只做一次）：

   ```sh
   npx wrangler@4.78.0 pages project create xixi-beauty-cam --production-branch main
   ```

完成後就可以部署：

```sh
cd <xixi-beauty-cam 的路徑>
git switch main
deploy/cloudflare/deploy.sh --dry-run   # 先試跑：只檢查、印出指令
deploy/cloudflare/deploy.sh             # 真的部署
```

## 之後每次更新

1. 改 `app/` 裡的檔案後，**bump 版本**：`package.json` 的 `version`（例如 `npm version patch --no-git-tag-version`）、`app/sw.js` 的 `CACHE_VERSION` 改成 `xixi-beauty-cam-<新版本>-1`、`CHANGELOG.md` 補一節。版本沒對上腳本會停下，因為使用者的手機會一直用舊的離線快取。
2. commit。
3. 執行：

   ```sh
   deploy/cloudflare/deploy.sh
   ```

腳本最後會印出這次部署的網址與版本。

## 參數

| 指令                                    | 行為                                                          |
| --------------------------------------- | ------------------------------------------------------------- |
| `deploy/cloudflare/deploy.sh`           | `main`：正式部署；其他分支：預覽部署                          |
| `deploy/cloudflare/deploy.sh --preview` | 強制預覽部署（在 `main` 時用 Cloudflare 分支名 `preview`）    |
| `deploy/cloudflare/deploy.sh --dry-run` | 只跑檢查、印出將執行的 wrangler 指令，不部署、不連 Cloudflare |
| `deploy/cloudflare/deploy.sh --help`    | 說明                                                          |

預覽部署的網址是 `https://<分支別名>.xixi-beauty-cam.pages.dev/`（別名由 Cloudflare 從分支名產生，例如 `feat/pwa-mobile` → `feat-pwa-mobile`），用 HTTPS，適合拿手機測試。

## 腳本做了什麼

依序檢查，任何一步失敗就停：

1. 在 repo 根目錄執行。
2. 工作區乾淨（沒有未提交的變更），部署內容才能對到一個 commit。
3. 分支：`main` 才正式部署，其他分支或加 `--preview` 時是預覽部署。
4. `npm test`、`npm run lint`、`npm run validate:presets`。
5. `app/sw.js` 的 `CACHE_VERSION` 是 `xixi-beauty-cam-<package.json 版本>-<序號>`。
6. 在 `deploy/cloudflare/` 執行 `npx --yes wrangler@4.78.0 pages deploy ../../app --project-name xixi-beauty-cam --branch <分支> --commit-hash <git sha> --commit-message <commit 標題>`。

## 登入方式

- **預設**：用 `npx wrangler@4.78.0 login` 的登入。
- **API token**（例如在別台電腦或自動化）：在 shell 設定環境變數後執行，不要寫進任何檔案：

  ```sh
  export CLOUDFLARE_API_TOKEN=<你的 token>     # 權限：Account → Cloudflare Pages → Edit
  export CLOUDFLARE_ACCOUNT_ID=<你的帳號 ID>
  deploy/cloudflare/deploy.sh
  ```

## 回到上一版（rollback）

正式網址出問題時，在 Cloudflare 後台切回之前的部署，不用重新部署：

1. 登入 Cloudflare 後台 → **Workers & Pages** → 點 `xixi-beauty-cam`。
2. 切到 **Deployments** 分頁，在 **Production** 的部署清單找到要回去的那一版（看 commit 與時間）。
3. 按那一列右邊的 **⋯** → **Rollback to this deployment**，確認。

正式網址會立刻改成那一版。使用者的手機下次開啟時會拿到那一版的 `sw.js`，在背景下載後提示重新整理。之後修好再用 `deploy/cloudflare/deploy.sh` 部署新版本（版本號要比出問題的那版新）。後台的按鈕名稱依 Cloudflare 官方文件；介面若改版以後台為準（待查證）。

## 常見錯誤

| 訊息                                                         | 修法                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 請在 repo 根目錄執行                                         | `cd` 到有 `package.json` 與 `app/` 的那一層再執行                                                                     |
| 工作區有未提交的變更                                         | `git add` 後 `git commit`，或 `git stash push -u` 暫存                                                                |
| 還沒安裝開發工具（沒有 `node_modules/`）                     | 執行 `npm ci`                                                                                                         |
| `CACHE_VERSION` 和 `package.json` 的版本不一致               | 照「之後每次更新」第 1 步 bump 版本後 commit                                                                          |
| `npm run lint` 沒通過                                        | `npm run format` 自動修正格式，commit 後重跑                                                                          |
| `Not logged in` / `Authentication error`                     | 執行 `npx wrangler@4.78.0 login`；用 token 時確認 token 有 Cloudflare Pages Edit 權限，且有設 `CLOUDFLARE_ACCOUNT_ID` |
| `Project not found`                                          | 還沒建立專案：執行第一次設定第 3 步                                                                                   |
| 部署成功但手機還是舊版                                       | 關掉分頁或 app 再開一次；service worker 會在背景下載新版後提示重新整理。若一直是舊版，確認這次有 bump `CACHE_VERSION` |
| `Error: EPERM` 寫不進 `~/Library/Preferences/.wrangler/logs` | Wrangler 寫不進自己的記錄資料夾，通常是在受限的環境（沙箱）執行；改在一般終端機執行                                   |

Pages 的回應標頭（CSP、快取）來自 `app/_headers`，說明見 [`docs/deploy.md`](../../docs/deploy.md)。
