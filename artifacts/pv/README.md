# 学数有道 PV 素材与交付

> 状态：已完成
> 正式版本：V3.6
> 完成日期：2026-08-27

本目录包含正式成片、当前采用素材和可复现构建输入。产品实录与真实性证据单独保存在 [`../pv-reality/`](../pv-reality/README.md)。

## 正式交付

| 文件 | 用途 |
|---|---|
| `学数有道-PV-v3.6.mp4` | 带版本号的正式成片，永久留档 |
| `学数有道-PV.mp4` | 正式成片便捷副本，与 V3.6 内容完全一致 |
| `pv-subtitles-v3.6.ass` | V3.6 字幕源文件 |
| `pv-subtitles.ass` | 当前字幕便捷副本 |
| `BUILD_MANIFEST.md` | 成片规格、校验值、正式输入和复现说明 |

正式成片规格：97 秒，1920×1080，30fps，H.264 + AAC，44.1kHz 单声道。

## 当前素材

| 路径 | 内容 |
|---|---|
| `source/v3.6/` | V3.6 独有的补录视频和合成输入帧 |
| `hook/` | 通用 AI 开头 mock 及定格帧 |
| `animation/animation-manim-formal.mp4` | 正式对话真实触发的 Manim 动画 |
| `character/cutout/` | 成片使用的小狸透明姿态图 |
| `voice/xiaoyi/` | V3.6 成片配音 |
| `brand-card.png` | 片尾品牌卡 |

## 历史归档

旧成片、粗剪、V2 松散素材和检查帧均在 [`archive/`](archive/README.md)。Manim 候选、旧角色原图、旧配音和 hook 检查素材分别在各自子目录的 `archive` 中。归档内容只用于追溯，不应再作为正式交付。

## 构建

V3.6 构建脚本为 [`../../scripts/build_pv_v33.py`](../../scripts/build_pv_v33.py)。文件名因历史兼容保留为 `v33`，脚本头部和输出均已明确为 V3.6。

```powershell
python scripts/build_pv_v33.py all
```

脚本的正式输入已从 `.runtime-dev` 提升到 `source/v3.6/`；`.runtime-dev/pv-v3/` 仅承担可重新生成的中间片段、拼接清单和 QC 帧。

创作稿、制作计划和迭代修订单见 [`../../docs/01-completed-plans/PV/`](../../docs/01-completed-plans/PV/README.md)。

## 旧目录说明

以下原有章节保留作素材细目，若与上面的 V3.6 状态冲突，以正式交付、构建清单和当前素材路径为准。

## 目录

| 路径 | 用途 | 状态 |
|---|---|---|
| `screens/scene-3-question.png` | 幕 3：问题输入关键帧（n 阶行列式） | 已收集；仅作画面参考，需以最终录屏替换 |
| `screens/scene-3-streaming.png` | 幕 3：AI 流式回答关键帧 | 已收集；暗色主题 |
| `screens/scene-3-guidance.png` | 幕 3：分层引导回答关键帧 | 已收集；暗色主题 |
| `screens/scene-3-guidance-light.png` | 幕 3：分层引导回答备选 | 已收集；浅色主题，中文 KG 文案更完整 |
| `screens/scene-3-follow-up-light.png` | 幕 3：继续追问备选 | 已收集；浅色主题 |
| `screens/scene-4-map-progress.png` | 幕 4：`2/129 已探索`、`2 个学习中` | 已收集；暗色主题 |
| `screens/scene-5-ladder.png` | 幕 5：梯子图（行向量→列向量→线性组合） | 已收集 |
| `screens/scene-6-textbook-menu.png` | 幕 6：四本教材下拉菜单 | 已收集；2026-08-25 从 localhost:8090 截取 |
| `character/*.png` | 五种小狐狸姿态 | 已收集；原图带棋盘背景和生成水印，不能直接作为透明 overlay |
| `animation/animation-demo.mp4` | 幕 5：推荐动画 | 已收集；抛物线 `y=x^2+a`，1280x720，30fps，7.5s |
| `animation/animation-demo-poster.png` | 推荐动画海报 | 已收集 |
| `animation/candidates/` | 其他已生成动画候选 | 已收集；剪辑时按时长/画面择一 |
| `hook/hook-preview.mp4` | 通用 AI 开头 mock | 已完成；无品牌、无旧反转字幕 |
| `animation/animation-manim-formal.mp4` | 正式对话真实触发的行列式动画 | 已完成；854×480 / 15fps / 10.53s，成片转码为 1080p30 |
| `character/cutout/*.png` | 五种小狐狸透明图 | 已完成；棋盘背景与水印区域已通过边缘连通抠图去除 |
| `voice/*.wav` | 中文旁白 | 已完成；Microsoft Huihui Desktop，V3 新录 `01-hook.wav`、`08-continuity.wav` 为 44.1kHz |
| `pv-subtitles.ass` | 成片字幕 | 已完成 |
| `学数有道-PV.mp4` | 赛事 PV 成片 | 已完成；97 秒，1920×1080 / 30fps / H.264 + AAC |

## 动画候选

| ID | 内容判断 | 规格 | 建议 |
|---|---|---|---|
| `12a975e7-9f9a-420a-8dda-8b201abbaa4e` | `y=x^2+0.09` 抛物线 | 1280x720 / 30fps / 7.5s | **当前推荐**，对应计划中的 `animation-demo.mp4` |
| `2cdac463-adbe-4a7f-83cb-1fe7cf03750d` | 单位圆与 `sin(x)` | 1280x720 / 30fps / 11s | 备选 |
| `89d47656-c6c4-4dcf-90cc-d7ff924cf7b7` | 参数 `a` 平移抛物线 | 1280x720 / 30fps / 12s | 备选，说明性最强 |
| `ae83bfab-8625-4f4d-9b09-d906c58e2086` | `y=x^2+a` 平移 | 1280x720 / 30fps / 10.5s | 备选 |
| `ebe81531-3b47-4b6c-be46-edf8ced3f832` | 开口方向变化 | 1280x720 / 30fps / 10s | 备选 |
| `f94a9013-b213-47e2-a353-2985a3fe426a` | 带阴影区域的抛物线 | 854x480 / 15fps / 9.47s | 不建议作为主画面，分辨率较低 |

## 来源与限制

- 实机关键帧来自 `artifacts/pv2-*`、`artifacts/pv3-*`、`artifacts/pv4-*` 和 `artifacts/pv-explore-12-ladder.png`；它们是历史验证截图，不代表最终录屏已经完成。
- 动画从运行中的 `learnmath-manim-renderer-1` 容器 `/var/lib/learnmath/render/<id>/` 提取；候选目录保留原始 render ID，便于追溯。
- 五张角色图来自 `artifacts/pv-character/`。源图为不带 alpha 的生成 PNG，带棋盘背景和右下角生成水印；后续需要统一抠图、去水印或重新生成透明版本。
- 教材封面目前以产品下拉菜单截图代替，未单独渲染四张封面卡片。

## 正式证据

- 正式账号四轮录屏：`artifacts/pv-reality/formal-recording/formal-recording.webm`
- 正式后态：`artifacts/pv-reality/formal-recording/post-progress.json`
- 正式地图前后态：`artifacts/pv-reality/formal-map/prestate/`、`artifacts/pv-reality/formal-map/`
- 正式 Manim artifact：`69bb63f6-8de8-42cf-a7c7-a085fb77903e`
- 可重复导出脚本：`scripts/build_pv_roughcut.ps1`、`scripts/build_pv_final.ps1`
