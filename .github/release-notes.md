## 下载

| 平台 | 文件 |
| --- | --- |
| macOS Apple Silicon（M1/M2/M3/M4…） | `local-video-lab-*-mac-arm64.dmg` |
| macOS Intel | `local-video-lab-*-mac-x64.dmg` |
| Windows 10/11 x64 | `local-video-lab-*-win-x64.exe` |

macOS 同时提供 `.zip` 便携压缩包。

## 首次打开

发布包默认**未签名、未公证**。

### macOS

如果提示“无法验证开发者”或“应用已损坏”，可以右键应用 → **打开**，或在终端执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Local Video Lab.app"
```

### Windows

SmartScreen 提示时点击 **更多信息 → 仍要运行**。

## 说明

- 所有视频均在本机处理，不上传任何文件。
- 内置原生 FFmpeg / FFprobe，无需额外安装。
- 支持视频去水印与视频拼接。
- 更新内容见仓库的 [CHANGELOG](CHANGELOG.md)。
- 开源许可：GPL-3.0-or-later；第三方组件见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
