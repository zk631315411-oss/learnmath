# LearnMath 前端重构 · 修复与测试计划（执行版）

> 输入：`../08-deprecated/FRONTEND_REDESIGN_PLAN.md`（v2 已定稿）+ 负责人代码审查发现（2026-08-18）
> 执行顺序：**先完成 §0 修复，再跑 §1 测试，最后按 §2 对照验收并出测试报告**。
>
> **硬约束**：
> 1. 禁止任何实时 LLM 调用：前端 E2E 一律用 `page.route` mock `/api/qa/solve-stream`（沿用 `frontend/e2e/frontend-redesign.spec.ts` 的 `mockApp` 模式）；后端测试用 TestClient + mock。
> 2. 不引入新依赖；不改后端问答/SSE/evidence/learning-map API 契约。
> 3. Playwright 项目沿用现有 `chromium-desktop` / `chromium-mobile` 划分。

---

## 0. 前置修复清单（审查发现，先修后测）

### F1（P1）流式回答中翻页导致页码状态分裂
- **原理**：`App.tsx` 的 `handlePageChange` 在 `bubbleStreaming` 时直接 return，但 `PDFViewer` 内部 `handlePageChange` **先 `setCurrentPage` 再回调 App**——App 拒绝更新时 PDF 已经翻页，App 的 `currentPage` 停在旧页 → CaptureBubble 钉在旧页码却渲染在新页面上，工具栏页码与右栏数据分裂。
- **修法**（不动 PDFViewer；执行 AI 复核指出置 null 会让页码显示回退到 `1 / —`，采纳并改为保显示、禁动作）：
  1. `PDFToolbar` 新增 `navigationDisabled?: boolean`：流式中禁用 上一页/页码输入/下一页（**保留页码显示与缩放**——缩放按页比例重排 bubble，安全）。
  2. `BottomSheet` 新增 `interactionLocked?: boolean`：流式中禁用把手栏全部动作按钮（prev/next、页码档切换、AI 旁批、PanelLeft），页码显示保留。移动端 sheet 档位切换会改变 `overlaySurface` 从而卸载 bubble，必须一并禁掉。
  3. App 侧双保险：`onStageChange` / `onOpenChat` / `onOpenUtility` 回调在 `bubbleStreaming` 时直接 return；`handlePageChange` 的 `bubbleStreaming` 守卫保留（goToPage 是 PDFViewer 唯一翻页通道，已确认无滚动驱动翻页）。
- **回归**：E10。

### F2（P1）地图章节卡"加载失败 · 点击重试"文案与行为不符
- **现状**：`MapHome.tsx` 失败章卡点击走的是 `onOpenChapter`（进入阅读），不是重试。
- **修法**：失败章卡 `onClick` 改为 `onRetry()`；正常章卡保持 `onOpenChapter`。

### F3（P2）移动端页码控件重复
- **现状**：移动端 `PDFToolbar`（页码/翻页组）与 `BottomSheet` 把手栏（上一页/页码/下一页）同时常驻，违反"把手栏收编移动端页码/翻页"的单一出处意图，浪费竖向空间。
- **修法**：`App.tsx` 移动端分支**删除 PDFToolbar 渲染**（其右侧功能组 mobile 下本已隐藏）。移动端页码/翻页/框选/记录/地图全部以把手栏为入口。桌面端 toolbar 不变（验收 §P1a-3 针对桌面）。

### F4（P2）右栏宽度断点与设计表不符
- **现状**：`App.tsx` 右栏 `w-[360px] xl:w-[400px]`（xl=1280），设计表为 ≥1440 才 400px。
- **修法**：改为 `w-[360px] min-[1440px]:w-[400px]`。

### F5（P2）把手栏 pendingCount 徽标挂错按钮
- **现状**：`BottomSheet.tsx` 截图待发计数挂在「记录/地图」(PanelLeft) 按钮上；pendingImages 属于聊天语义。
- **修法**：徽标移到「AI 旁批」按钮（与未读红点同按钮）。

### F6（P2）CaptureBubble 过高
- **修法**：`CaptureBubble.tsx` 卡片 `max-h-[72dvh]` → `max-h-[60dvh]`（设计意图 ~半屏封顶、内部滚动）。

### F7（P3）本页视图卡片预览过长
- **修法**：`PageNotesPanel.tsx` `<details>` 内 answer 容器加 `line-clamp-3`（纯文本预览即可，不渲染 Markdown）。

### F8（P2）匿名登录失败时首屏永久骨架
- **原理**：startup effect 的 gate 含 `!user.token`，`useMapHomeData` 无 token 时 `ready` 恒 false → 匿名登录一旦失败，`startupReady` 永远不成立，MapHome 永远骨架，且无逃生口。
- **修法**：
  1. `useAuth.ts` 暴露 `authReady`（`initAuth` 结束即置 true，无论成败）。
  2. `App.tsx` startup gate 改为：`if (!textbookId || !authReady) return; if (user.token && !mapHome.ready) return;`
  3. 效果：auth 失败（无 token）→ 按无证据处理进地图并放行 `startupReady`（「直接开始阅读」逃生口可用）；auth 成功 → 维持原恢复逻辑。
- **注意**：不能简单删掉 `!user.token`——匿名登录进行中的无 token 窗口期会误判"首次进地图"且 `startupKeyRef` 锁死，导致有证据用户丢失 workspace 恢复。必须等 `authReady`。

### F9（P1）流式期间可切教材/切地图，变相卸载 CaptureBubble
- **原理**（执行 AI 复核发现，确认成立）：header 的「地图/阅读」切换与教材下拉在 bubble 流式期间仍可操作。切地图会卸载整个 reader 子树（bubble 随之卸载）；切教材更糟——除卸载 bubble 外还触发 `chat.clearMessages()`，流式中的消息列表被清空（落库不受影响的只有数据层，UI 上下文全丢），违反"流式中禁止关闭"语义。
- **修法**：header 的 view 切换按钮与教材 select 加 `disabled={bubbleStreaming}`，并在 `onChange` 回调里加 `bubbleStreaming` 守卫。
- **回归**：E10（一并断言）。

### F10（P1）地图章节卡序号重复
- **现状**（负责人视觉验收发现）：卡片标签「第 N 章」与 `chapter.chapter` 自带的"第N章"前缀重复（"第 1 章 / 第1章 线性方程组的解法"）；且 index 序号与真实章号在有附录/绪论的教材上会错位。
- **修法**：删掉「第 {index+1} 章」标签行，标题直接用 `chapter.chapter`。

### F11（P2）章节卡缺少状态摘要（设计保真度）
- **现状**：`chapters` 接口返回的 `status_counts` 未使用，卡片只有探索进度+知识点数。设计 mock 的状态摘要（"2 学习中"、"⚠1 需巩固"）是卡片与「需要巩固」列表的视觉联动信号。
- **修法**：卡片底部加状态摘要行：有 needs_review 时用 rose 警示色显示「⚠ N 需巩固」，有 learning 时显示「N 学习中」；全 mastered 显示「全部掌握」；全 unexplored 不显示。

### F12（P2）移动端 header 品牌名折行
- **现状**：375px 下「学数有道」四字折成两行竖排。
- **修法**：品牌文字加 `hidden sm:inline`（<sm 只留 logo 方块），或容器加 `shrink-0` 并收窄 select。

### F13（P3）body 令牌残留
- **现状**：`frontend/index.html` 的 body 带 `bg-slate-50` class，压住 `index.css` 的 `var(--lm-bg)`（暗色下 body 仍是浅色；当前被 App 根容器全幅背景遮住，无视觉影响，但令牌系统留了矛盾源）。
- **修法**：删除 body 上的 `bg-slate-50`（保留 text/antialiased 类）。

### 视觉验收补充（负责人已验，无需返工）
- 明暗双模、375 单列、无横向溢出、控制台零报错：**通过**。
- 章节卡真实落地：点第 2 章 → section-page 真实扫描落到第 52 页（合理）：**通过**。
- 待补证据：**有数据态**的继续学习卡（含 learning/needs_review 节点时的卡片与来源提问按钮）——用执行 AI 测试账号（已有 1 个 learning 节点）截一张地图页即可。

---

## 1. 自动化测试

### 1.1 构建
```bash
cd frontend && npm run build   # 零 error（负责人已验证修复前通过，修复后须复跑）
```

### 1.2 后端
```bash
python -m pytest -q            # 全绿；其中 tests/test_section_page.py 7 用例已存在（命中/未命中/超时/缓存/401/400×2）
```

### 1.3 前端 E2E（Playwright，全 mock）

改造 `frontend/e2e/frontend-redesign.spec.ts` 的 `mockApp` 为**每用例独立初始化**，并按静态目录新链路提供完整夹具：

- `GET /map-catalog/manifest.json` 返回教材摘要和最小 `node_index`；按用例的 `mapByTextbook` 生成教材隔离数据。
- `GET /map-catalog/<textbook>.json` 返回按需加载的完整章节结构；不再 mock `/api/learning-map/chapters` 或 `/api/learning-map/nodes`。
- `GET /api/learning-progress` 返回稀疏节点状态、`catalog_version` 和 `revision`；可注入 503 验证静态地图降级。
- SSE `done` 可注入 `progress_delta`，验证问答后局部更新且不重拉进度。
- 所有地图用例监听旧 `/api/learning-map/*` 请求并断言请求数为 0。

- 签名：`mockApp(page, { initialHistory = [] } = {})`，history 闭包变量以 `initialHistory` 初始化。
- POST `/api/chat/history`：**追加**而非覆盖（生成新 id 存入数组并返回该 id）。
- PATCH `/api/chat/history/<id>`：**按 URL 中的 id 定向 merge**，只更新该条记录。
- 既有 CaptureBubble 三态用例用空 `initialHistory`（原断言不变）；E1/E2/E3 用预置双记录。

预置记录（字段需过 `normalizeChatHistoryRecord`，必备字段：`id, question, answer, page_number, marker_y_ratio, marker_type, textbook_id, thumbnail, crop_bbox, follow_ups, thinking, tool_activities, created_at`）：

```ts
const R1 = { id: 't1', question: '什么是秩？', answer: '秩是……', page_number: 1, marker_y_ratio: 30, marker_type: 'text', textbook_id: 'gaodai_shang', thumbnail: null, crop_bbox: null, follow_ups: [], thinking: null, tool_activities: [], created_at: '2026-08-18 09:00:00' };
const R2 = { id: 't2', question: '线性无关怎么判？', answer: '看组合……', page_number: 2, marker_y_ratio: 40, marker_type: 'text', textbook_id: 'gaodai_shang', thumbnail: null, crop_bbox: null, follow_ups: [], thinking: null, tool_activities: [], created_at: '2026-08-18 09:05:00' };
```

| # | 用例 | 步骤 | 断言 |
|---|------|------|------|
| E1 | 对话视图翻页不打断 + 跨页横幅跳回 | enterReader（第 1 页）→ 右栏点 R1 卡片「打开」→ 对话视图 → toolbar「下一页」→ 页码变 2 → 点横幅「来自第 1 页 · 跳回」 | 翻页后对话视图仍显示 R1 问答（**不**被替换为 R2 本页视图）；横幅可见；点横幅后页码回到 1 |
| E2 | 本页视图发送必建新线程；对话视图追问走 follow_up | 第 1 页打开 R1 →「← 返回本页」→ 输入框发「新问题」→ 再打开该新线程发「追问一句」 | 第一次发送拦截到 **POST** `/api/chat/history` 且 `body.page_number===1`；第二次拦截到 **PATCH** 且 body 含 `follow_ups` |
| E3 | 本页视图数据不错配 + 空页 D3 | 第 1 页 → 翻到第 3 页 → 翻到第 2 页 | 第 1 页显示 R1 卡片且**不显示** R2；第 3 页（空页）显示 starters「第 3 页还没有提问」与「0 条记录」；第 2 页显示「第 2 页 · 1 条记录」与 R2 卡片 |
| E4 | overlay 互斥（drawer vs 框选） | 打开「记录」drawer → 点 toolbar「框选提问」 | drawer dialog 隐藏、框选层出现；Esc 取消框选 |
| E5 | CaptureBubble 追问 + 在右栏展开 | 框选→发送→`data-state=complete`→输入框再发一轮追问→「在右栏展开」 | 追问后仍 complete；展开后右栏对话视图显示该线程（含截图消息） |
| E6 | 地图⇄阅读切换不丢对话 | 对话视图中 → header 点「地图」→ 再点「阅读」 | 对话消息仍在 |
| E7 | 章节卡落地（静态页码/缺页 fallback） | 地图模式点章节卡；静态 catalog 提供 page=26，再把 section-page fallback mock 为缺页重复 | 静态页码直接落到 26，且无 `section-page` 请求；缺页时仍进入 reader（「框选提问」可见），不白屏 |
| E8 | 移动端把手栏三档 + 入口 + pendingCount 徽标（390 视口，预置 R1/R2） | enterReader → 把手上滑→半屏→再滑→全屏→「收起」；点「AI 旁批」直达半屏；半屏中打开 R1 进对话视图 → 把手栏 ✂ → ImageCropper 点「确认截取」（默认中心裁剪，无需拖拽） | 半屏标题「本页旁批」；全屏标题「学习工具」；确认截取后 sheet 自动升半屏且「AI 旁批」按钮出现计数徽标 1（F5 修复后徽标在此按钮上）。**降级条款**：若 ImageCropper 在 mobile 项目不稳定，允许把徽标断言降级为人工核对并在报告中说明 |
| E9 | 暗色模式 | 地图页 + 阅读页各切一次暗色 | `documentElement` 有 `.dark`；截图无未适配硬编码色（人工看图） |
| E10 | 流式中翻页/切书/切地图禁用（F1+F9 回归） | mock SSE 延迟 2s；框选发送后 streaming 期间检查各入口 | streaming 中：toolbar「下一页」disabled 且**页码显示不回退**（仍为当前页/总页数）；header「地图」按钮与教材 select disabled；done 后全部恢复 |
| D1 | SSE 进度增量不重拉地图 | mock `done.progress_delta` revision=2；完成问答后返回地图并记录 `/api/learning-progress` 请求 | 受影响章节状态即时更新；进度接口只请求一次；无旧地图接口请求 |

已有 5 个用例（首访地图/再访恢复、drawer 开关、BottomSheet 手势三档、bubble 三态、四视口溢出）继续保留并须全绿。

### 1.4 视觉回归（截图归档，供负责人人工评审）

场景 × 视口 × 明暗，PNG 归档到 `artifacts/visual-YYYYMMDD/`，命名 `<scene>-<w>-<dark|light>.png`：

| 场景 | 1440×900 | 1280×800 | 768×900 | 390×844 | 812×375（横屏） |
|---|---|---|---|---|---|
| 地图模式 | 明+暗 | 明 | 明+暗 | 明+暗 | 明 |
| 阅读模式（含 drawer 打开） | 明+暗 | 明 | — | — | 明 |
| 阅读 + BottomSheet 半屏 | — | — | 明 | 明+暗 | 明 |
| CaptureBubble 完成态 | 明 | — | — | — | — |

812×375 用于 P1c-4 横屏验收（812<1024 走移动端分支）：除截图外须断言**无横向溢出**（`scrollWidth <= clientWidth`）且把手栏可见。

评审要点（负责人看图）：主色 indigo 是否整体偏蓝紫；有无亮蓝（blue-*）残留；状态色（amber/rose/emerald）是否正常；暗色对比度；圆角/阴影统一感。**不做 class 名机械扫描**。

### 1.5 section-page 真实精度抽测（人工比对）

起本地后端，对 4 本教材各抽 3 章（取该章第一个 section 的规范化前缀）调真实接口：

```bash
curl -H "Authorization: Bearer <token>" "http://localhost:8001/api/textbook/section-page?textbook_id=<id>&section=<N.N>"
```

记录表格：教材 | 章节 | section | 返回 page/confidence | PDF 目录标注起始页 | 误差 | 结论。**扫描成功时误差 ≤3 页判过**；`page:null` 只记录不判精度。

### 1.6 evidence 链路不回归（静态 + 单测）

- `python -m pytest tests/test_evidence_db.py tests/test_evidence_pipeline.py tests/test_evidence_reporting.py -q` 全绿。
- 静态确认：`useChat.ts` 的 streamQA 请求仍携带 `chat_id / marker_id / page_number / textbook_id / crop_bbox / screenshot_context_id`（负责人已确认，修复后 grep 复核即可）。

---

## 2. 验收对照（设计文档 §五 → 证据）

| 验收条 | 证据 |
|---|---|
| P1a-1 无常驻左栏、PDF 增宽 ≥200px | 视觉截图 1440/1280（旧布局 260px 侧栏 + 64px 页码轨均已移除） |
| P1a-2 drawer 开关/遮罩/Esc | 已有用例 + E4 |
| P1a-3 toolbar 收编控件 | E1/E7 用 toolbar 翻页；E10 缩放控件存在性随构建检查 |
| P1a-4/5 令牌与暗色 | 视觉评审 |
| P1a-6 构建 + 主链路 | §1.1 + E2/E5 |
| P1b-1 启动策略 | 已有用例（首访地图/再访恢复） |
| P1b-2 地图渲染 | 视觉截图 + 静态 manifest/index 与 progress mock 一致 |
| P1b-3 章节落地 | E7 + 静态 page 映射与 §1.5 fallback 精度表 |
| P1b-4 切换不丢状态 | E6 |
| P1b-5 移动端地图 | 390 截图 |
| P1c-1 AiBall 删除/把手栏 44px 不遮内容 | grep 无 AiBall + E8 + 截图 |
| P1c-2 三档手势 | 已有用例 + E8 |
| P1c-3 未读点/截图计数 | E8（人工核对：真实提问后红点出现——可 mock SSE 快速完成验证） |
| P1c-4 横屏不破坏 | 812×375 横屏截图 + 无横向溢出断言 |
| P2-1 翻页刷新契约 | E3（数据全量本地、翻页即重过滤，loading/错误/重试走 itemsLoading/itemsError 分支，可 mock 500 验证重试） |
| P2-6 静态目录与进度分离 | M1-M4、M7、D1（manifest/index、progress、revision、降级和增量） |
| P2-2 对话视图翻页保持 + 横幅 | E1 |
| P2-3 线程规则 | E2 |
| P2-4 evidence 不回归 | §1.6 |
| P2-5 跨教材跳转 | 人工核对（mock 双教材成本高，允许人工） |
| P3-1 浮层定位/翻转 | E5 + bubble 截图（选区贴右边缘触发翻转，人工看图） |
| P3-2 追问/右栏展开 | E5 |
| P3-3 关闭落徽标/旁批列表 | 已有 bubble 用例末条断言（「第 1 页 · 1 条记录」） |
| P3-4 移动端底部卡 | 390 视口跑 bubble 用例（mobile 分支） |
| P3-5 视觉收尾 | 视觉评审 |

## 3. 交付物（执行 AI 输出）

1. `../06-acceptance-records/FRONTEND_REDESIGN_TEST_REPORT.md`：F1–F9 修复确认（每条附 diff 摘要）、用例 pass/fail 表、§1.5 精度抽测表、未覆盖项与原因。
2. `artifacts/visual-YYYYMMDD/` 截图全套。
3. 构建与 pytest 完整输出（末尾摘要即可）。
