# LearnMath 前端重构与地图页改版执行计划

> 版本：v2  
> 日期：2026-08-18  
> 来源：`FRONTEND_REDESIGN_PLAN.md`、`FRONTEND_REDESIGN_TEST_PLAN.md`、`MAP_PAGE_REDESIGN_PLAN.md`  
> 目标：用一份计划统一前端重构回归和地图页下一轮改版，执行完成后可直接按本文件验收。

## 1. 计划定位

原有重构已经落地了地图/阅读双模式、PDF toolbar、overlay 状态机、BottomSheet、CaptureBubble、线程规则和学习地图 API。本计划不推翻这些架构，而是在其上完成两类工作：

1. **全局回归**：确认 PDF、聊天、浮层、移动端、认证、evidence 和地图主链路没有行为退化。
2. **地图改版**：解决当前地图页像教材目录、教材不可发现切换、章节编号重复、学习状态不明显和章节卡行为含混的问题。

地图改版是新的产品基线，优先级高于旧测试计划中与地图行为冲突的条目。

## 2. 硬约束与非目标

- 技术栈保持 React + Tailwind，不引入新依赖。
- 不修改问答/SSE/evidence/learning-map API 契约。
- 不使用手工章节页码映射表；章节落页继续使用 evidence 来源页或 section-page 扫描。
- 前端 E2E 一律 mock `/api/qa/solve-stream`，禁止把真实 LLM 额度消耗纳入自动化回归。
- 地图章节详情第一版采用“分节 + 节点列表”，不伪造没有数据支撑的连线图。
- `useTextbookPreference` 是教材选择的唯一状态源；地图和阅读模式不得各自维护教材状态。
- 地图 session 缓存必须按“用户身份 + 教材”隔离；不得让匿名用户、登录用户或不同登录用户共享学习进度缓存。

## 3. 统一信息架构

### 3.1 两种顶层模式

- **地图模式**：继续学习、教材选择、章节网格、章节详情、需要巩固。
- **阅读模式**：PDF、旁批/对话、PDF toolbar、记录和工具 drawer。
- 首次进入某教材默认地图；已有该教材 evidence 和 workspace 时恢复阅读模式及页码。
- 每本教材独立保存 `learnmath.workspace.<textbookId>`，教材切换不能串用页码、地图和对话上下文。

### 3.2 教材选择入口

地图模式不再依赖用户寻找 Header 控件。在地图标题区提供唯一主入口：

```text
学习地图
[ 高等代数（上册）丘维声  ▾ ]                         [刷新]
```

阅读模式保留紧凑 Header 选择器，地图模式隐藏重复的 Header 选择器。两者都调用同一个 `setTextbookId`。

交互规则：

- 菜单列出 `TEXTBOOKS` 全部教材，当前教材有勾选状态。
- 地图使用应用内可访问下拉菜单（`button + listbox`），不依赖各浏览器样式不一致且无法稳定截图的原生 `select`；支持点击外部和 `Esc` 关闭。
- 切换后标题立即更新，章节区清空旧教材内容后显示新教材骨架或缓存。
- 旧教材请求返回时不得覆盖新教材状态。
- 地图请求期间选择器仍可用；仅 CaptureBubble 流式回答期间禁用切书。
- 流式完成、报错或取消后选择器必须恢复。
- 认证失败时地图仍可显示并提供“打开教材”逃生入口。

## 4. 地图页新行为

### 4.1 首页结构

```text
继续学习
第 2 章 · 矩阵的秩                              [继续学习]

学习地图
[教材选择器]                                      [刷新]
6 章 · 1514 个知识点 · 12 个已探索知识点

[第 1 章卡] [第 2 章卡] [第 3 章卡]
[第 4 章卡] [第 5 章卡] [第 6 章卡]

需要巩固（有内容时展开；无内容时只显示一行轻量状态）
```

### 4.2 章节卡行为

- 卡片主点击进入地图模式的章节详情，不直接卸载地图进入 PDF。
- 卡片显示明确的“查看地图”动作。
- 章节详情顶部提供“开始本章”，继续走现有 section-page 落页逻辑进入 PDF。
- “继续学习”和“开始复习”仍可直接进入对应来源页，保持高频动作短路径。
- 单章节点失败时显示“加载失败 · 重试”，点击必须真正重试，不得跳阅读。

### 4.3 章节标题与状态

新增 `chapterTitle` helper，只处理显示，不改变 API 参数：

```text
输入：第1章 线性方程组的解法
编号：第 1 章
标题：线性方程组的解法
```

- 支持 `第1章`、`第 1 章`、`1.` 等前缀。
- 解析失败时使用原始字符串，不丢数据。
- 不使用数组 index 推导章号，避免绪论、附录等章节错位。

状态展示使用 `status_counts` 和 `exploration_progress`：

- 无记录：`尚未开始 · N 个知识点`。
- 有学习中：显示 `N 个学习中`。
- 有待巩固：用 rose 状态突出 `N 个需巩固`。
- 全部掌握：显示 `全部掌握`。
- 进度条使用分段状态色；所有状态同时提供文字或图标，不依赖颜色单独表达。

### 4.4 章节详情

- 复用 `ChapterMapView` 的分节、展开和节点状态逻辑，改造成地图主内容区可用的宽布局。
- 顶部提供“返回全部章节”和“开始本章”。
- 节点显示名称、状态、受阻标记和来源提问入口。
- 默认显示有记录或被阻塞节点；“显示全部”保留为显式开关。
- 来源提问已删除时按钮禁用并提供 tooltip，不显示失效跳转。
- 来源提问缺失时，“开始/复习”动作仍可用，按第 4.5 节的 section-page 规则落页。

### 4.5 继续学习与复习

- `needs_review` 优先于 `learning`。
- 有 evidence 时展示具体章节/节点和来源提问。
- 没有 evidence 时显示“从教材第一页开始”，按钮为“打开教材”。
- 需要巩固最多展示 6 条；无内容时不渲染大块空白列表容器。
- 节点阅读/复习落页统一使用以下优先级：来源提问的精确页码 → 当前节点 `section` 的 section-page → 本章第一个 section 的 section-page → 章节比例插值。
- section-page 未命中时仍进入阅读模式；插值页只作为可用兜底，不承诺精度。

## 5. 加载、缓存与性能基线

- 每次地图加载或刷新周期只请求一次 `/learning-map/chapters`，地图首页和侧栏共享 `useMapHomeData`；手动刷新和 evidence 更新后的后台刷新允许重新请求。
- 后端章节统计使用一次聚合 KG 查询，禁止恢复按章 N+1 请求。
- 章节接口返回后立即渲染真实章节卡，不等待全部 `/nodes` 请求。
- 各章节点请求并行，单章完成即更新；单章失败不阻塞其他章节。
- 节点尚未返回时显示“详情准备中”，但保留章节总数和已有进度。
- session 缓存按“用户身份 + 教材”隔离；切回已加载教材先展示当前身份缓存，再按现有策略刷新。身份变化时清除或切换缓存命名空间。
- 新 evidence 落库后后台刷新地图，不遮挡当前页面。
- 目标：页面框架立即出现，章节接口返回后立即显示真实章节卡，节点详情随后渐进完成。本地真实接口耗时必须记录；1.5 秒作为后续 KG 聚合优化目标，不把当前 Neo4j 冷启动/远程查询延迟伪装成前端回归项。

## 6. 全局缺陷修复清单

### F1（P1）流式回答中翻页导致页码状态分裂

- 流式期间禁用 PDF toolbar 上一页、页码输入、下一页和移动端 BottomSheet 动作。
- 保留当前页码和缩放显示，避免页码退回 `1 / —`。
- `handlePageChange`、sheet 档位切换、打开旁批/工具 drawer 都保留 App 层守卫。

### F2（P1）失败章节卡行为错误

- 失败卡点击 `onRetry`；正常卡才进入章节详情。

### F3（P2）移动端页码控件重复

- 移动端删除 PDFToolbar 的重复页码/翻页组，统一由 BottomSheet 把手栏提供。

### F4（P2）右栏宽度断点错误

- 右栏 `360px` 默认，只有 `min-width: 1440px` 才扩展到 `400px`。

### F5（P2）截图待发徽标位置错误

- `pendingImages` 徽标挂在 AI 旁批按钮，不挂在记录/地图按钮。

### F6（P2）CaptureBubble 过高

- 最大高度从约 `72dvh` 收到 `60dvh`，内部内容滚动。

### F7（P3）本页视图预览过长

- 回答预览限制三行，完整内容在对话视图查看。

### F8（P2）匿名登录失败导致永久骨架

- `useAuth` 暴露 `authReady`。
- startup 只等待认证初始化结束；认证失败按无 evidence 进入地图并保留阅读逃生入口。
- `useMapHomeData` 接收稳定的身份 cache scope（如 `userId`，匿名阶段使用稳定的 `deviceId`）；不得把原始 JWT 作为持久化 key。

### F9（P1）流式期间切教材/切地图卸载回答

- 流式期间禁用地图/阅读切换和教材选择器。
- 完成、失败和取消后恢复入口。

### F10（P1）章节序号重复

- 采用第 4.3 节的 `chapterTitle` helper，禁止额外使用数组 index 作为章号。

### F11（P2）章节卡缺少状态摘要

- 采用第 4.3 节的状态摘要和分段进度条，使用 API 已返回的 `status_counts`。

### F12（P2）移动端品牌名折行

- 小于 `sm` 时隐藏品牌文字或保证品牌容器不收缩，教材选择器不得被挤压。

### F13（P3）body 仍残留旧背景令牌

- 删除 `frontend/index.html` 的 `bg-slate-50`，统一使用 `--lm-bg`。

## 7. 视觉与响应式规范

- 地图内容沿用 `max-w-6xl`；桌面三列、平板两列、移动端单列。
- 继续学习区控制高度，突出一个主动作，不做营销式 Hero。
- 章节卡固定尺寸，状态标签和加载文案不得造成布局跳动。
- 主色使用 indigo；状态使用 amber、emerald、rose、slate，避免单一蓝紫色。
- 圆角沿用 12/16px 体系，避免卡片嵌套卡片。
- 正文、教材名、章节名和进度元数据达到可读对比度。
- 所有图标按钮提供 tooltip 和 `aria-label`；移动端/触屏点击目标不小于 44px，桌面 32px icon-button 体系维持不变。

响应式要求：

- 1440/1280：章节三列，教材选择器与刷新按钮同一行。
- 768：章节两列，动作区允许换行。
- 390：章节单列，教材菜单全宽或底部 sheet，主按钮不溢出。
- 812×375 横屏：无横向滚动，把手栏可见。

## 8. 实现文件

| 文件 | 任务 |
|---|---|
| `frontend/src/components/MapHome.tsx` | 地图首页、教材标题区、章节卡、复习空状态和章节详情切换 |
| `frontend/src/components/ChapterMapView.tsx` | 分节/节点详情的宽布局和学习动作 |
| `frontend/src/App.tsx` | 地图/阅读模式入口、教材选择、章节详情与 PDF 切换 |
| `frontend/src/hooks/useMapHomeData.ts` | 渐进加载、按身份/教材缓存、教材切换和过期请求保护 |
| `frontend/src/hooks/useTextbookPreference.ts` | 教材选择唯一状态源和持久化 |
| `frontend/src/utils/chapterTitle.ts` | 章节编号/标题格式化 |
| `frontend/src/components/PDFToolbar.tsx` | F1/F3/F4 相关控件状态 |
| `frontend/src/components/BottomSheet.tsx` | F1/F3/F5 相关移动端状态 |
| `frontend/src/components/CaptureBubble.tsx` | F6 |
| `frontend/src/components/PageNotesPanel.tsx` | F7 |
| `frontend/src/hooks/useAuth.ts` | F8 |
| `frontend/index.html` | F13 |
| `frontend/e2e/frontend-redesign.spec.ts` | 全局回归与地图新增 E2E |

## 9. 自动化测试计划

### 9.1 构建与后端

```bash
cd frontend && npm run build
python -m pytest -q
python -m pytest tests/test_learning_map_api.py tests/test_section_page.py -q
python -m pytest tests/test_evidence_db.py tests/test_evidence_pipeline.py tests/test_evidence_reporting.py -q
```

同一时间戳证据测试只验证集合内容或显式 ID 排序，不假设批量插入的随机 UUID 顺序。

### 9.2 前端 E2E（全部 mock）

mock 基础设施（先改后写用例）：

- `mockApp(page, { initialHistory = [], mapByTextbook, chapterDelayByTextbook, nodeDelayByChapter, failingChapterAttempts } = {})` 每用例独立初始化 history 和地图数据。
- 地图 mock 必须按 `textbook_id` 返回不同章节，并按章节返回不同节点；支持按教材延迟 chapters、按章节延迟 nodes，以及配置某章前 N 次请求失败后恢复。
- 测试记录 `/learning-map/chapters`、`/learning-map/nodes` 请求次数，允许验证一次共享请求、切书旧响应隔离和单章重试。
- GET `/api/chat/history` 按请求中的 `textbook_id` 过滤预置记录；POST **追加**记录（生成新 id 返回），不得覆盖预置；PATCH `/api/chat/history/<id>` 按 URL 中的 id 定向 merge。
- 既有 CaptureBubble 用例用空 `initialHistory`，M 系列用例按需预置。

既有全局用例继续保留：

- 对话视图翻页保持与跨页横幅跳回。
- 本页视图新线程、对话视图 follow-up 线程规则。
- 本页数据与页码过滤、空页 starter prompts。
- drawer 与框选浮层互斥。
- CaptureBubble 追问、展开到右栏和三态关闭。
- 地图/阅读切换不丢对话。
- 跨教材提问记录跳转完成切书、落到来源页并加载对应对话；复用 M1/M2 的双教材 mock，不降级为人工核对。
- 移动端 BottomSheet 三档、入口和截图计数徽标（ImageCropper 在 mobile 项目不稳定时，徽标断言可降级为人工核对并在报告中说明）。
- 暗色模式、四视口无溢出、流式期间入口禁用。

新增或改写地图用例：

| 编号 | 场景 | 核心断言 |
|---|---|---|
| M1 | 地图教材选择 | 菜单包含全部教材；切换后标题、章节和统计同步，旧响应不能覆盖新教材；每次加载周期只发一次共享 chapters 请求 |
| M2 | 教材持久化与 workspace 隔离 | 刷新恢复选择；甲书和乙书的 view/page 不串线；匿名身份与登录身份缓存不串线 |
| M3 | 章节渐进加载 | chapters 返回后先显示真实卡片；节点请求延迟时页面不保持整页骨架；单章失败可重试 |
| M4 | 章节标题与状态 | 不重复显示章号；mock learning/needs_review/mastered 时状态摘要和分段条正确 |
| M5 | 章节详情 | 点击卡片留在地图模式；显示分节和节点；返回按钮恢复章节网格 |
| M6 | 章节阅读落地 | 来源页、当前节点 section-page、本章首节 section-page 按优先级落地；命中时落到目标页，未命中仍可进入阅读 |
| M7 | 空状态与错误状态 | 无 evidence、无待复习、整页失败和单章失败均有可操作出口 |
| M8 | 流式期间阅读入口锁定 | 阅读模式 Header 教材选择器和地图/阅读切换按 F1/F9 规则禁用，完成后恢复；地图模式教材选择器的正常可用性由 M1 覆盖 |

### 9.3 视觉回归

截图归档到 `artifacts/visual-YYYYMMDD/`，至少覆盖；必须由最终代码重新生成，旧构建截图不得作为暗色验收证据：

| 场景 | 1440×900 | 1280×800 | 768×900 | 390×844 | 812×375 |
|---|---|---|---|---|---|
| 地图首页 | 明+暗 | 明 | 明+暗 | 明+暗 | 明 |
| 地图教材菜单 | 明 | 明 | 明 | 明 | 明 |
| 章节详情 | 明+暗 | 明 | 明 | 明+暗 | 明 |
| 阅读模式（含 drawer） | 明+暗 | 明 | — | — | 明 |
| BottomSheet 半屏 | — | — | 明 | 明+暗 | 明 |
| CaptureBubble 完成态 | 明 | — | — | — | — |

人工检查主色、状态色、暗色对比度、教材长文本、章节标题、圆角阴影和横向溢出。地图首页截图须用有 evidence 的测试账号（含 learning/needs_review 节点），覆盖继续学习卡有数据态。

### 9.4 section-page 精度与 evidence 回归

- 4 本教材各抽 3 章，真实调用 section-page；精确命中时与 PDF 目录起始页误差不超过 3 页。
- evidence 数据库、投影和报告链路继续运行既有单测。
- 静态确认 `useChat` 请求继续携带 `chat_id`、`page_number`、`textbook_id`、`crop_bbox` 和 `screenshot_context_id`。

## 10. 执行顺序

1. 先完成 F1–F13 中仍未落地的修复，并确认全局构建、后端和既有 E2E 基线。
2. 实现教材选择入口和教材切换回归（M1/M2）。
3. 实现章节标题、状态摘要、渐进加载和单章重试（M3/M4）。
4. 将章节详情接入地图主区域，调整章节卡点击行为和 section-page 入口（M5/M6）。
5. 收紧空状态、响应式和视觉令牌，完成 M7/M8。
6. 跑全套 E2E、视觉截图、section-page 精度抽测和 evidence 回归。
7. 输出测试报告，记录未完成项和实际计时，不以“单元测试通过”替代视觉验收。

执行状态以测试报告为准。计划中的勾选框仅在最终构建、全量 pytest、全量 E2E、接口计时和视觉归档全部复验后统一更新，避免把“代码已写”误记为“交付已验收”。

## 11. 验收标准

### 必须通过

- [x] 地图页能选择全部教材，切换和刷新不会串数据。
- [x] 地图缓存按身份和教材隔离，匿名用户与登录用户不会看到彼此的进度。
- [x] 章节编号只显示一次。
- [x] 章节卡有状态摘要，零进度状态不再只显示机械的 `0 / N`。
- [x] 章节卡进入章节详情；“开始本章”正确进入 PDF。
- [x] 复习节点在来源提问缺失时仍能按 section-page 规则进入合理阅读位置。
- [x] 章节接口返回后立即显示卡片，节点渐进加载，失败可重试。
- [x] 流式回答中不能翻页、切书、切地图卸载回答。
- [x] 首访地图、再访恢复阅读、移动端 BottomSheet、drawer、CaptureBubble 和 evidence 链路全部回归通过。
- [x] 明暗模式和 390/768/1280/1440/812×375 视口无明显溢出或遮挡。
- [x] `npm run build` 通过，后端测试通过。
- [x] 交付报告记录章节接口首访/重复请求和节点接口耗时；若超过 1.5 秒，已注明瓶颈和后续优化方向。

### 允许记录但不阻塞

- section-page 未命中时的插值页，只要求不白屏和可进入阅读。
- 当前 KG 节点名称中的 LaTeX 纯文本显示，另列为后续渲染优化。
- 视觉截图中不影响功能的字号、间距微调，须记录后续迭代项。

## 12. 交付物

1. 本计划对应的前端代码和地图章节详情。
2. 更新后的 `frontend/e2e/frontend-redesign.spec.ts` 及地图新增用例。
3. `docs/FRONTEND_REDESIGN_TEST_REPORT.md`：修复清单、测试结果、视觉验收和精度抽测。
4. `artifacts/visual-YYYYMMDD/` 全套截图。
5. 构建、pytest、E2E 和接口计时摘要。
