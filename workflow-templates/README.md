# Actions 工作流模板

这是两份 GitHub Actions 配置模板。当前仓库的推送令牌没有 `workflow` 权限，
无法直接写入 `.github/workflows/`，因此放在这里备用。

## 启用方法

在 GitHub 网页端（或有 workflow 权限的本地 git）操作：

1. 在仓库根目录建 `.github/workflows/`
2. 把 `ci.yml` 和 `release.yml` 复制过去
3. `ci.yml`：每次 push / PR 自动跑 `node --check main.js` 和 `node scripts/test-parse.js`
4. `release.yml`：打 tag（如 `0.1.0`）时自动把 `manifest.json` / `main.js` / `styles.css`
   打成 `beikao-helper.zip` 并创建 Release

启用后，README 里「到 Releases 下载」的方式就可用了。
