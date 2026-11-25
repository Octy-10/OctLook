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

## 编辑与设计师工具

所有编辑都是非破坏性的：原文件从不被改写，结果通过「导出」另存为新文件。切换到其他图片时，未导出的编辑会被丢弃。

- **调色**（`E`）：曝光、对比度、饱和度、色温、色调、色相，以及黑白 / 反相。预览走 GPU 上的 SVG 颜色矩阵滤镜，导出使用同一矩阵逐像素计算，所见即所得。双击滑块复位单项。
- **标注**（`A`）：文字、箭头、矩形，六种颜色；工具栏的滑块随当前工具或选中元素变化（文字调字号，箭头调大小，矩形调线宽）。文字直接在画面上输入（单击落点即可打字，双击已有文字重新编辑）；选中元素后拖动本体移动，拖动手柄缩放（矩形四角、箭头两端、文字右下角），`Del` 删除。文字在添加时自动摆正，即使图片已旋转或翻转。标注随导出一并写入新文件。
- **裁剪**（`X`）：自由或锁定比例（原始、1:1、4:3、3:2、16:9、3:4、9:16），三分线辅助；`Enter` / 双击应用，`Esc` 取消。
- **前后对比**：按住 `\` 临时查看调色前的画面；编辑面板中可开启可拖动的分屏对比。
- **重置**（`Ctrl R`）：一键撤销调色、裁剪、标注、旋转和翻转。
- **导出**（`Ctrl S`）：PNG / JPG / WebP，可设质量与长边像素；PDF、AI 等矢量文件按 300 dpi 栅格化。导出结果为 8 bit sRGB，不保留 EXIF 与 ICC 配置文件。
- **复制图像**（`Ctrl C`）：把当前编辑结果放入剪贴板，直接粘贴到设计软件或聊天窗口。
- **文字提取**（`O`）：PDF / AI 直接读取内嵌文本；其余图片用 PaddleOCR PP-OCRv5 轻量模型（Apache-2.0）在 ONNX Runtime 上离线识别，覆盖简繁中文、英文、日文与竖排、倾斜文字，已裁剪时只识别裁剪区域。模型随安装包分发（约 21 MB），首次使用时加载，不联网。模型由 `scripts/fetch-ocr-models.mjs` 在构建前下载并校验 SHA-256（国内可设 `HF_ENDPOINT=https://hf-mirror.com`）。
- **文件信息**（`I`）：除格式、尺寸、EXIF 外，还显示 300 dpi 下的印刷尺寸和图片主色（单击色块复制 HEX）。

底部工具条只保留高频工具（旋转、裁剪、标注、调色、取色、提取文字、导出）。缩放比例显示在标题栏文件名旁，单击在适应窗口与 100% 之间切换。其余命令和偏好集中在工具条右侧的设置菜单：复制图像、文件信息、翻转、适应窗口 / 实际大小、画布背景、界面外观（跟随系统 / 深色 / 浅色）、缩略图栏、全屏以及文件操作。

## 资源管理器缩略图

安装包会注册一个 Windows 缩略图扩展（`octlook_shell.dll`，进程隔离运行），让桌面和文件夹直接显示 PSD、PSB、AI、SVG、CDR、Sketch、XD、Figma、Krita、OpenRaster、Affinity 等文件的缩略图。

- SVG 由 resvg 按图标尺寸直接矢量渲染（小图标也清晰）；含文字的 SVG 使用系统字体。出于安全考虑只加载内嵌的 `data:` 图片，不读取文档引用的外部文件。

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
| X | 裁剪（Enter 应用） | E | 调色与导出面板 |
| A | 标注（文字 / 箭头 / 矩形） | Del | 删除选中标注 / 移至回收站 |
| 按住 \ | 对比调色前 | Ctrl R | 重置全部编辑 |
| Ctrl S | 导出为新文件 | Ctrl C | 复制图像 |
| O | 提取文字（OCR） | | |
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
  decode/       psd · embedded（XMP/JPEG/PNG/EPS）· container（ZIP/CDR）· svg（resvg）· raster · wic · stream（IStream 入口）
  format.rs     扩展名表（唯一数据源）；meta.rs EXIF；thumbnail.rs 方向校正 + Lanczos 缩放
src-tauri/crates/octlook-shell  资源管理器缩略图 COM 组件（IThumbnailProvider + IInitializeWithStream）
src-tauri/src                   Tauri 应用
  commands.rs   IPC 控制器（仅参数转发）
  wire.rs       二进制 IPC 帧：[payload][header JSON][u32 长度]，大图像素无需 base64；导出写盘走同一布局
  thumbs.rs     缩略图栏：LRU 缓存 + CPU 核数限流，PNG 输出
  folder.rs     同目录文件自然排序
src
  lib/          纯逻辑：viewport 数学、IPC、源加载与预取缓存、pdf.js / OCR 按需加载、
                调色矩阵（edits）、裁剪数学（crop）、标注（annotate）、合成导出（render）、主色（palette）
  hooks/        交互逻辑（视口、取色、PDF 光栅、键盘、拖放）
  store/        zustand 状态（view 视图 · edit 编辑 · text 文字提取 · library 文件列表）
  components/   纯 UI
```

已复用的开源组件：`image`、`resvg`、`fast_image_resize`、`zip`、`kamadak-exif`、`trash`、pdf.js、PaddleOCR PP-OCRv5 模型、ONNX Runtime（`ort`）、Windows WIC、lucide 图标、Inter 字体。PSD 解析自研，原因是现有 crate（`psd`、`rawpsd`）不支持 PSB 或 16/32 bit。

## 许可证

[GPL-3.0-only](LICENSE)。修改或再分发本项目（含其衍生作品）须以同一许可证开源。
