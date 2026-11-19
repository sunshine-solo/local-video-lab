# 架构说明

本文档面向贡献者，说明进程模型、IPC、FFmpeg 任务、滤镜图与关键约束。

---

## 1. 总览

```text
┌───────────────────────────── Renderer（Vue 3） ─────────────────────────────┐
│  router / views / components                                                │
│  ├─ 视频拼接：队列、探测结果、进度、结果预览                                  │
│  ├─ 视频去水印：<video> + Canvas 预览、区域框选、参数面板                     │
│  └─ 设置/关于                                                               │
│                │ window.api（preload 白名单）                                │
└────────────────┼────────────────────────────────────────────────────────────┘
                 │ IPC invoke / event
┌────────────────▼──────────────── Main（Electron） ───────────────────────────┐
│  index.js      窗口、菜单、IPC 注册、--self-test                              │
│  jobs.js       单任务管理、进度广播、取消                                      │
│  ffmpeg/                                                                     │
│   ├─ binaries.js    解析内置/自定义二进制                                     │
│   ├─ probe.js       ffprobe JSON → 统一媒体信息                               │
│   ├─ filters.js     纯函数：区域 → filter_complex                             │
│   ├─ joinPlan.js    纯函数：可 copy 判定、画布、码率、concat 转义              │
│   ├─ encoders.js    硬件编码器检测与参数                                      │
│   ├─ runner.js      spawn ffmpeg、解析进度、错误、终止                        │
│   ├─ blurJob.js     去水印任务                                               │
│   ├─ joinJob.js     拼接任务                                                 │
│   └─ output.js      临时输出路径、原子提交、临时目录                            │
│  mediaProtocol.js   media:// + Range + CORS                                  │
│  settings.js        userData/settings.json                                  │
│  engineInfo.js      版本、硬件编码器、设置页测试                               │
│  updateChecker.js   手动检查 GitHub Releases（可选联网）                       │
│  version.js         语义化版本解析与比较（纯函数）                              │
│  constants.js       应用显示名、仓库地址                                       │
└──────────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
         原生 ffmpeg / ffprobe 子进程
```

设计原则：

1. **渲染层不接触文件系统与子进程**。所有路径、参数、命令都在主进程构造。
2. **纯逻辑可测试**。滤镜图、拼接判定、码率估算等放在无 Electron 依赖的模块中。
3. **失败不破坏用户文件**。输出先写临时文件，成功后再替换。
4. **任何加速都可回退**。硬件编码失败自动回退软件；自定义 FFmpeg 不可用时回退内置。

---

## 2. 进程与安全模型

`BrowserWindow` 配置：

```js
webPreferences: {
  preload: '.../preload/index.js',
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false,
}
```

- preload 只暴露固定 API，不暴露 `ipcRenderer` 本体。
- 渲染层 CSP 限制脚本、媒体、连接来源；生产环境通过 `file://` 加载相对资源。
- `setWindowOpenHandler` 只允许 http(s) 链接交给系统浏览器；`will-navigate` 阻止站内跳转。
- `media://` 协议只放行音视频扩展名，避免变成任意文件读取接口。
- 不包含后台上传、遥测或远程内容加载；唯一的网络请求是用户手动触发的 GitHub Releases 更新检查。

### IPC 通道

| 通道 | 方向 | 作用 |
| --- | --- | --- |
| `dialog:select-videos` | invoke | 多选视频文件 |
| `dialog:select-output` | invoke | 选择输出位置（记住最近目录） |
| `dialog:select-binary` | invoke | 选择自定义 ffmpeg/ffprobe |
| `media:probe` | invoke | ffprobe 读取媒体信息 |
| `job:join` / `job:blur` | invoke | 启动任务，完成后返回结果 |
| `job:cancel` | invoke | 终止当前任务 |
| `job:progress` | event | 进度、阶段、说明 |
| `settings:get` / `settings:save` | invoke | 读写本机设置 |
| `engine:info` / `engine:test` | invoke | 引擎状态与路径测试 |
| `update:check` | invoke | 手动查询 GitHub 最新 Release，比较版本 |
| `app:info` / `app:clear-temp` | invoke | 版本信息、清理临时目录 |
| `shell:reveal` / `shell:open` | invoke | 在文件夹中显示 / 打开文件 |
| `theme:set` | invoke | 同步原生标题栏主题 |
| `app:show-about` | event | 菜单“关于”跳转 |

---

## 3. FFmpeg 二进制解析

`src/main/ffmpeg/binaries.js` 的优先级：

1. 用户设置中的 `ffmpegPath` / `ffprobePath`（绝对路径或 PATH 中的命令名）。
2. 安装包内置：`<resources>/bin/ffmpeg`、`<resources>/bin/ffprobe`。
3. 开发环境：`ffmpeg-static` 与 `@ffprobe-installer/ffprobe` 指向的 `node_modules` 文件。
4. 系统 PATH 中的 `ffmpeg` / `ffprobe`。

自定义 ffmpeg 时如果 ffprobe 留空，会优先使用 ffmpeg 同目录的 ffprobe。启动前会补齐可执行权限（打包/解压可能丢失）。

**为什么二进制不在 `app.asar` 里？**
可执行文件不能从 asar 直接运行。打包时 `beforePack` 把它们放入 `resources/bin`，通过 `extraResources` 复制，运行时用 `process.resourcesPath` 定位。

---

## 4. 媒体探测

`probeMedia()` 调用：

```bash
ffprobe -v error -print_format json -show_format -show_streams <file>
```

统一输出：

```js
{
  path, name, size, mtimeMs, duration, formatName, formatBitRate,
  video: { codec, width, height, codedWidth, codedHeight, rotation,
           pixFmt, fps, bitRate, profile },
  audio: { codec, sampleRate, channels, channelLayout, bitRate } | null
}
```

**旋转处理**：手机竖拍视频带旋转矩阵，ffmpeg 默认自动旋转。探测时读取 `side_data_list.rotation`（或 `tags.rotate`），对 90/270 度交换宽高，使 `video.width/height` 表示**显示尺寸**。滤镜坐标、拼接画布与预览都以显示尺寸为准。

---

## 5. 进度、取消与错误

### 进度

FFmpeg 参数中始终包含：

```bash
-progress pipe:1 -nostats -loglevel error
```

`runner.js` 解析 stdout 的 `out_time_us=`（部分版本为 `out_time_ms`，同样是微秒），除以总时长得到 0–1，再映射到任务阶段区间。限制事件频率（约 0.2% 一次），避免 IPC 风暴。

### 取消

- `jobs.js` 持有当前子进程引用。
- 取消时先 `SIGTERM`，3 秒后仍未退出则 `SIGKILL`。
- `runner.js` 在 close 事件中优先判断 `isCancelled()`，抛出 `JobCancelledError`。
- 任务 `finally` 删除临时输出与中间目录。

### 错误

- FFmpeg 非零退出时保留最后 16KB stderr，取最后 12 行作为错误信息。
- 找不到可执行文件（ENOENT）会转换成中文提示。
- 主进程捕获所有任务异常，返回 `{ ok: false, error, cancelled? }`，不把原始堆栈直接抛给界面。

### 原子输出

`output.js`：

1. 输出目标为 `视频.mp4` 时，实际写入 `.视频.partial-<jobId>.mp4`（同目录、隐藏）。
2. 成功后删除旧目标（如果存在）并 `rename`。
3. 失败/取消只删除临时文件，原目标保持不变。
4. 跨设备 rename 失败时退化为 copy + delete。

临时转码目录位于系统临时目录，前缀 `local-video-lab-`，任务结束即清理；应用启动时清理超过 24 小时的残留目录。

---

## 6. 视频拼接

### 6.1 可无损拼接判定（`joinPlan.canStreamCopy`）

所有素材必须满足：

- 视频编码为 `h264`；
- 显示宽高一致；
- 像素格式一致；
- 平均帧率一致（容差 0.01）；
- 旋转角度一致；
- 是否带音轨一致；
- 若有音轨：音频编码、采样率、声道数一致。

满足时写一个 concat 列表：

```text
file '/path/a.mp4'
file '/path/b.mp4'
```

执行：

```bash
ffmpeg -f concat -safe 0 -i list.txt \
  -map 0:v:0 -map 0:a? -c copy \
  -avoid_negative_ts make_zero -movflags +faststart output.mp4
```

路径会统一为正斜杠，并按 ffmpeg concat 规则转义单引号（`'` → `'\''`），兼容 Windows 与含空格/中文/引号的路径。

### 6.2 标准化路径

以第一段视频的显示尺寸计算目标画布：

- 横屏：最大 1280×720；竖屏：最大 720×1280；
- 小于上限时保持原尺寸；
- 宽高向下取偶。

每段滤镜：

```text
scale=W:H:force_original_aspect_ratio=decrease,
pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,
setsar=1,
fps=30,
format=yuv420p
```

音频：

- 有音轨：`aresample=44100:async=1:first_pts=0` + `aformat=sample_rates=44100:channel_layouts=stereo`，AAC 128k。
- 无音轨：新增 `anullsrc=r=44100:cl=stereo` 输入，`-shortest`，AAC 128k。

视频编码：

- 软件：`libx264 -preset ultrafast -crf 23`；
- 硬件：按分辨率估算码率（`width × height × fps × 0.1 / 1000` kbps），使用对应编码器参数。

逐段输出到临时 MP4 后，再用 concat + `-c copy` 合并。同一文件路径 + size + mtime 的重复素材只转码一次。

---

## 7. 视频去水印

### 7.1 归一化坐标

界面上的区域保存为 `{ x, y, w, h }`，取值范围 0–1，相对显示画面。这样与分辨率、窗口缩放无关。

主进程 `toPixelBox()` 转换为像素框时：

- 四舍五入并向下取偶（yuv420p 色度抽样与 overlay 对齐要求）；
- 宽高至少 2px；
- 保证 `x + w ≤ width`、`y + h ≤ height`。

### 7.2 滤镜图

对 N 个区域：

```text
[0:v]split=N+1[s0][s1]...[sN];
[s1]crop=w:h:x:y,gblur=sigma=S[r0];
[s0][r0]overlay=x:y[o0];
[s2]crop=...,<效果>[r1];
[o0][r1]overlay=x:y[o1];
...
[o(N-1)]format=yuv420p[vout]
```

关键点：

- **必须**从 `split` 的每一路取区域；不能让多个 `crop` 直接读同一个输入再连续 overlay。
- 每处理一个区域就 overlay 回当前结果，保证区域之间互不干扰。
- 模糊使用 `gblur`；马赛克先 `scale=小尺寸:flags=neighbor` 再放大回区域尺寸；纯色用 `drawbox=t=fill`。
- 奇数列画面在最后会先 `crop=trunc(iw/2)*2:trunc(ih/2)*2`。

示例（2 个区域、模糊）：

```bash
ffmpeg -i input.mp4 -filter_complex \
"[0:v]split=3[s0][s1][s2];\
 [s1]crop=392:130:714:561,gblur=sigma=12.4[r0];\
 [s0][r0]overlay=714:561[o0];\
 [s2]crop=322:72:23:14,gblur=sigma=8.1[r1];\
 [o0][r1]overlay=23:14[vout]" \
-map "[vout]" -map 0:a? -c:a copy \
-c:v h264_videotoolbox -b:v 559k -pix_fmt yuv420p \
-movflags +faststart output.mp4
```

### 7.3 码率与音频

- 目标视频码率优先取 `video.bit_rate`；否则用 `format.bit_rate - 音频码率`；再否则用文件大小/时长估算。
- 软件编码：已知目标码率时使用 `-b:v + maxrate(1.4×) + bufsize(2×)`；未知时用 CRF。
- 硬件编码：使用目标码率（无 CRF）。VideoToolbox 的码率控制与 x264 不同，成片体积可能有小幅波动。
- 音频：`aac/mp3/ac3/eac3/alac` 直接 copy，其余转 AAC；无音轨时不添加音频。

### 7.4 预览

- `<video>` 指向 `media://`，Canvas 通过 `drawImage(video)` 逐帧绘制。
- 模糊：Canvas `filter = blur(sigma)`；马赛克：缩小到 scratch canvas 后用 `imageSmoothingEnabled=false` 放大；纯色：填充。
- 区域框选 div 覆盖在 Canvas 上方，只负责交互与边框；Canvas 不接收指针事件。
- 预览公式与滤镜公式共用常量（`0.02 + strength × 0.03` 等），避免“预览一套、导出另一套”。

---

## 8. 硬件编码检测

`encoders.js`：

1. 执行 `ffmpeg -encoders`，检查候选编码器是否编译进当前二进制。
2. 对每个候选执行一次真实编码：
   ```bash
   ffmpeg -f lavfi -i color=c=black:s=256x144:r=30:d=0.3 \
     -frames:v 3 -c:v <encoder> -b:v 800k -pix_fmt yuv420p -f null -
   ```
   成功才算可用（有些编码器编译进了但没有对应硬件）。
3. 按平台优先顺序：
   - macOS：`h264_videotoolbox`
   - Windows：`h264_nvenc` → `h264_qsv` → `h264_amf`
   - Linux：`h264_nvenc` → `h264_qsv`
4. 结果按 ffmpeg 路径缓存；设置页可强制重新检测。

参数示例：

| 编码器 | 关键参数 |
| --- | --- |
| VideoToolbox | `-b:v Nk -allow_sw 1` |
| NVENC | `-preset p1 -tune hq -rc vbr -b:v Nk -maxrate 1.4N -bufsize 2N` |
| Quick Sync | `-preset veryfast -b:v Nk -maxrate 1.4N -bufsize 2N` |
| AMF | `-quality speed -rc vbr_peak -b:v Nk -maxrate 1.4N -bufsize 2N` |
| 软件 | `libx264 -preset ... -crf ...` 或 `-b:v ...` |

任务中若硬件编码失败，会删除半成品、切换软件编码重试一次；连续失败不会无限重试。

---

## 9. `media://` 协议

注册为 privileged（`standard`、`secure`、`supportFetchAPI`、`corsEnabled`、`stream`）。

URL 格式：

```text
media://local/<encodeURIComponent(absolutePath)>
```

处理器行为：

- 只允许音视频扩展名（`mp4/mov/webm/mkv/avi/flv/wmv/ts/...`）。
- 支持 `Range: bytes=...`，返回 206 与 `Content-Range`；否则返回 200 + 完整流。
- 响应带 `Access-Control-Allow-Origin: *` 与 `Access-Control-Expose-Headers`，使 `<video crossorigin="anonymous">` 可以被 Canvas 读取，不污染画布。
- `Cache-Control: no-store`，避免重新处理同名文件后读到旧缓存。
- 使用 `Readable.toWeb(fs.createReadStream(...))` 直接流式传输，不把整个视频读入内存。

---

## 10. 设置与自检

- 设置文件：`app.getPath('userData')/settings.json`。
- 字段：`ffmpegPath`、`ffprobePath`、`hardwareAcceleration`、`lastOutputDir`。
- 写入采用同步小文件 + 内存缓存，避免频繁读盘。

`--self-test` 模式：不创建窗口，检测引擎和硬件编码器，输出 JSON 后退出。适合打包验证与用户报障时收集环境信息。

---

## 11. 测试策略

| 文件 | 范围 | 依赖 |
| --- | --- | --- |
| `tests/filters.test.js` | 区域转像素框、滤镜图结构 | 无 |
| `tests/joinPlan.test.js` | copy 判定、画布、码率、concat 转义 | 无 |
| `scripts/smoke-test.cjs` | 真实 FFmpeg：3 种去水印 + 2 种拼接 | 本地 FFmpeg |
| `scripts/e2e-electron.cjs` | Electron 生产构建、preload、`media://`、Canvas | Electron + 本地 FFmpeg |
| `scripts/e2e-ui.cjs` | 真实 UI 流程：选视频、框选、处理、拼接并校验输出 | Electron + 本地 FFmpeg |
| `scripts/screenshots.cjs` | 生成文档截图 | Electron |

新增 FFmpeg 命令时，优先把参数构造抽成纯函数并补单元测试，再用 smoke 测试覆盖真实执行。

---

## 12. 新增一个工具模块

1. 在 `src/main/ffmpeg/` 新增任务模块（参考 `blurJob.js`），返回 `{ outputPath, size, mode, ... }`。
2. 在 `jobs.js` 中分派新的 kind。
3. 在 `index.js` 注册 IPC（例如 `job:extract`）。
4. preload 暴露 `startExtract`。
5. 渲染层新增 view、路由和侧边栏入口。
6. 复用 `assertOutputDirectory`、`makeWorkPath`、`commitOutput`、`runFfmpeg`，不要自己拼接临时文件逻辑。
7. 补充单元测试与 smoke 测试；如果涉及新滤镜图，在硬件编码下测试一次。

保持现有约束：

- 不把多区域滤镜图改成多路直接 overlay；
- 不取消“硬件失败回退软件”；
- 不把原子输出改成直接写目标路径；
- 不在渲染层直接拼 FFmpeg 命令或访问文件系统。
