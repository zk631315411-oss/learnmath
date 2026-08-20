# LearnMath 公式编辑器改造计划

> 需求源：`C:\\Users\\hp\\.claude\\plans\\glm-latex-md-floating-karp.md`
> 更新日期：2026-08-18

## 目标

在现有 `FormulaComposer`、`PDFToolbar`、`BottomSheet` 和截图 overlay 架构内，完成小白友好的公式编辑、PDF 公式框选识别和手写识别。识别结果只预填到公式弹窗，用户预览、微调并确认后才插入，不自动发送。

## 编辑器

- MathLive 开启 `smartMode`，实际验收 `1/2`、`x^2`、`x_i`、`sqrt`。
- 空选区插入模板时将 `#0` 改为 `#?`；有选区时保留 `#0` 包裹内容。
- 在默认 keybindings 后追加 Tab/Shift+Tab，占位符之间双向移动。
- 工具栏与常用公式使用 KaTeX glyph，按钮保留中文 tooltip 和 aria-label。
- 结构导航只提供“选中当前结构”和“移到结构外”，使用公开命令 `selectGroup`、`moveAfterParent`，不依赖私有 atom 父链。

## 一次性快捷插入

- `Ctrl+Shift+G` 或键盘按钮打开，执行一个动作后自动关闭并恢复 MathField 焦点。
- 固定键位：`1` 分数、`2` 根号、`3` 上标、`4` 下标、`5` 积分、`6` 求和、`V` 向量、`M` 矩阵。
- 面板打开时 `Esc` 只关闭面板；面板关闭时 `Esc` 关闭公式弹窗。
- 不持续重映射物理键盘，不影响聊天输入框中的普通数字和变量。

## 识图后端

- 视觉 provider 统一使用智谱 OpenAI 兼容接口和 `glm-4.1v-thinking-flash`，key、base URL、模型和超时全部由环境变量配置。
- 文本 fallback 仅使用显式 `FORMULA_FALLBACK_*` 配置，代码不自动复用视觉 key。
- 文本转写预算为主 provider 8 秒、fallback 5 秒、总预算 15 秒；前端请求超时 18 秒。
- `POST /api/formula/recognize` 使用 Bearer 鉴权和 multipart `image`，响应为 `{latex, display_mode}`。
- 复用图片服务校验真实格式、15 MiB 上传、4000 万像素、压缩和元数据清理。
- 稳定错误码：未配置/上游不可用/限流为 503，超时 504，无效模型输出 502，上传/格式/内容错误为 413/415/422。
- 日志只记录 provider、耗时、状态、错误类型和尺寸，不记录 key、原图或完整响应。

## PDF 公式识别

- 桌面 `PDFToolbar` 和移动 `BottomSheet` 的剪刀入口共用“框选提问 / 识别公式”菜单。
- App 使用同一截图 overlay，通过 `captureMode: 'qa' | 'formula'` 分流。
- 识别期间锁定翻页、切书和重复提交，提供取消；失败保留截图并提供重试和关闭。
- 成功后展开桌面右栏或移动半屏旁批，并通过 `ExternalFormulaDraft {latex, displayMode, nonce}` 预填 FormulaComposer。
- nonce 消费后立即清除，组件重挂载或切换视图不得重复打开。

## 手写画板

- 公式弹窗内折叠展示，支持鼠标、触摸、pointer capture、撤销、清空和识别。
- Canvas 按 DPR 绘制并使用 `touch-action:none`；空白画布禁用识别。
- 导出前裁掉空白并补白底/padding，复用 `/api/formula/recognize`。
- 失败保留笔迹；成功只更新 MathField，仍需用户确认插入。

## 验收

- 后端覆盖认证、成功、sanitize、非法输出、未配置、限流/超时、fallback、413/415/422。
- E2E 覆盖 vec 回归、选中包裹、smartMode、Tab、glyph、结构导航、快捷面板、PDF 识图状态、nonce 幂等和手写画板。
- 运行 `npm run build`、`python -m pytest -q`、全部 Playwright 和 `git diff --check`。
- 在 1440、1280、768、390 的明暗模式做视觉检查。
- 真实 smoke 需先轮换智谱 key，再写入被 Git 忽略的根目录 `.env`；分别验证教材复杂公式和手写公式，不保存原图或 provider 响应。

## 不在本期

不做全量物理键位映射、可定制键盘、完整 atom 面包屑、行内弹条编辑和公式库重构，也不对任何 provider 的价格或长期可用性作承诺。
