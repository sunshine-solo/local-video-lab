# 贡献指南

感谢你愿意改进文艺文视频工坊。这个项目的核心目标是：**用原生 FFmpeg 提供快速、稳定、完全本地的视频处理能力**。提交功能前，请先确认它符合这个定位。

---

## 1. 开发环境

- Node.js ≥ 22.12，npm ≥ 10
- macOS / Windows（Linux 可开发）
- 推荐 VS Code + Vue 官方插件

```bash
git clone https://github.com/sunshine-solo/local-video-lab.git
cd local-video-lab
npm install
npm run dev
```

---

## 2. 目录与代码风格

- `src/main/`：Electron 主进程，**CommonJS**（`require` / `module.exports`）。主进程与 preload 通过 `@rollup/plugin-commonjs` 打包。
- `src/preload/`：只暴露白名单 API，不放业务逻辑。
- `src/renderer/`：Vue 3 + Composition API，优先 `<script setup>`；不引入 TypeScript。
- `src/main/ffmpeg/`：FFmpeg 相关逻辑。能给纯函数的（参数构造、判定、转义）就不要依赖 Electron，方便测试。
- `tests/`：Node 内置测试器；纯函数优先。
- `scripts/`：构建、测试、截图等开发脚本。

风格约定：

- 2 空格缩进，单引号，无分号（与现有代码一致）。
- 命名：组件 PascalCase，函数/变量 camelCase，常量 UPPER_SNAKE_CASE。
- 注释解释“为什么”，不要复述代码。涉及 FFmpeg 的“坑”（多线程滤镜死锁、奇偶像素、码率对齐等）请保留注释。
- 不要引入大型 UI 框架或 TS 工具链；保持依赖精简。

---

## 3. 必须运行的检查

提交前至少运行：

```bash
npm test
npm run test:smoke
```

涉及 Electron、preload、`media://`、Canvas 预览或主要交互流程的改动：

```bash
npm run test:e2e
npm run test:ui
```

涉及界面的改动，请附上截图：

```bash
npm run screenshots
```

`test:smoke` 会真实调用 FFmpeg 生成横屏、竖屏、无音轨素材，并验证：

- 无损拼接与标准化拼接；
- 模糊 / 马赛克 / 纯色三种去水印；
- 输出编码、分辨率、音轨、时长。

如果你的环境没有 GPU，硬件编码会回退软件编码，这是正常的。

---

## 4. 修改 FFmpeg 相关逻辑时的约束

请先阅读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。以下约束是有意为之，不要轻易回退：

1. **去水印滤镜必须从 `split` 取每一路区域**，不能多个 `crop` 直接读同一个输入后连续 overlay。
2. **区域坐标必须取偶并限制在画面内**；yuv420p 对奇数尺寸不友好。
3. **输出先写同目录临时文件，成功后再原子替换**；不要直接写目标路径。
4. **硬件编码失败必须回退软件编码**；不要假设检测通过就一定成功。
5. **去水印码率优先对齐源视频**；不要改回固定 CRF 而不做说明。
6. **进度使用 `-progress pipe:1`**，不要用假进度或猜时间。
7. **拼接无损判定要保守**；参数不完全一致时宁可转码，也不要输出花屏/音画不同步。
8. **`media://` 只放行音视频扩展名**，并保留 Range 与 CORS 头。

新增 FFmpeg 参数时，请：

- 抽出纯函数并补充单元测试；
- 在 `test:smoke` 中覆盖真实执行；
- 验证硬件编码与软件编码两条路径；
- 验证路径包含空格、中文、单引号时的行为（Windows 尤其重要）。

---

## 5. 新增一个工具模块

参考 `docs/ARCHITECTURE.md` 第 12 节：

1. 主进程任务模块 → 2. `jobs.js` 分派 → 3. IPC → 4. preload → 5. 视图/路由/侧边栏 → 6. 测试。

界面文案使用简体中文；面向开源社区的名词（FFmpeg、H.264、VideoToolbox）保留英文。

---

## 6. 提交信息与 PR

提交信息建议使用：

```text
feat: 新增视频压缩工具
fix: 修复 Windows 路径含引号时拼接失败
docs: 补充 Intel Mac 打包说明
perf: 降低预览 Canvas 绘制频率
chore: 升级 ffmpeg-static
```

PR 描述请包含：

- 改了什么、为什么；
- 复现/验证步骤；
- 是否影响 FFmpeg 命令、安装包或许可证；
- 测试结果（命令 + 关键输出）；
- 界面改动截图（如适用）。

保持 PR 聚焦；不要把无关重构和新功能混在一起。

---

## 7. 报告问题

请在 GitHub Issues 中提供：

- 应用版本、操作系统与版本、芯片类型；
- 设置页引擎状态（FFmpeg 版本、硬件编码器）；
- 复现步骤与预期/实际行为；
- 涉及媒体兼容性时，附 `ffprobe` 输出（**不要上传包含隐私内容的完整视频**）。

安全相关问题请参考 [SECURITY.md](SECURITY.md)。

---

## 8. 许可证

提交代码即表示你同意以本项目的 **GPL-3.0-or-later** 许可证发布你的贡献。请确保你有权提交相关代码，并且没有引入许可证不兼容的依赖。
