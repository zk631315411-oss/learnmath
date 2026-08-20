# 拍照识别题目内容（混合内容识别）实施计划

## Context

第一期公式编辑器改造已完成（smartMode、`#0` 空组修复、结构导航、手写画板、GLM 单公式识图 `POST /api/formula/recognize`）。

本计划是第二期：手机拍照/相册上传整页题目照片 → GLM 识别**题干文字 + 多个公式** → 生成可编辑的「识别结果卡片」→ 用户确认修改后，按当前光标位置插入聊天输入框（文字 + 数学节点混排），**不自动发送**。

与「拍题提问」（图片直接作聊天附件）保持两条独立流程。首版不做坐标化排版恢复，采用线性阅读顺序。

用户方案文档已确认，并并入 5 处修正：
1. 入口统一为**新增加号动作栏**：移动端「拍照识别 / 相册识别」，桌面端「上传图片识别」（补桌面入口缺口）；
2. 公式块编辑**复用 FormulaMathField**（MathLive 封装层），不重构 FormulaComposer 的 Tiptap 编排逻辑；真正共享的只有序列化/插入工具；
3. 单块公式清洗失败**降级为文字块 + 警告**，不整次作废；
4. 测试补充「段落中间插入 block 公式」的节点拆分用例；
5. 预览面板「可选裁剪」作为后期增强，首期不做（整题识别不需要前置框选）。

第二轮评审修正（已逐条验证后并入）：
6. **照片附件沿用当前页蓝色普通提问线程**——手机照片显式标记 `source: 'photo'`，绑定当前教材与页码并创建 `marker_type: 'text'` 的蓝色徽标；只有 PDF 框选才使用 `marker_type: 'screenshot'`、真实 `crop_bbox` 和红色徽标；
7. **光标书签插入**——文件选择器夺焦点、识别期间用户可能继续编辑，插入位置用 ProseMirror bookmark 映射，不能依赖 DOM 光标；
8. **公式降级内容定为占位符** `[此处公式未能结构化识别]`——不回显未过清洗的原始 LaTeX（可能含非法命令/HTML/链接/控制字符）；
9. **总量限制 + 服务端规整**：总文本/总公式/单条 warning 上限，相邻 text 块合并、空白块丢弃，**不做内容去重**（真实题目可合法重复公式）；
10. **display_mode 完全服务端推断**——忽略模型返回值，一律 `choose_display_mode(latex, 'auto')`，与单公式接口行为一致；
11. **识别接口独立超时配置**——混合内容比单公式慢，服务端预算最高 30s、前端 35s，并支持取消。

## 既有资产（已核实，直接复用）

| 资产 | 位置 | 用途 |
|---|---|---|
| 单公式识图端点 | `app/routers/formula.py` POST /recognize（鉴权/MIME 白名单/15MiB/稳定错误码） | PDF 框选、手写画板继续用；新端点照抄其结构 |
| GLM vision provider | `app/services/formula_vision_service.py` | 扩展 `recognize_content` 方法 |
| 图片清洗 | `app/services/image_processing.py` `normalize_image_bytes`（EXIF 服务端转正、PNG/JPEG/WEBP、压缩） | 新端点入参同样过它 |
| LaTeX 清洗 | `formula_conversion_service.py` `sanitize_latex` / `choose_display_mode` | 逐公式块复用 |
| 前端识图 API | `frontend/src/services/api.ts:349` `recognizeFormula(dataUrl, token, signal)`（FormData + AbortSignal） | 新 API 同模式 |
| 客户端压缩 | `frontend/src/utils/imageProcessing.ts` `prepareImageUpload`（≤2000px、≤3.75MB、PNG→JPEG）；其 `loadImage` 解码失败即 HEIC 拦截点 | 照片上传前预处理 |
| 附件通道 | `useChat.handleCapture(imageData, cropBBox)`（useChat.ts:359，MAX 3 张） | 「拍题提问」用途直接复用 |
| nonce 消费机制 | `FormulaComposer` 的 `externalFormula` + `onExternalFormulaConsumed`（App.tsx:66/337/363 已实现） | 混合内容草稿同模式扩展 |
| 层级互斥 | App.tsx `overlaySurface` 状态机 + PDFToolbar/BottomSheet/CaptureBubble | 加号菜单/预览面板纳入互斥 |
| 公式块编辑器 | `FormulaMathField` + `FormulaPreview` | 卡片内公式块编辑复用 |

全项目目前**没有任何 file input**（已 grep 确认），拍照/相册为本期新增。

## 决策汇总（用户已拍板，不再变）

1. 识别完成后默认不保留原图为附件；卡片关闭前可查看原图核对；
2. 不显示模型置信度，统一要求用户核对；
3. 每个公式独立成块，可单独编辑/删除，不合并；
4. 模型对几何图形、表格不伪造内容，只进 warnings；
5. 没有任何可用内容时明确报错，前端保留图片预览并提供重新拍摄或切换「拍题提问」。

## 后端改动

### A. 协议（`app/models/schemas.py`）

```python
class RecognizedTextBlock(BaseModel):
    type: Literal["text"]
    text: str = Field(min_length=1, max_length=500)

class RecognizedFormulaBlock(BaseModel):
    type: Literal["formula"]
    latex: str
    display_mode: Literal["inline", "block"]

class FormulaRecognizeContentResponse(BaseModel):
    blocks: list[RecognizedTextBlock | RecognizedFormulaBlock]  # ≤ 50 块
    warnings: list[str]                                          # ≤ 10 条
```

**总量与规整规则**（服务端强制执行）：
- 总文本长度 ≤ 8000 字符、总公式长度 ≤ 12000、单条 warning ≤ 200 字符；
- **相邻 text 块服务端合并为一个**——避免模型返回碎片导致卡片过度切割；
- 清洗后为空的块直接丢弃；
- **不做内容去重**——真实题目可合法重复同一公式/文字（如并列小问），去重会毁内容。

**总量与规整规则**（服务端强制执行，防模型返回碎片/爆量）：
- 总文本长度 ≤ 8000 字符、总公式长度 ≤ 12000、单条 warning ≤ 200 字符；
- 相邻 text 块服务端合并为一个（避免几十个碎片块把卡片切碎）；
- 清洗后为空的块直接丢弃；
- **不做内容去重**——真实题目可合法重复同一公式/文字，按内容去重会毁掉合法块。

### B. 识别服务（`app/services/formula_vision_service.py` 扩展）

- 新增 `recognize_content(normalized: NormalizedImage) -> tuple[list[Block], list[str]]`；
- GLM prompt 要求：识别题干文字与独立数学公式；按从上到下、从左到右返回；只输出 `{blocks, warnings}`；看不清不伪造；几何图形/表格/无法结构化区域进 warnings；**不要求模型返回 display_mode**；
- JSON 解析沿用 convert 的降级链（json_schema → json_object → 宽松解析），不依赖单一模型的格式扩展；
- **逐块清洗**：text 块去 HTML/链接/控制字符（**允许 CJK**——与单公式接口相反）；formula 块过 `sanitize_latex`；
- **display_mode 完全服务端推断**：一律 `choose_display_mode(latex, 'auto')`，不信任模型返回值，与单公式接口行为一致；
- **单块公式清洗失败的降级内容**：替换为占位文字块 `[此处公式未能结构化识别]` + warnings 追加——**不回显未过清洗的原始 LaTeX**（可能含非法命令/HTML/链接/控制字符）；
- 空 blocks → `FormulaVisionError`（稳定错误码 `invalid_model_output` / `no_content`）；有文字无公式 → 正常返回 + 警告「未检测到可确认公式」；
- 日志沿用 `formula_conversion` 格式（provider/latency_ms/status/error_type），不记录 key、原图、完整模型响应；
- **统一视觉模型**：公式与混合内容识别均使用 `glm-4.1v-thinking-flash`；服务端单公式预算 25s、总预算和混合内容预算 30s，前端请求超时 35s，并保留 AbortSignal 取消。

### C. 路由（`app/routers/formula.py` 内新增）

```python
@router.post("/recognize-content", response_model=FormulaRecognizeContentResponse)
async def recognize_formula_content(image: UploadFile, authorization: Optional[str] = Header(None))
```

鉴权、MIME 白名单、15MiB 读取上限、`normalize_image_bytes`、错误码结构全部照抄 `/recognize`（第 33-54 行模式）。

### D. 后端测试（`tests/test_formula_vision.py` 追加）

单文本块 / 文本+单公式混排 / 多公式顺序保持 / inline+block 混排 / 非法 JSON / 多余字段 / 空 blocks / 超长文本与公式 / 无公式有文本 / 无任何可用内容 / 图形警告 / **单块公式降级为占位文字块（断言内容不是原始 LaTeX）** / LaTeX 注入清洗 / **总量限制（总文本>8000、总公式>12000、warning>200 字符）** / **相邻 text 块合并、空白块丢弃、重复块保留（不去重）** / **display_mode 忽略模型值、结构推断**（模型返回 inline 但含 `\begin{pmatrix}` → block）/ 超时、限流、上游不可用 / 未配置 key 时手动路径不受影响。

## 前端改动

### E. API（`frontend/src/services/api.ts`，紧跟 recognizeFormula）

```ts
export async function recognizeFormulaContent(
  imageDataUrl: string, token?: string, signal?: AbortSignal,
): Promise<RecognizedContent>
```

同一 FormData + AbortSignal 模式。`RecognizedBlock/RecognizedContent` 类型定义放 `frontend/src/types/index.ts`。

### F. 加号动作栏（新组件 `frontend/src/components/ChatPlusMenu.tsx`）

- ChatPanel 输入区左侧 + 按钮弹出菜单；与 BottomSheet/公式弹窗的层级互斥纳入 `overlaySurface` 状态机；
- 移动端（`pointer: coarse` 判定，同 ScreenCapture.tsx:9）：「拍照识别」(`<input type="file" accept="image/*" capture="environment">`)、「相册识别」（不带 capture）；
- 桌面端：「上传图片识别」（不带 capture）；
- 两个隐藏 file input 挂在组件内，选完统一进预览面板；菜单留扩展位（粘贴图片识别属后期）。

### G. 图片预览 + 用途选择（新组件 `frontend/src/components/PhotoPreviewSheet.tsx`）

- 选图后：FileReader → dataUrl → `prepareImageUpload` 预处理；**解码失败（HEIC 等）→ 明确提示「请改选 JPEG/PNG，或使用拍题提问」**；压缩后仍超限 → 提示重新拍摄；
- 面板展示预览 + 三个操作：「拍题提问」「识别公式」「取消」（取消返回输入区，不报错）；
- 拍题提问 → 压缩后图走附件流程，**不经过识别**——但必须显式标记来源（评审修正①，防止手机照片被落库成 PDF 页面标记）：
  - `PendingImage` 增加 `source: 'pdf-capture' | 'photo'` 字段；照片传 `source: 'photo'` + `cropBBox: null`；
  - 发送时按 `source` 区分 marker 语义：`pdf-capture` 维持现状（`marker_type: 'screenshot'` + 当前教材/页码 + 真实 `crop_bbox`，显示红色徽标）；`photo` 沿用纯文字提问逻辑（`marker_type: 'text'` + 当前教材/页码 + `marker_y_ratio: 0`，显示蓝色徽标）；
  - `photo` 根线程保留照片 `thumbnail`，QA 首轮仍上传照片，并可同时使用当前教材页上下文；首轮返回的 `screenshot_context_id` 落库，后续追问复用该上下文，无需重新上传照片；
  - `photo` 的 `crop_bbox` 必须始终为 null，不得生成默认中间 80% 的兜底框，也不得进入 PDF 框选定位逻辑；
  - 若未来允许在未打开教材/页码的场景上传照片，再单独定义无页面普通聊天线程；本期入口位于当前阅读页聊天区，只实现蓝色页内线程；
- 识别公式 → `recognizeFormulaContent` → 成功打开识别结果卡片；识别中禁重复提交、可取消（AbortSignal）；失败保留预览 + 重试 + 「转为拍题提问」出口。

### H. 识别结果卡片（新组件 `frontend/src/components/formula/RecognizedContentCard.tsx`）

- 原图缩略图（点按放大查看，卡片关闭前可核对）；
- blocks 线性渲染：text 块 = textarea 就地编辑；formula 块 = `FormulaPreview` 渲染 + 「编辑」按钮 → 弹层内复用 `FormulaMathField` + `FormulaPreview`，确认回写该块；
- 块可删除；公式块可切换行内/独立；
- warnings 以黄色提示条展示；
- 卡片内返回路径完整（评审补充）：编辑文字/公式、重新识别、**转为拍题提问**（识别质量差时原图直接转问答流程——卡片关闭前原图始终可用）、取消、插入聊天；
- 底部操作：重新识别 / 转为拍题提问 / 复制为 LearnMath 内容 / 复制纯文本 / 插入聊天；
- 复制两个按钮：「复制为 LearnMath 内容」= Markdown + LaTeX（可粘贴回公式编辑器）；「复制纯文本」= 普通文字 + LaTeX 源码；浏览器支持时用 `navigator.clipboard.write` 双写 `text/plain` + `text/markdown`，不支持则回退 `writeText` 纯文本；
- 390px 视口不溢出，与 MathLive 虚拟键盘不叠层。

### I. 序列化 + 插入工具（新文件 `frontend/src/components/formula/recognizedBlocks.ts`）

卡片、复制、插入三处的唯一共享逻辑：

- `blocksToMarkdown(blocks)`：inline → `$…$`，block → `$$…$$`（复制结果可重新粘贴回编辑器解析）；**text 块中的 `$` 一律转义为 `\$`**，否则"价格是$5和$10"这类文字粘贴/重解析时会被误认为数学定界符；
- `blocksToPlainText(blocks)`：文字 + LaTeX 源码（不带定界符，供外部应用）；
- `insertRecognizedBlocks(editor, blocks)`：当前 Tiptap 选区依次插入**字面 text 节点**（不走 markdown 解析，同上防 `$` 重解析）与 inlineMath/blockMath 节点；**段落中间插 blockMath 时用 `insertContentAt` 拆分段落**；保留用户已有内容；完成后编辑器恢复焦点。

### J. 链路串通（App → … → ChatPanel → FormulaComposer）

- App 新增 `recognizedDraft: { blocks: RecognizedBlock[]; nonce: string } | null` state；
- 沿用 `externalFormula` 同款 nonce 消费模式：FormulaComposer 新增 `externalContent` prop + `onExternalContentConsumed`；收到新 nonce → `insertRecognizedBlocks` **直接插入编辑器**（卡片本身已是确认环节，不再过公式弹窗）→ 消费回调清空 draft；重挂载/切换线程/面板档位变化不重复插入；
- **光标书签插入**（评审修正⑦）：用户点击「识别公式」时用 `editor.state.selection.getBookmark()` 记录选区；文件选择器夺焦点、识别期间用户继续编辑都不可避免——插入前用 bookmark 映射到最新文档位置；无有效选区时明确追加到末尾；编辑器未挂载（如 BottomSheet 收起）时草稿暂存不消费，挂载后再插入；插入成功才消费 nonce（只消费一次）；
- 透传链路与 externalFormula 相同。

### K. 样式（`frontend/src/index.css`）

加号菜单、预览面板、识别卡片样式 + 暗色模式变体。

## 边界条件（验收清单）

- 图片取消：返回输入区，不提示错误；
- 图片无法解码（HEIC/HEIF）：明确提示改选 JPEG/PNG 或转拍题提问；服务端 HEIC 转换留后续；
- 图片过大：先客户端压缩，仍失败提示重拍；
- 识别中：禁止重复提交，允许取消；
- 识别失败：保留原图预览，提供重试与转拍题提问；
- 无公式有文字：显示警告，不伪装成功；
- 单块公式非法：降级为占位文字块 `[此处公式未能结构化识别]` + 警告，**不回显原始 LaTeX**；
- 复杂图形/表格：进 warnings，不伪造；
- 多公式：独立编辑、删除、顺序保持（从上到下、从左到右）；
- 插入：按书签映射的原光标位置，识别期间继续编辑不串位；已有文字不覆盖；无有效选区追加末尾；完成后保持焦点；**不自动发送**；
- text 块含 `$` 不误解析为数学节点（字面节点插入 + markdown 转义双保险）；
- nonce：重挂载/切线程/面板变化不重复插入；编辑器未挂载时草稿暂存不消费；
- 照片附件：`source: 'photo'` + `crop_bbox: null` → 绑定当前教材/页码并创建 `marker_type: 'text'` 的蓝色徽标；保留 thumbnail 与 `screenshot_context_id`，但不进入 PDF 框选定位逻辑；
- 原图：卡片关闭前可查看；插入后默认不作附件保留。

## 测试

### 后端
见 D 节清单，`pytest tests/test_formula_vision.py` 全量 + `tests/test_formula_conversion.py` 不回归。新增重点：降级块内容必须是占位符而非原始 LaTeX；总量限制触发；相邻 text 块合并；空白块丢弃；模型返回的 display_mode 被服务端推断覆盖。

### 前端 E2E（新文件 `frontend/e2e/photo-recognize.spec.ts`，mock 路由模式照抄 formula-composer.spec.ts）

1. 加号菜单入口在桌面/移动视口渲染正确（菜单项差异）；
2. mock `/api/formula/recognize-content` → 卡片渲染 → 文字块编辑 → 公式块编辑回写 → 插入 → 断言 Tiptap 文档含文字 + inlineMath 节点；
3. **段落中间插入 blockMath：前后文字不丢、节点正确拆分**；
4. 输入框已有文字时光标处插入、无覆盖；
5. 复制 Markdown 与纯文本，与插入序列化结果一致；
6. nonce 防重复插入（预填后切 page/thread 不重复）；
7. 识别失败重试、取消；解码失败提示（mock 坏图）；
8. 插入后不自动发送；
9. 390px 视口卡片、公式编辑弹层、虚拟键盘不溢出；
10. **书签插入**：mock 识别延迟期间用户继续打字，插入仍落在原光标处；
11. **text 块含 `$` 的插入与复制不产生意外数学节点**；
12. **拍题提问路径**：选照片走拍题提问 → 断言 QA 请求携带照片、当前 `textbook_id/page_number`，但 `crop_bbox` 为 null；创建 `marker_type: 'text'` 的蓝色徽标并保留 thumbnail，不创建红色截图徽标；
13. **照片追问上下文**：照片首轮返回的 `screenshot_context_id` 被写入蓝色线程，后续无新图片追问复用该 ID，且不补造 `crop_bbox`；
14. **PDF 框选回归**：`source: 'pdf-capture'` 仍创建红色 `screenshot` 徽标，保留真实 `crop_bbox`，不受照片分支影响。

### 真机矩阵
iOS Safari 拍照 / iOS Safari 相册 / Android Chrome 拍照 / Android Chrome 相册 / 横竖屏切换 / 弱网取消与重试 / JPEG、PNG、HEIC 行为 / 识别插入后实际发送。

## 明确不做（本期）

- 坐标化排版恢复（首版线性阅读顺序）；
- 服务端 HEIC 转换；
- 预览面板可选裁剪（后期增强，对付杂乱页面）；
- 粘贴图片识别（后期）；
- FormulaComposer 的 Tiptap 编排逻辑大重构（共享面只到 recognizedBlocks 工具）。

## 实施顺序

1. 后端协议 + 测试（A/B/C/D）；
2. 序列化插入工具（I）——卡片与插入都依赖它；
3. 识别结果卡片（H）；
4. 入口 + 预览 + 链路串通（E/F/G/J/K）；
5. E2E + 真机验收。

## 验证方式

1. `pytest tests/test_formula_vision.py` + 全量 `python -m pytest -q` 不回归；
2. `cd frontend && npm run build` + `npx playwright test e2e/photo-recognize.spec.ts`；
3. 无 GLM key 时：加号菜单可见、识别报可重试错误、拍题提问流程不受影响；
4. 真实 GLM key smoke test：一道印刷体题目照片 → 卡片 → 修改文字与公式 → 插入 → 手动发送，记录模型/耗时/图片尺寸/人工校验结果（不记录 key 与原图）。
