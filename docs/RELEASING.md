# 版本号与发布流程

本项目的版本号只有一个来源：**`package.json` 的 `version` 字段**。

- 应用运行时通过 `app.getVersion()` 读取它，显示在侧边栏 / 设置 / 关于页。
- electron-builder 用它生成安装包版本号与文件名。
- GitHub Actions 用它构建安装包；发布 job 会校验 **git tag 必须与 package.json 完全一致**。
- “检查更新”会把 GitHub 最新 Release 的 tag 与这个版本号比较。

---

## 1. 修改版本号

```bash
# 补丁版本：1.0.0 → 1.0.1
npm version patch --no-git-tag-version

# 次版本：1.0.0 → 1.1.0
npm version minor --no-git-tag-version

# 主版本：1.0.0 → 2.0.0
npm version major --no-git-tag-version
```

`--no-git-tag-version` 只修改 `package.json` 和 `package-lock.json`，不自动提交/打标签。

也可以手动编辑 `package.json` 的 `version`，但请同步运行一次 `npm install --package-lock-only`，保持 lockfile 一致。

然后更新 `CHANGELOG.md` 的版本标题与内容。

---

## 2. 提交并打标签

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v1.0.1"
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

标签格式必须是 `v` + `package.json` 的 version，例如 `v1.0.1`。否则发布 job 会直接失败并提示版本不一致。

> 如果你使用 `npm version patch`（不带 `--no-git-tag-version`），npm 会自动创建 commit 和 tag；确认无误后执行 `git push --follow-tags` 即可。

---

## 3. GitHub Actions 会做什么

### 推到 main（不发版）

1. 运行单元测试与 FFmpeg smoke 测试。
2. 构建 macOS arm64、macOS x64、Windows x64。
3. 把安装包上传到 **Actions → 本次运行 → Artifacts**，保留 14 天。

这些是“构建产物”，不会出现在 Releases 页面。

### 推送 `v*` 标签（正式发版）

1. 校验 tag 与 `package.json` 版本一致。
2. 构建三个平台安装包。
3. 创建 GitHub Release，并把 `.dmg` / `.zip` / `.exe` 自动上传。
4. 如果配置了签名 secrets，macOS 会签名+公证，Windows 会签名；否则为未签名包。

不需要手动上传安装包。

---

## 4. 用户如何检测更新

应用内 **设置 → 软件更新 → 检查更新**：

- 点击后请求 GitHub `releases/latest`。
- 用语义化版本比较当前版本与最新 tag。
- 发现新版本时显示下载按钮（优先匹配当前平台的安装包）和发布说明链接。
- 不自动下载、不后台轮询；不点击就不会联网。

这依赖 GitHub Release 的 tag 是规范版本号（如 `v1.0.1`）。

---

## 5. 发布检查清单

- [ ] `package.json` 版本已更新，且与即将推送的 tag 一致。
- [ ] `CHANGELOG.md` 已更新。
- [ ] `npm test` → 通过。
- [ ] `npm run test:smoke` → 通过。
- [ ] 涉及界面/协议：`npm run test:e2e`、`npm run test:ui` → 通过。
- [ ] 本地或 CI 生成的安装包运行 `--self-test` 正常。
- [ ] 用真实素材各跑一次去水印与拼接。
- [ ] 如需签名：GitHub Secrets 已配置（见 [BUILD.md](BUILD.md#8-代码签名与公证)）。
- [ ] 推 tag 后等待 CI 完成，在 Releases 页面确认三个平台附件齐全。

---

## 6. 常见问题

### tag 和 package.json 不一致

```text
Tag v1.0.1 does not match package.json version 1.0.0
```

重新修改版本、提交，删除错误标签后重打：

```bash
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
npm version patch --no-git-tag-version
# 提交后重新打 tag
```

### 想先测试 CI 构建，不创建 Release

直接 push 到 `main`，或手动触发 Actions（Run workflow）。安装包在 Artifacts 中。

### 预发布版本

当前 workflow 把所有 `v*` 标签都当作正式发布。若需要 beta 渠道，建议新增 `v*-beta.*` 的处理逻辑（标记 prerelease、跳过自动更新检测），或先使用 Actions Artifacts 分发测试包。
