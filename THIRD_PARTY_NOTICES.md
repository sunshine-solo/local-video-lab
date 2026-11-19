# 第三方组件与许可证

本项目自身代码以 **GPL-3.0-or-later** 发布（见 [LICENSE](LICENSE)）。

安装包同时包含以下第三方组件。各组件的版权归其作者所有，并遵循各自许可证。

---

## FFmpeg / FFprobe

| 项目 | 版本 | 许可证 | 说明 |
| --- | --- | --- | --- |
| FFmpeg | 6.0（ffmpeg-static 二进制） | GPL（构建配置含 `--enable-gpl`） | 所有转码、滤镜、拼接与探测的核心 |
| FFprobe | 4.4.1（@ffprobe-installer 二进制） | 与 FFmpeg 构建一致 | 媒体信息读取 |

- 官网：<https://ffmpeg.org/>
- 许可证说明：<https://ffmpeg.org/legal.html>
- 源码：<https://ffmpeg.org/download.html>
- 本项目通过以下 npm 包获取预编译二进制：
  - [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)（GPL-3.0-or-later，二进制 release tag `b6.1.1`）
  - [`@ffprobe-installer/ffprobe`](https://www.npmjs.com/package/@ffprobe-installer/ffprobe)（包本身 LGPL-2.1，二进制随 FFmpeg 构建）

安装包内 `resources/bin/LICENSE-ffmpeg.txt` 附带 FFmpeg 的许可证文本。FFmpeg 的完整源码可从其官网获取。

> **分发者注意**：预编译二进制的具体构建选项由上游提供方决定。当前 macOS 构建的 `ffmpeg -version` 配置中包含 `--enable-gpl` 与 `--enable-nonfree`；严格来说，带有 nonfree 组件的二进制不满足 FFmpeg 官方关于可自由再分发的条件。若你计划进行商业分发或对许可证有严格要求，请自行审计并替换为你自行编译、未启用 nonfree 的 GPL 或 LGPL 构建。应用支持在设置页指定自定义 FFmpeg / FFprobe 路径，无需重新打包。

---

## 应用运行时与构建工具

| 组件 | 许可证 | 用途 |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) | MIT | 桌面运行时（Chromium、Node.js） |
| [Chromium](https://www.chromium.org/) | BSD-3-Clause 等 | Electron 内置浏览器引擎 |
| [Node.js](https://nodejs.org/) | MIT | Electron 内置 Node 运行时 |
| [Vue 3](https://vuejs.org/) | MIT | 渲染层框架 |
| [Vue Router](https://router.vuejs.org/) | MIT | 页面路由 |
| [Vite](https://vite.dev/) | MIT | 渲染层构建与开发服务器 |
| [@vitejs/plugin-vue](https://www.npmjs.com/package/@vitejs/plugin-vue) | MIT | Vue 单文件组件支持 |
| [electron-vite](https://electron-vite.org/) | MIT | Electron 构建集成 |
| [electron-builder](https://www.electron.build/) | MIT | 安装包生成 |
| [@lucide/vue](https://lucide.dev/) | ISC | 界面图标 |
| [@rollup/plugin-commonjs](https://www.npmjs.com/package/@rollup/plugin-commonjs) | MIT | 主进程 CJS 打包 |
| [sharp](https://sharp.pixelplumbing.com/) | Apache-2.0 | 图标生成（仅构建时） |

开发依赖的完整列表及版本请见 `package-lock.json`。

---

## 字体

界面使用操作系统自带字体（macOS：SF Pro / PingFang SC；Windows：Segoe UI / Microsoft YaHei），不随应用分发字体文件。

---

## 许可证兼容性

- 项目代码：GPL-3.0-or-later。
- 内置 FFmpeg 为 GPL 构建，与本项目整体 GPL 发布兼容。
- 其余运行时与构建依赖均为 MIT / ISC / Apache-2.0 / BSD 等宽松许可证，与 GPL-3.0 兼容。

如果你发现许可证信息有误或缺失，请提交 Issue，我们会尽快修正。
