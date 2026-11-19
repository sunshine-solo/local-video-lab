# 构建、打包与发布

本文档覆盖从源码开发到生成 Windows / macOS 安装包的完整流程，包括跨平台打包、签名、公证、CI 与替换 FFmpeg。

---

## 1. 环境要求

### 通用

| 项目 | 要求 |
| --- | --- |
| Node.js | **≥ 22.12**（CI 使用 22） |
| npm | ≥ 10 |
| 磁盘 | 建议预留 2GB 以上（Electron + FFmpeg 二进制 + 安装包） |
| 网络 | 首次 `npm install` 与跨平台打包需要下载二进制 |

### macOS

- macOS 13+（Electron 45 的系统要求），Intel 或 Apple Silicon。
- 可选：`xcode-select --install`（DMG / 图标转换通常由 electron-builder 自带工具完成）。
- 打 x64 包不需要 Rosetta；**运行** x64 包才需要 Rosetta。

### Windows

- Windows 10/11 x64。
- 不需要 Visual Studio：本项目没有原生 Node 模块。
- 建议使用 PowerShell 7，并确保长路径支持已开启（一般默认开启）。

### Linux

可以运行 `npm run dev` 进行开发，但第一版没有正式 Linux 安装包目标。若要添加，可参考 electron-builder 的 AppImage/deb 配置；FFmpeg 预编译二进制同样可用。

---

## 2. 安装依赖

```bash
npm install
```

安装过程会：

1. 下载 Electron 运行时。
2. 由 `ffmpeg-static` 下载**当前平台**的 FFmpeg。
3. 安装 `@ffprobe-installer/ffprobe` 的**当前平台**包。
4. 安装 `sharp`（仅用于生成图标）。

这些二进制仅用于开发与测试。安装包中的二进制由打包钩子按目标平台重新准备，因此应用包不包含 `node_modules`。

> 如果公司网络需要代理，请配置 `HTTPS_PROXY`；Electron 下载镜像可设置 `ELECTRON_MIRROR`。详见[故障排查](#12-故障排查)。

---

## 3. 构建流程

```bash
npm run build
```

产物：

```text
out/
├── main/index.js        # 主进程（CommonJS bundle）
├── preload/index.js     # preload（contextBridge）
└── renderer/            # Vue 3 静态资源（相对路径加载）
```

- 主进程与 preload 以 **CommonJS 源码**编写，通过 `@rollup/plugin-commonjs` 打包成单文件；Electron 以 CJS 加载。
- 渲染层由 Vite 构建，资源路径为相对路径，因此可以通过 `file://` 加载。
- `ffmpeg-static` 与 `@ffprobe-installer/ffprobe` 被标记为 external，不进入 bundle。

---

## 4. 本地开发

```bash
npm run dev
```

- 主进程 / preload 修改会自动重启 Electron。
- 渲染层支持 Vite HMR。
- 开发者工具：菜单 **视图 → 开发者工具**（仅开发模式显示）。

生产构建预览：

```bash
npm run preview
```

---

## 5. 打包安装包

### 5.1 macOS

```bash
# 当前架构（Apple Silicon 上得到 arm64）
npm run dist:mac

# 指定架构
npm run dist:mac:arm64
npm run dist:mac:x64
```

输出目录 `release/`：

```text
local-video-lab-1.0.0-mac-arm64.dmg
local-video-lab-1.0.0-mac-arm64.zip
local-video-lab-1.0.0-mac-x64.dmg
local-video-lab-1.0.0-mac-x64.zip
```

- 默认**不签名、不公证**（`identity: null`），适合开源直接分发。
- 在 Apple Silicon 上交叉打 x64 包时，`scripts/before-pack.cjs` 会下载 x86_64 的 FFmpeg / FFprobe 并缓存到 `.cache/binaries`。
- **不支持 universal 单包**：构建时会明确报错，请分别发布 arm64 与 x64。

### 5.2 Windows

在 Windows 上：

```powershell
npm ci
npm run dist:win
```

输出：

```text
release\local-video-lab-1.0.0-win-x64.exe
```

安装包特性（`electron-builder.yml` → `nsis`）：

- 非一键安装，允许选择安装目录。
- 创建桌面与开始菜单快捷方式。
- 卸载时保留用户设置（`deleteAppDataOnUninstall: false`）。

### 5.3 跨平台打包说明

`scripts/before-pack.cjs` 会按**目标平台/架构**准备二进制：

- 本机平台：直接从 `node_modules` 复制，无需联网。
- 交叉平台：FFmpeg 从 `ffmpeg-static` 的 GitHub release 下载，FFprobe 从 npm registry 的平台包下载（压缩 tarball，失败时回退 unpkg）；下载结果缓存到 `.cache/binaries`。

因此：

| 场景 | 是否推荐 | 说明 |
| --- | --- | --- |
| 在 Apple Silicon 打 mac x64 | ✅ | 已验证；下载 x64 二进制 |
| 在 Windows 打 Windows 包 | ✅ | CI 使用该方式 |
| 在 macOS 打 Windows 包 | ⚠️ | 二进制会正确准备；NSIS 需要 x86_64 的 `makensis`。Apple Silicon 未安装 Rosetta 时会报 `Bad CPU type in executable`（-86），请改用 Windows / CI，或安装 Rosetta |
| 在 macOS 打 Linux 包 | ⚠️ | 第一版未作为正式目标 |

### 5.4 打包钩子做了什么

`electron-builder.yml`：

```yaml
beforePack: scripts/before-pack.cjs
extraResources:
  - from: build/staged-bin
    to: bin
```

流程：

1. `beforePack` 根据 `context.electronPlatformName` 和 `context.arch` 准备：
   - `ffmpeg` / `ffmpeg.exe`
   - `ffprobe` / `ffprobe.exe`
   - `LICENSE-ffmpeg.txt`
   - `binaries.json`（记录来源与版本）
2. electron-builder 将 `build/staged-bin` 复制到应用包的 `resources/bin`。
3. 运行时 `src/main/ffmpeg/binaries.js` 优先使用 `process.resourcesPath/bin`。

缓存目录 `.cache/binaries` 不会提交到 Git；删除后可重新下载。

### 5.5 验证安装包

macOS：

```bash
"/path/to/Local Video Lab.app/Contents/MacOS/Local Video Lab" --self-test
```

Windows：

```powershell
& "C:\path\to\Local Video Lab.exe" --self-test
```

正常输出示例：

```json
{
  "ok": true,
  "info": {
    "ffmpegPath": ".../Resources/bin/ffmpeg",
    "ffprobePath": ".../Resources/bin/ffprobe",
    "ffmpegVersion": "6.0",
    "ffprobeVersion": "n4.4.1",
    "hardwareEncoder": "h264_videotoolbox",
    "hardwareEncoderLabel": "Apple VideoToolbox",
    "error": ""
  }
}
```

也可以检查二进制架构：

```bash
# macOS
file "Local Video Lab.app/Contents/Resources/bin/ffmpeg"
# arm64 包应显示 arm64，x64 包应显示 x86_64
```

首次启动完整界面后，进入 **设置** 查看引擎状态，并用一段短视频执行一次去水印与拼接。

---

## 6. GitHub Actions

仓库自带 `.github/workflows/build.yml`：

- `test`：在 macOS 上运行单元测试与真实 FFmpeg 冒烟测试。
- `build` 矩阵：
  - `macos-15-intel` → `npm run dist:mac:x64`
  - `macos-15` → `npm run dist:mac:arm64`
  - `windows-latest` → `npm run dist:win`
- 上传产物为 Actions Artifacts。
- 推送 `v*` 标签时，`release` job 会自动创建 GitHub Release 并附加 DMG / ZIP / EXE。

### 触发方式

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 注意事项

- Runner 标签会随 GitHub 政策变化。如果 `macos-15-intel` 不再可用，请替换为当时的 Intel runner 标签（例如 `macos-13`），或使用自托管 Mac。
- 发布包默认未签名。Release 说明中已提示 macOS 的 `xattr` 命令与 Windows SmartScreen。
- 如果仓库启用了 Release 保护或需要环境审批，请相应调整 workflow 权限。
- `npm ci` 使用 `package-lock.json`；修改依赖后请把 lockfile 一并提交。

---

## 7. 发布检查清单

发布前逐项确认：

- [ ] 仓库地址已正确配置为 `sunshine-solo/local-video-lab`（`package.json`、`src/main/constants.js`、README）。
- [ ] 如需更换 `appId`，修改 `electron-builder.yml`。
- [ ] 修改 `package.json` 的 `version` 与 `CHANGELOG.md`（详见 [RELEASING.md](RELEASING.md)）。
- [ ] 更新应用名称 / 图标（见下文）。
- [ ] `npm test`、`npm run test:smoke`、`npm run test:e2e`、`npm run test:ui` 全部通过。
- [ ] 在目标平台实际安装并运行 `--self-test`。
- [ ] 用真实素材各跑一次去水印与拼接，确认输出可播放、体积合理。
- [ ] 如需消除 Gatekeeper / SmartScreen 提示，已配置签名与公证（见第 8 节）。
- [ ] 检查 `THIRD_PARTY_NOTICES.md` 是否仍然准确。
- [ ] 推送 tag，等待 CI 生成 Release。

---

## 8. 代码签名与公证

### 先说结论

**没有受信任的证书，就无法让 macOS Gatekeeper 或 Windows SmartScreen 完全不提示。** 自签名证书、ad-hoc 签名、改文件名都不能解决“其他用户下载后首次打开”的信任问题。

要做到“安装后直接打开、不出现警告”，需要：

| 平台 | 需要什么 | 大致成本 |
| --- | --- | --- |
| macOS | Apple Developer Program + Developer ID Application 证书 + 公证 | US$99/年 |
| Windows | 受信任的代码签名证书（OV 或 EV） | 约 US$200–500/年，EV 更快建立 SmartScreen 信誉 |

没有证书时，用户可以右键打开（macOS）或“更多信息 → 仍要运行”（Windows），或者执行 `xattr` 命令；这些已写在 README。

项目已经准备好签名/公证的构建配置，**拿到证书后只需配置 GitHub Secrets，不需要改代码**。

---

### 8.1 macOS 签名 + 公证

#### 准备

1. 加入 [Apple Developer Program](https://developer.apple.com/programs/)。
2. 在 Apple Developer 后台创建 **Developer ID Application** 证书，导出为 `.p12`。
3. 在 [appleid.apple.com](https://appleid.apple.com/) 生成 **App 专用密码**。
4. 记下 Team ID（Apple Developer 后台右上角）。

#### 本地构建

```bash
export CSC_LINK=/absolute/path/to/DeveloperID.p12
export CSC_KEY_PASSWORD='p12-password'
export CSC_NAME='Developer ID Application: Your Name (TEAMID)'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='app-specific-password'
export APPLE_TEAM_ID='TEAMID'

npm run build
npx electron-builder --mac --arm64 --config electron-builder.signed.yml
npx electron-builder --mac --x64   --config electron-builder.signed.yml
```

`electron-builder.signed.yml` 继承默认配置，并启用：

- `hardenedRuntime: true`
- `entitlements` / `entitlementsInherit`
- `notarize: true`（需同时设置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`）
- 使用 `CSC_NAME` 指定的证书

electron-builder 会先签名（包括 `resources/bin` 下的 FFmpeg/FFprobe），再通过 `notarytool` 提交公证并自动 stapling。`scripts/after-pack.cjs` 会在主应用签名前单独签名这两个二进制，避免公证因“包含未签名可执行文件”失败。首次公证通常需要几分钟。

#### CI 构建

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | `.p12` 的 base64：`base64 -i cert.p12 \| pbcopy` |
| `MAC_CSC_KEY_PASSWORD` | `.p12` 密码 |
| `MAC_CSC_NAME` | 证书完整名称，例如 `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple 账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 |
| `APPLE_TEAM_ID` | Team ID |

工作流检测到 `MAC_CSC_LINK` 后会自动使用签名配置；没有该 secret 时仍构建未签名包。

> 不需要把证书提交到仓库。GitHub Actions 会把 secret 注入构建环境。

---

### 8.2 Windows 签名

#### 准备

购买受信任的代码签名证书（推荐 EV；OV 需要时间积累 SmartScreen 信誉）。导出 `.pfx`。

#### 本地构建

```powershell
$env:CSC_LINK = "C:\path\certificate.pfx"
$env:CSC_KEY_PASSWORD = "password"
npm run dist:win
```

electron-builder 会在打包过程中签名应用 exe、卸载器与安装器。**自签名证书不会消除 SmartScreen 警告**，必须是受信任 CA 签发的证书。

#### CI 构建

添加 GitHub Secrets：

| Secret | 内容 |
| --- | --- |
| `WIN_CSC_LINK` | `.pfx` 的 base64 |
| `WIN_CSC_KEY_PASSWORD` | `.pfx` 密码 |

工作流的 Windows job 会自动注入 `CSC_LINK` / `CSC_KEY_PASSWORD`。没有 secret 时保持未签名。

> EV 证书通常需要硬件令牌；GitHub Actions 无法直接使用硬件令牌。此时需要自建 Windows runner 或使用云签名服务（Azure Trusted Signing、SSL.com eSigner 等）。OV 证书的 `.pfx` 可以直接用于 CI。

---

### 8.3 没有证书时能做与不能做的事

- ✅ 使用 `npm run dist:mac:*` / `dist:win` 生成可运行安装包。
- ✅ 用户右键打开（macOS）或“仍要运行”（Windows）。
- ✅ 通过 README 提供 `xattr` 命令。
- ❌ 无法让 Gatekeeper / SmartScreen 对所有用户完全不提示。
- ❌ ad-hoc 签名、自签名证书、重命名 `.exe` 都不能替代受信任证书。

---

## 9. 替换或升级 FFmpeg

项目通过 `ffmpeg-static`（开发依赖）与 `@ffprobe-installer/ffprobe` 获取二进制，打包时再按目标平台准备。

### 升级 FFmpeg

1. 升级 `ffmpeg-static`：
   ```bash
   npm install -D ffmpeg-static@latest
   ```
2. 查看其 `package.json` 中的 `ffmpeg-static.binary-release-tag`；`scripts/before-pack.cjs` 会自动读取该标签下载交叉平台二进制。
3. 如果新版本没有某个平台的 asset，需要相应更新 `FFMPEG_ASSET_ARCH` 或改用其他构建来源。
4. 升级 `@ffprobe-installer/ffprobe`，并同步更新 `scripts/before-pack.cjs` 中的 `FFPROBE_VERSIONS` 映射。
5. 运行：
   ```bash
   npm test
   npm run test:smoke
   npm run test:e2e
   npm run test:ui
   ```
6. 检查硬件编码器探测是否正常（设置页应显示 VideoToolbox / NVENC 等）。

### 使用自定义 FFmpeg

最终用户可以在设置页指定任意 `ffmpeg` / `ffprobe` 路径，例如自编译带更多编码器的版本，或 LGPL 构建。自定义路径优先于内置二进制；ffprobe 留空时会尝试使用 ffmpeg 同目录下的 ffprobe。

### 许可证

`ffmpeg-static` 提供的是 **GPL 构建**（`--enable-gpl`），当前 macOS 二进制还带有 `--enable-nonfree` 标记。如果分发内置二进制，请确保整体分发方式符合 GPL，并评估 nonfree 组件带来的再分发限制。本项目因此采用 GPL-3.0-or-later；若要正式商业分发，建议替换为自行编译、未启用 nonfree 的构建。你也可以改用 LGPL 构建并相应调整项目许可证，但需要自行确认法律责任。

---

## 10. 修改应用名称、图标与标识

### 图标

- 编辑 `build/icon.svg`。
- 运行 `npm run icons` 生成 `build/icon.png`（1024×1024）。
- electron-builder 会自动转换为 `.icns` 与 `.ico`。

### 应用名称

需要同步修改：

| 位置 | 内容 |
| --- | --- |
| `package.json` → `name` | npm 包名（小写、连字符） |
| `package.json` → `productName` | 英文产品名，决定安装包名、可执行文件名与用户数据目录 |
| `electron-builder.yml` → `productName` | 安装包与应用显示名（应与 productName 保持一致） |
| `electron-builder.yml` → `appId` | 反向域名标识 |
| `src/main/index.js` → `APP_DISPLAY_NAME` | 菜单与关于面板中的中文名称 |
| `src/renderer/src/components/AppSidebar.vue` | 侧边栏品牌文字 |
| `src/renderer/src/views/AboutView.vue` | 关于页标题 |
| `index.html` → `<title>` | 窗口标题 |

> 中文显示名（`APP_DISPLAY_NAME`、侧边栏、关于页、窗口标题）可以与英文 `productName` 不同。本项目当前中文名为「文艺文视频工坊」，英文产品名为 `Local Video Lab`；用户数据目录使用英文产品名。

在 macOS 上，用户数据目录名由 `productName` 决定；如果改名并希望保留旧设置，需要自行迁移 `settings.json`。

---

## 11. 产物与体积

以 macOS arm64 为例：

| 内容 | 约大小 |
| --- | --- |
| Electron 运行时 | ~220MB（解压后） |
| FFmpeg 静态二进制 | ~45MB（macOS）/ ~79MB（Windows） |
| FFprobe 静态二进制 | ~18MB（macOS arm64）/ ~75MB（macOS x64、Windows x64） |
| 应用代码与界面 | ~1MB |
| DMG | 约 140–180MB（压缩后） |

体积主要来自 Electron 与 FFmpeg。若需要更小体积，可以考虑改用 Tauri 或让用户首次运行时下载 FFmpeg，但这会牺牲离线可用性与跨平台确定性。

---

## 12. 故障排查

### `npm install` 很慢 / Electron 下载失败

```bash
# 使用国内镜像（示例）
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

或在 `.npmrc` 中配置代理。

### 打包时 FFmpeg 下载超时

`before-pack.cjs` 已内置 3 次重试与 10 分钟超时。网络不稳定时可手动把二进制放入 `.cache/binaries/`，文件名格式：

```text
ffmpeg-darwin-x64
ffprobe-darwin-x64
ffmpeg-win32-x64.exe
ffprobe-win32-x64.exe
```

### 打包后提示找不到 ffmpeg

1. 检查 `resources/bin/` 是否存在二进制。
2. 运行 `--self-test` 查看 `ffmpegPath`。
3. 确认 `beforePack` 在日志中输出了“已准备 <platform>-<arch> 的 FFmpeg / FFprobe 二进制”。
4. macOS 上检查可执行权限：`ls -l resources/bin`。

### macOS 提示“应用已损坏”

未签名 + 隔离属性导致。执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Local Video Lab.app"
```

### Windows SmartScreen 拦截

点击“更多信息 → 仍要运行”。正式分发建议使用代码签名证书。

### 在 macOS 上打 Windows 包失败

NSIS 交叉构建可能依赖 wine。推荐推送代码或标签，让 GitHub Actions 的 Windows runner 构建。

### 在 macOS 上打 Windows 包失败

NSIS 工具链的 `makensis` 是 x86_64 二进制。Apple Silicon 未安装 Rosetta 时会报：

```text
Cannot spawn .../mac/makensis: Error: spawn Unknown system error -86
```

任选一种方式：

- 在 Windows 机器上执行 `npm run dist:win`；
- 推送 `v*` 标签，让 GitHub Actions 的 `windows-latest` 生成安装包；
- 安装 Rosetta：`softwareupdate --install-rosetta --agree-to-license`，然后重试。

如果只需要可运行的 Windows 目录，可以执行 `npx electron-builder --win --x64 --dir`，把 `release/win-unpacked` 压缩分发（不是安装器）。

### 界面空白 / CSP 报错

生产构建使用 `file://` 加载，CSP 在 `src/renderer/index.html` 中。若新增外部资源，请同步更新 CSP，且不要加载远程脚本。开发模式需要 `ws://localhost:*` 与 `http://localhost:*`。

### 硬件编码在 CI 上不可用

CI 机器通常没有 GPU 或媒体引擎，检测会自动回退软件编码。这是预期行为，不影响测试；本地设置页会显示实际检测结果。

---

## 13. 目录速查

| 路径 | 说明 |
| --- | --- |
| `out/` | `npm run build` 产物（不提交） |
| `release/` | 安装包产物（不提交） |
| `build/staged-bin/` | 当前目标平台的二进制暂存目录（不提交） |
| `.cache/binaries/` | 交叉平台下载缓存（不提交） |
| 用户数据目录 | 设置文件位置，详见 [USAGE.md](USAGE.md#6-数据存储位置) |

更多运行原理见 [ARCHITECTURE.md](ARCHITECTURE.md)。
