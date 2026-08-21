# LearnMath 前端审查合并报告与实施计划

> 总控计划：`FRONTEND_MASTER_PLAN.md`（三条工作线的汇总与依赖关系）。

日期：2026-08-20
来源：两轮独立 AI 静态代码审查的合并版。第一轮提出 14 项缺陷；第二轮逐条回代码核对，
确认 7 项完全成立、6 项修正措辞后成立、1 项严重度视产品决策而定。本文档采纳修正后的
表述与优先级，逐项附证据（文件:行号）与验收标准。

> 实施状态（2026-08-21）：Batch 1–5 已全部完成并通过全量验收。

**审查边界**：初始结论来自静态代码核查；实施阶段已补运行时 profiling、单元测试、
Playwright 全量回归和多视口视觉归档。下文“现状”保留为修复前问题记录。

**已定方案**：SSE 采用完整的后台任务隔离方案。翻页、切书、切地图和关闭气泡都不取消
正在生成的回答；每个请求固定绑定发起时的用户、教材、页码、线程和 turn，完成后只回写
自己的线程。当前界面是否展示该请求，由可见上下文派生，不能反向改变请求归属。

**实施原则**：先修数据契约与行为，再收敛状态所有权，最后做结构重构和体验增强。各阶段
独立构建、测试和提交，禁止把 App 拆分与流式行为变更混在同一提交中。

---

## 一、优先级总览

| # | 问题 | 优先级 | 两版审查一致性 | 主要证据 |
|---|------|--------|----------------|----------|
| 1 | 失败回答以 `[错误]` 文案落库，且没有持久化生成状态 | **P0** | 一致 | `frontend/src/hooks/useChat.ts:336-339`、`app/db/connection.py:34-49` |
| 2 | 追问消息缺少稳定 turn id，用问题前 8 字符做 React key | **P1** | 一致 | `frontend/src/hooks/useChat.ts:113-118` |
| 3 | SSE 无后台任务隔离；气泡流式期间只能靠全局锁规避串线 | **P1** | 一致（范围已修正，方案已定） | `frontend/src/App.tsx:84`、`frontend/src/services/api.ts:194` |
| 4 | 页码双数据源（App 与 PDFViewer 各一份） | **P1** | 一致 | `frontend/src/App.tsx:69`、`frontend/src/components/PDFViewer.tsx:96,259-262` |
| 5 | App.tsx 职责过度集中（551 行、17 个 useState、纯 prop drilling） | **P1** | 一致（计数已修正） | `frontend/src/App.tsx:49-551` |
| 6 | PDF 无文本层/搜索/大纲/键盘翻页 | P2 | 一致（**已验证：教材为扫描版**） | `frontend/src/components/PDFViewer.tsx:422-423` |
| 7 | 手写路由只恢复 view/chapter，其余导航状态不可回退 | P2 | 事实一致，严重度属产品决策 | `frontend/src/App.tsx:86-110` |
| 8 | 多图队列：可囤 3 张、每轮只发第 1 张 | P2 | 一致（定性已修正：有提示的队列，非静默丢图） | `frontend/src/hooks/useChat.ts:18,142-145`、`frontend/src/components/ChatPanel.tsx:216-218` |
| 9 | 流式期间消息列表全量重渲染，MarkdownRenderer 未 memo | P2 | 机制一致（**待验证**：掉帧程度需 profiling） | `frontend/src/hooks/useChat.ts:246-254`、`frontend/src/components/MarkdownRenderer.tsx:19` |
| 10 | `PAGE_IMAGE_CONFIGS` 空对象无人写入，webP 页图分支不可达 | P2 | 一致 | `frontend/src/components/PDFViewer.tsx:59` |
| 11 | 类型安全缺口（`Promise<any[]>`、`sources: any[]`、ref 强转） | P2 | 一致 | `frontend/src/services/api.ts:35,44,199`、`frontend/src/components/PDFViewer.tsx:204-206` |
| 12 | 样式语义 token 覆盖不完整（CSS 变量 / Tailwind 色值 / dark: 并存） | P2 | 一致（定性已修正：非"三套系统冲突"，是覆盖不完整） | 重构文档自述 + 各组件 |
| 13 | localStorage key 分散、写入顺序敏感、无统一版本管理 | P2 | 一致（定性已修正：已有 `utils/storage.ts` 集中读写） | `frontend/src/utils/storage.ts`、`pagePosition.ts`、`workspace.ts` |

---

## 二、P0/P1：数据正确性与渲染身份

### 1. 失败回答落库污染历史

**现状**
`useChat.ts` catch 分支执行两步破坏：
1. `patchChatHistory(chatId, { answer: '[错误] ${msg}' })` —— 错误文案作为**正式 answer** 落库，
   之后从提问记录重开该线程时，"[错误] ..." 会以回答形态展示；
2. `setMessages(...)` 用「抱歉，回答时出现了问题：...」**整段覆盖** assistant 消息——
   流中途断开时已流出的部分回答被丢弃。

**数据契约（定案）**
- 保持现有 `answer TEXT NOT NULL`，没有内容时写空字符串，不做 nullable 迁移；
- `chat_history` 新增：
  - `generation_status TEXT NOT NULL DEFAULT 'completed'`，取值为
    `pending | completed | interrupted | cancelled`；
  - `generation_error TEXT`；
  - `generation_updated_at TIMESTAMP`；
  - `client_turn_id TEXT`，标识根问题的稳定逻辑 turn；
- 历史记录迁移为 `completed`。新根问题 POST 时为 `pending`，成功收尾 PATCH 为
  `completed`，异常为 `interrupted`，用户明确取消为 `cancelled`；
- follow-up JSON 每项增加 `turn_id`、`qa_turn_id`、`status`、`error_message`。追问发送时先把
  `pending` 项落库，收尾时按 `turn_id` 更新，不能等成功后才追加；
- `UpdateChatRequest`、数据库更新函数和前端归一化类型同步支持上述字段。更新接口必须能
  明确清空旧错误，不能用「`None` 等于未传」的旧语义含混处理；
- 追问不得继续依赖“前端读出整个 `follow_ups` → 拼接 → 覆盖写回”的非原子流程；新增按
  `chat_id + turn_id` 的服务端追加/更新接口，或在数据库事务内校验版本后写回，避免后台任务、
  重试和多标签页互相覆盖；
- 页面异常关闭后遗留的 `pending` 记录不伪装成“仍在生成”。读取历史时，超过恢复窗口且
  不在本页任务注册表中的 pending 显示为“生成中断，可重试”。

**UI 行为**
- answer 永远只保存模型正文；
- 流中途失败时，保留并落库已收到的部分正文，正文下显示错误横幅与「重试」；
- 没有正文时显示“回答中断”，不把错误描述渲染成 assistant 正文；
- 重试复用同一个 `client_turn_id/turn_id` 和聊天位置，不重复插入用户消息。

**验收**
- 断网 / 手动断流后，重开该线程看不到 `[错误]` 前缀文本；
- 已流出的部分内容在历史中完整保留；
- 根问题与追问的 pending/completed/interrupted/cancelled 均可 API round-trip；
- 老库迁移后记录仍可读取，状态为 completed；
- 同一 `client_turn_id` 重试时 evidence/进度副作用幂等，不重复累计。

### 2. 追问消息 key 碰撞

**现状**
`useChat.ts:113-118` 重建消息列表时，id 为 `` `${activeMarker.id}-fuq-${fu.question.slice(0, 8)}` ``；
答案侧用 `fu.answer.slice(0, 8)`。两句开头相同的追问（如连续两句"为什么…"）key 直接冲突，
React 复用错误节点。

**修复方向（定案）**
- 用户每次发送时由前端生成稳定 `turn_id`，创建 pending 记录时立即持久化；
- 后端本轮实际执行 ID 作为 `qa_turn_id` 从 SSE done 返回，`fetchWithStage` 必须解析并返回；
  前端的 `client_turn_id` 作为稳定逻辑 ID 贯穿 pending、重试和 UI key；
- 消息 key 使用 `` `${chatId}-${turnId}-question` `` 与 `` `${chatId}-${turnId}-answer` ``；
- 老 follow-up 没有 `turn_id` 时，归一化层用 ``legacy-${index}`` 兼容，读取时不回写旧数据；
- 不使用问题文本、答案文本或数组 index 作为新数据的身份。

**验收**
- 同一线程连续提交两句前 8 字相同的追问，渲染与滚动行为正常，无 key 重复告警。
- 刷新、失败重试和后台完成后，消息 ID 保持不变。

---

## 三、P1：交互与状态模型

### 3. SSE 后台任务隔离 + 移除气泡流式 UI 锁

**现状（范围已按第二轮审查修正）**
- `interactionLocked = bubbleStreaming || formulaRecognition.status === 'recognizing'`
  （`App.tsx:84`）：**仅**气泡框选提问的流式与公式识别期间，锁定翻页、截图、切书、
  切地图、开抽屉；普通右栏文字问答不锁。
- `fetchWithStage`（`api.ts:194`）与 `streamQA` 均无 AbortSignal 入参，SSE 一旦发起不可取消；
  现有锁是为规避「气泡锚定页 vs 翻页」冲突（`App.tsx:341` 气泡按 `captureDraft.page === currentPage`
  才渲染）而选择的兜底方案。

**为何仍是 P1**：被锁的恰好是产品旗舰路径（框选提问），LLM 流式常达 30 秒以上，
期间学生无法翻页对照教材，与"边学边问"定位冲突。

**完整方案（定案）**

1. **请求身份贯穿前后端**
   - 每次发送先生成 `client_turn_id`（UUID），根问题先创建 chat history，追问先追加 pending turn，
     然后再发起 SSE；
   - `QARequest` / `QATurnInput` 增加 `client_turn_id`。服务端验证格式后将它作为本轮幂等键；
     SSE `done` 继续返回服务端执行 ID `qa_turn_id`，前端同时保留两者，不能把两个 ID 混为一谈；
   - `evidence_turns` 增加 `client_turn_id` 列和 `(user_id, client_turn_id, node_id)` 唯一约束；
     `qa_turn_id` 仍用于追踪某次服务端执行；同一 client turn 重试即使产生新的 qa_turn_id，也
     不能重复写同一节点证据；只有真正新增 evidence 时才递增学习进度 revision；
   - `fetchWithStage` 解析并返回 `qa_turn_id`，聊天记录同时按 `client_turn_id` 和本次执行结果
     完成状态回写。后端可在幂等重试时返回既有完成结果，或执行后以唯一约束抑制重复副作用，
     但两种路径都必须保持同一 API 语义。

2. **独立后台任务注册表**
   - 从 `useChat` 拆出 `useAnswerTasks`（或等价的外部 store + hook），由 workspace 顶层持有，
     不随 PDF、气泡、右栏、地图和教材视图卸载；
   - 任务以 `client_turn_id` 为 key，创建后保存不可变归属快照：

     ```ts
     type AnswerTask = {
       clientTurnId: string;
       qaTurnId?: string;
       userId: string;
       chatId: string;
       turnKind: 'root' | 'follow_up';
       textbookId: string;
       pageNumber: number;
       markerType: 'text' | 'screenshot';
       request: Readonly<FetchWithStageRequest>;
       status: 'pending' | 'streaming' | 'completed' | 'interrupted' | 'cancelled';
       answer: string;
       thinking: string;
       toolActivities: ToolActivity[];
       errorMessage?: string;
       startedAt: number;
       controller: AbortController;
     };
     ```

   - SSE 回调只能按 `client_turn_id` 更新自己的 task，禁止从闭包读取变化后的
     `currentPage/textbookId/activeThreadId/activeMarker`；
   - 单线程串行：同一 `(userId, chatId)` 同时最多一个运行任务，避免 follow_ups 整体 JSON
     并发覆盖；不同线程、不同教材允许并发；
   - `isLoading` 改为任务派生状态，不再是全局布尔值。发送按钮只在当前线程已有运行任务时
     禁用，不能因教材 A 的后台任务阻止教材 B 提问。

3. **持久层和当前视图解耦**
   - 任务的唯一权威归属是创建时的快照。完成/失败时按快照中的 chatId 和 turnId 更新数据库；
   - `useThreadView`（由现有 `useChat` 拆出）只负责把已加载历史与该线程运行中的 task 投影为
     `Message[]`。切书/切页仅更换订阅，不清除或改写后台 task；
   - 任务结束后失效对应 `(userId, textbookId, pageNumber)` 的提问缓存，以及对应教材的地图
     进度缓存。只有可见线程与 task 归属相同时才即时合并消息，否则只增加该教材/线程的未读；
   - `progress_delta` 必须按 task 的 captured textbookId 应用，不能使用完成瞬间界面的教材；
   - 用户退出登录或身份切换时取消该用户全部任务并按 cancelled 收尾，防止跨身份回写。

4. **导航与取消语义**
   - 翻页、切书、切地图、开抽屉、关闭气泡、展开到右栏均不 abort；气泡离开原页后卸载，
     任务在后台继续，原页 marker/提问记录显示生成状态；
   - 提供显式“停止生成”，仅该操作调用 `AbortController.abort()`，保留部分正文并写 cancelled；
   - `streamQA` / `fetchWithStage` 接受 `AbortSignal`。请求层已有 signal 透传能力，需确保 reader
     取消、AbortError 分类和 finally 收尾都可预测；
   - 删除由 `bubbleStreaming` 引起的全局锁及 PDFToolbar/BottomSheet/header 对应 disabled 守卫；
     公式识别仍保留自己的局部锁和取消按钮，不与 SSE 任务状态混用。

5. **刷新与异常关闭**
   - 第一阶段不承诺浏览器关闭后继续生成；完整方案中的“后台”指 SPA 存活期间跨视图继续；
   - 刷新后由 chat history 的 generation_status 恢复显示。遗留 pending 没有活跃 task 时按
     interrupted 展示并允许重试；不得尝试盲连已经消失的 SSE；
   - 后续若要求跨刷新继续，需另立后端 job + 查询/重连协议，不纳入本轮前端重构。

**验收**
- 气泡流式中可翻页、可切书；回答完成后从提问记录打开线程，内容完整；
- 教材 A 回答流式中切到教材 B 并发起新问题：A/B 分别落入自己的线程，消息、页码、marker、
  未读和地图进度均不串线；
- 同一线程运行中禁止第二次发送，不同线程可同时生成；
- 关闭气泡与打开右栏不重复请求，已有 task 只更换展示面；
- 显式停止后部分正文保留，状态为 cancelled；网络失败状态为 interrupted；
- 退出登录时旧用户任务停止，登录新用户后不可见且不能回写新用户状态；
- 锁相关守卫（PDFToolbar `navigationDisabled`、BottomSheet `interactionLocked` 等）同步清理；
- 更新 E10：从“全部禁用”改为“可导航 + 后台完成”；新增跨教材并发、失败恢复、显式取消、
  身份切换和 evidence 幂等用例。

### 4. 页码双数据源

**现状**
App 持 `currentPage`（`App.tsx:69`），PDFViewer 内部另持一份（`PDFViewer.tsx:96`），
靠 `viewerPage` prop（`PDFViewer.tsx:259-262`）与 `onPageChange` 回调双向同步。
现有多处竞态注释（切书恢复被 StrictMode 双调用跳过、跨教材点线程被 clearMessages 打断、
"先写页码再切书"的顺序约束）半数源于此。

**修复方向（定案）**
- 页码唯一持有者为 `usePdfPosition`，App 只消费其状态；PDFViewer 完全受控，只接收 `page`
  并发出 `onPageRequest(page)`；
- localStorage 页码恢复逻辑从 PDFViewer 迁出，与 workspace 恢复合并到同一处，
  删除 `prevTextbookId` 一类幂等守卫。

**验收**
- 刷新恢复、切书、提问记录跳页、地图落页四条路径无跳页闪烁；
- PDFViewer 内不存在 `currentPage` state，不读取或写入页码 localStorage；
- 页码改变只有 `usePdfPosition` 一个提交入口，后台回答结束不会改变当前页。

### 5. App.tsx 职责过度集中

**现状（计数已按第二轮修正）**
551 行、**17 个** `useState`（非初版所说的 20+），横跨认证、主题、教材、截图、
公式识别、覆盖层、导航、聊天接线；`pageNotesPanel` 单 JSX 变量传约 25 个 props。
无 Context/状态库本身不是缺陷，问题是编排逻辑全部集中在一个组件。

**修复方向**（行为稳定后实施，按领域拆而不是塞进一个大 reducer）
- 拆分 `useAnswerTasks`（后台请求注册表）、`useThreadView`（当前线程投影）、
  `useCaptureFlow`（截图 + 公式识别 + 气泡）、`useWorkspaceNav`（view/chapter/history 同步）、
  `usePdfPosition`（承接第 4 条）；认证与主题维持现状（已独立）；
- 面板 props 过多的，以领域对象聚合传递。

**验收**
- App 只做领域组合和布局，不直接处理 SSE chunk、页码持久化或公式识别请求生命周期；
- 各领域有明确状态所有者和独立单测，不再用跨领域 effect 镜像同一份状态；
- App 行数只作为观察指标，不设“≤250 行”硬门槛，避免以搬代码代替建模。

---

## 四、P2：体验与代码健康

### 6. PDF 阅读能力（教材形态已验证）
`PDFViewer.tsx:422-423` 关闭文本层与注释层：不可选中/复制/搜索，无大纲导航、无键盘翻页。

2026-08-20 使用 PDF 文本提取抽查四本教材的前 8 页及第 21 页、1/4、1/2、倒数第 20 页，
所有样本页提取字符数均为 0，确认当前四本教材是扫描版。

**本轮定案**：保持 `renderTextLayer={false}`，补左右方向键 / PageUp / PageDown 翻页（输入框、
编辑器聚焦时不拦截）；不实现伪搜索。全文搜索、复制和大纲若要支持，单列“OCR 索引 +
目录数据”项目，不与本轮状态重构混做。

### 7. 路由状态不完整
history 仅序列化 `view`/`chapter`（`App.tsx:86-110`）。抽屉、BottomSheet 档位、
激活线程目前刷新和后退均会丢失。

**本轮定案**：URL 只承载可恢复的工作区导航：`view`、`chapter`、`textbook`、`page`、`thread`；
抽屉开关、BottomSheet 档位、截图气泡、输入草稿属于瞬时 UI，不进入 history。恢复 thread 时仍
按当前登录用户校验归属；无权或不存在则移除参数并回到本页视图。

### 8. 多图队列契约
UI 允许囤 3 张、每轮只消费第 1 张，已有黄字提示（非静默丢图）。

**本轮定案**：保留“截图待发队列”，每次发送顺序消费一张；全项目删除“多图连发”措辞，
明确每张截图是一轮独立问题。不扩展 `/solve-stream` 为 `images[]`，避免多图语义、截图坐标和
教材页码映射不明确。未来若需要同题多图，另立后端契约。

### 9. 流式渲染性能（已完成）
用 50 条含公式消息 + 60 个 SSE chunk 做浏览器 profiling，优化前最大帧间隔约 383 ms，
超过 350 ms 回归门槛。`MarkdownRenderer` 增加 `React.memo` 后同一场景通过 `<350 ms`
门槛；Playwright `P1 long formula thread remains responsive while streaming` 固化该回归。

### 10. 死代码：webP 页图分支
`PAGE_IMAGE_CONFIGS`（`PDFViewer.tsx:59`）是模块级空对象，全项目无写入路径，
`pageImageConfig` 恒为 undefined，约 60 行渲染分支不可达。**本轮删除该分支**；如果未来采用
预渲染页图，应以有配置契约、有构建产物和有测试的新功能重新引入。

### 11. 类型安全缺口
`getChatHistoryByUser`/`getAllChatHistory` 返回 `Promise<any[]>`（`api.ts:35,44`）、
`sources: any[]`（`api.ts:199`）、`(pdfContainerRef as any).current` 强转
（`PDFViewer.tsx:204-206`）。补 `ChatHistoryRecord` 等具体类型；ref 合并改用
标准 callback ref 写法。

### 12. 样式 token 覆盖不完整
`--lm-*` CSS 变量、Tailwind 硬编码色值（indigo/rose/slate）、`dark:` 变体并存。
定性为**语义 token 未收敛完成**（重构文档自述"视觉无锚点"只治了一半）。
方向：先定义 surface/text/border/accent/danger/success 六类语义 token 和 3 档圆角/阴影，
新改组件必须使用 token；存量组件按触达范围迁移，不做一次性全项目颜色替换。

### 13. localStorage 治理
已有 `utils/storage.ts` 集中读写，但 key 散落在 App/PDFViewer/pagePosition/workspace/
useLearningProgress 多处，仅 `pdf_view_preferences_v1` 带版本号；多处写入存在顺序
敏感（"先写目标页码再切书"即此类）。方向：key 集中到单一常量模块 + 统一版本字段；
配合第 4 条消除顺序敏感写入。

---

## 五、实施批次

### Batch 0：基线与保护
- 保存当前工作树状态，不覆盖既有未提交改动；
- 记录 `npm run build`、后端全量 pytest、现有 Playwright E2E 结果；
- 把现有 E10 保留为旧行为证据，后续与新 E10 对照更新。

### Batch 1：turn 身份与持久化状态（P0，已完成）
- 数据库列迁移、chat API 契约、`client_turn_id`、follow-up turn 元数据；
- QA 接口传播 turn identity，evidence 唯一约束与幂等 revision；
- 前端 DTO/归一化类型、失败展示、稳定消息 key；
- 完成后独立跑数据库、chat API、evidence 与前端历史恢复测试。

### Batch 2：后台任务注册表（P1 核心，已完成）
- 实现 `useAnswerTasks` 与 `useThreadView`，迁移 SSE 生命周期；
- 实现任务级取消、每线程串行、跨线程并发、上下文缓存失效和未读；
- 移除气泡流式全局锁，更新 E10 并补跨教材竞态用例；
- 本批不重构 PDF 页码和 App 其余领域，控制行为变更边界。

### Batch 3：页码单一数据源（已完成）
- 引入 `usePdfPosition`，PDFViewer 完全受控；
- 合并 workspace/page 恢复，补刷新、切书、地图落页和记录跳页测试。

### Batch 4：领域拆分（已完成）
- 提取 `useCaptureFlow`、`useWorkspaceNav`，整理 App 编排与面板 props；
- 只做等价搬迁与接口收敛，不在此批改变交互规则。

### Batch 5：P2 收尾（已完成）
- 键盘翻页、URL 可恢复状态、截图队列命名、死代码、具体类型、storage key 与触达组件 token；
- 长对话 profiling 独立执行；只有数据确认掉帧时才加入消息项 memo/节流优化。

各 Batch 按顺序实施并在进入下一批前完成针对性验证。工作区原有多条在制改动交叠，本文只记录
功能与测试边界，不以混合工作树中的提交边界作为完成证据。

**Batch 1–5 验收记录（2026-08-21）**：前端单元测试 12 passed（5 files）；前端构建通过；
后端全量 155 passed、3 skipped、32 subtests passed；Playwright 全量 65 passed、55 条按项目条件
跳过、0 failed。E10–E17 覆盖可导航后台生成、跨教材并发、同线程串行、展示面切换、中断、取消、
身份切换与 evidence 幂等；E18 守护页码恢复和教材隔离；E19/E20 守护 URL/history 与键盘翻页；
P1 性能用例守护长公式对话流式响应性。视觉归档 2 passed。

---

## 六、测试与验收矩阵

### 后端自动化
- 老 chat_history 数据库迁移后可读，新增状态字段默认正确；
- 根问题与 follow-up 的 pending → completed/interrupted/cancelled round-trip；
- `client_turn_id` 格式、用户归属与 SSE done 回传；
- 同一 turn 重试不重复写 evidence，学习进度 revision 只增加一次；
- 不同 turn 即使 question 相同仍分别落库。

### 前端单元/组件测试
- task reducer/store：合法状态转换、乱序 chunk、重复 done、取消后迟到 chunk 均不破坏终态；
- thread projection：只合并同一 chatId 的 task，稳定消息 ID，老 follow-up 兼容；
- captured context：任务完成时仍使用发起时 textbook/page/chat，而非当前界面状态；
- PDF position：恢复、切书和主动跳页只有单一状态提交路径。

若现有前端测试栈不含组件/Hook runner，Batch 2 引入最小 Vitest 配置，只测试纯 task store 和
投影函数；不为了测试再引入全局状态管理库。

### Playwright E2E
- **E10 新版**：气泡 streaming 中翻页、切地图、切书均可用；原回答后台完成并可从记录打开；
- **E11 跨教材并发**：A 延迟回答 → 切 B 发问 → B 先完成、A 后完成，两边内容、marker、未读、
  页码和 progress 均归属正确；
- **E12 同线程串行**：当前线程生成中不可再次发送，切到另一线程可发起；
- **E13 展示面切换**：关闭气泡、打开右栏、再切回记录，全程只有一个 solve-stream 请求；
- **E14 中断恢复**：收到部分 chunk 后断流，部分正文保留；刷新历史显示 interrupted 和重试；
- **E15 显式取消**：停止生成后状态 cancelled，迟到 chunk 不覆盖终态；
- **E16 身份切换**：旧用户生成中退出，任务取消，新用户看不到旧任务或未读；
- **E17 evidence 幂等**：同一 turn 重试后地图证据计数只增加一次；
- **E18 页码单源**：刷新恢复、切书、地图落页、提问记录跳页均无闪烁或回跳。
- **E19 URL/history**：深链恢复教材、页码和线程；后退恢复工作区；非法 thread 被清理。
- **E20 键盘翻页**：方向键与 PageUp/PageDown 翻页，输入框/contenteditable 聚焦时不拦截。
- **P1 流式性能**：50 条含公式消息与 60 个 chunk 场景最大帧间隔小于 350 ms。

SSE 测试继续使用 route mock，不消耗真实 LLM；全部自动化通过后再做一次真实模型烟测，验证
气泡提问 → 切页/切书 → 后台完成 → 返回原线程 → evidence/地图更新的完整链路。

---

## 七、两版审查分歧修正记录（备查）

| 初版表述 | 修正后表述 |
|---|---|
| App.tsx 有 20+ 个 useState | 实际 17 个（第二版"约 16"亦略低）；计数不影响"职责集中"结论 |
| 流式回答期间禁止翻页/切书 | 仅气泡框选流式 + 公式识别期间锁；普通右栏问答不锁 |
| 多图连发名不副实 | 是有明确提示的多图队列，非静默丢图 |
| 三套样式系统并存冲突 | 语义 token 覆盖不完整（迁移半途） |
| localStorage 当数据库用 | 已有集中读写工具，问题是 key 分散 + 无版本管理 |
| 长对话必然掉帧 | 已实测并用 `MarkdownRenderer` memo 修复，现有回归门槛为最大帧间隔 <350 ms |

已解决：四本教材均为扫描版，本轮不启用文本层；流式性能已完成实测、优化并纳入回归。
