# OctLook

专为设计师打造的极简看图软件：秒开 PSD、AI、CDR、Sketch 等设计文件，在资源管理器中直接显示缩略图，同时胜任日常看图。Tauri 2（Rust）+ React 19 + TypeScript。

[下载最新版](https://github.com/Octy-10/OctLook/releases/latest) · 安装后会自动提示新版本。

## 格式支持

| 格式 | 方式 | 说明 |
| --- | --- | --- |
| JPG PNG GIF WebP AVIF BMP ICO SVG | WebView 原生解码 | 零拷贝、支持动图、自动 EXIF 方向 |
| PSD / PSB | Rust 自研合成图解析 | 1/8/16/32 bit；RGB/CMYK/灰度/索引/Lab；RLE/ZIP；透明通道。需保存时开启「最大兼容」，否则回退内嵌缩略图 |
| AI（PDF 兼容）/ PDF | pdf.js 矢量渲染 | 放大时按分辨率档位重绘，始终清晰；多页翻页 |
| AI（旧版）/ EPS / INDD | 内嵌预览 | XMP 缩略图；DOS EPS 的 TIFF 预览 |
| CDR（7 – 2024） | 内嵌预览 | X4+ ZIP 内的缩略图 / RIFF `DISP` 位图 |
| Sketch / XD / Fig / Krita / ORA / Procreate / Affinity | 内嵌预览 | 读取文件内置的扁平化预览图 |
| 相机 RAW（CR2 CR3 NEF ARW DNG RAF ORF RW2 …） | 内嵌全尺寸 JPEG | 预览过小时回退 Windows RAW 解码器 |
| TIFF TGA DDS HDR EXR QOI PNM | `image` crate | 浮点图做伽马编码；失败回退 WIC |
| HEIC / HEIF / JXL / JXR | Windows WIC | 依赖系统已安装的编解码扩展 |

界面左上角的「内嵌预览」标识表示显示的是设计软件保存的预览图，而非完整渲染。

## 资源管理器缩略图

安装包会注册一个 Windows 缩略图扩展（`octlook_shell.dll`，进程隔离运行），让桌面和文件夹直接显示 PSD、PSB、AI、CDR、Sketch、XD、Figma、Krita、OpenRaster、Affinity 等文件的缩略图。

- 已有其他缩略图程序的格式不会被接管（如 Ardfry 的 PSD/AI、Adobe 的 INDD）；卸载对方后重装 OctLook 即可生效。
- PSD 小图标用文件内嵌缩略图，大图标读取完整合成图；AI 使用 Illustrator 保存的内嵌预览。
- 注册写入 HKLM，因此安装需要管理员权限：资源管理器的隔离缩略图进程看不到按用户（HKCU）注册的组件。
- 缩略图右下角带格式角标（PSD、AI、CDR…），过小的图标不画。
- 安装时同时注册：「设置 › 默认应用」中可选择 OctLook；右键「打开方式」列出 OctLook；经典右键菜单（Win11 为「显示更多选项」）增加「用 OctLook 打开」。安装程序不会擅自修改默认应用。
- 安装和卸载时会清除缩略图缓存；缓存文件被资源管理器占用，实际在下次重启时删除（不弹重启提示）。想立即生效可手动「磁盘清理 → 缩略图」。

调试：`cargo run -p octlook-shell --example probe -- <文件> <输出.png> [尺寸] [--direct <dll>]`，前者走与资源管理器相同的系统管线，`--direct` 绕过注册直接调用 DLL。

## 快捷键

| 键 | 功能 | 键 | 功能 |
| --- | --- | --- | --- |
| ← → / 空格 | 上一张 / 下一张 | ↑ ↓ | PDF 翻页 |
| 滚轮 / 捏合 | 以光标为中心缩放 | 拖动 | 平移 |
| 0 / 1 / 双击 | 适应窗口 / 100% | + − | 缩放档位 |
| R / Shift R | 旋转 | H / V | 水平 / 垂直翻转 |
| C | 取色器（单击复制 HEX） | B | 切换背景（深 / 浅 / 透明网格） |
| I | 文件信息与 EXIF | T | 缩略图栏 |
| F / F11 | 全屏 | Del | 移至回收站 |
| Ctrl O / Ctrl Shift O | 打开文件 / 文件夹 | Ctrl E / Ctrl Shift C | 在资源管理器中显示 / 复制路径 |

## 开发

```powershell
npm install
npm run tauri dev
```

打包需要更新签名私钥（与 CI 使用同一把，存于本机 `%USERPROFILE%\.tauri\octlook-updater.key`，切勿提交）：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\octlook-updater.key" -Raw; $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""; npm run tauri build
```

## 发布与自动更新

1. 修改 `src-tauri/tauri.conf.json`、`package.json` 与各 `Cargo.toml` 中的 `version`。
2. 提交后推送同名标签，例如 `git tag v0.2.0 && git push origin v0.2.0`。
3. GitHub Actions（`.github/workflows/release.yml`）运行测试、构建并签名安装包，发布 Release 与 `latest.json`。
4. 已安装的 OctLook 启动后在后台检查，用户点击「更新并重启」后安装；更新包签名不符会被拒绝。

仓库需配置 Secret `TAURI_SIGNING_PRIVATE_KEY`（私钥文件全文）。私钥丢失将无法再向现有用户推送更新。

Rust 单元测试：`cargo test --workspace`（在 `src-tauri` 下）。用本地样本跑完整解码管线：

```powershell
$env:OCTLOOK_SAMPLES="D:\samples"; $env:OCTLOOK_OUT="D:\out"; cargo test --release decode_local_samples -- --ignored --nocapture
```

## 架构

```
src-tauri/crates/octlook-core   解码服务（看图程序与缩略图扩展共用）
  decode/       psd · embedded（XMP/JPEG/PNG/EPS）· container（ZIP/CDR）· raster · wic · stream（IStream 入口）
  format.rs     扩展名表（唯一数据源）；meta.rs EXIF；thumbnail.rs 方向校正 + Lanczos 缩放
src-tauri/crates/octlook-shell  资源管理器缩略图 COM 组件（IThumbnailProvider + IInitializeWithStream）
src-tauri/src                   Tauri 应用
  commands.rs   IPC 控制器（仅参数转发）
  wire.rs       二进制 IPC 帧：[payload][header JSON][u32 长度]，大图像素无需 base64
  thumbs.rs     缩略图栏：LRU 缓存 + CPU 核数限流，PNG 输出
  folder.rs     同目录文件自然排序
src
  lib/          纯逻辑：viewport 数学、IPC、源加载与预取缓存、pdf.js 按需加载
  hooks/        交互逻辑（视口、取色、PDF 光栅、键盘、拖放）
  store/        zustand 状态
  components/   纯 UI
```

已复用的开源组件：`image`、`fast_image_resize`、`zip`、`kamadak-exif`、`trash`、pdf.js、Windows WIC、lucide 图标、Inter 字体。PSD 解析自研，原因是现有 crate（`psd`、`rawpsd`）不支持 PSB 或 16/32 bit。

## 许可证

[GPL-3.0-only](LICENSE)。修改或再分发本项目（含其衍生作品）须以同一许可证开源。
