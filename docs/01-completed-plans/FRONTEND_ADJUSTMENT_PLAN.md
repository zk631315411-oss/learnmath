# LearnMath 前端调整计划

> 范围：`frontend/` 前端专项
> 日期：2026-08-15
> 输入：上一轮前端评估 + 用户决策（AiBall 接线，其余按评估思路调整）
> 约束：不动后端 API 契约（仅前端把已有的 `cropBBox` 参数接上）；不引入新依赖；KaTeX 走已有的 `katex` npm 依赖

## 完成记录（2026-08-16，lead 流程分批落地）

15 项全部完成，每批 coder 实现 + reviewer 审核，验收为 `npm run build` 零错误 + `npx playwright test` 全量绿（3 passed + 1 skipped）。

| 批次 | 任务 | 提交 |
|---|---|---|
| 并行者未提交改动 | P0-1 KaTeX 本地化、P0-3 页码键收敛 | 工作区内（未提交，未动用） |
| A | P0-4 日志清理、P2-11 工程化、frontend/README | 4cf775a |
| B | P1-5/6 AiBall 未读接线 + 移动端单入口 | c3b61c4（复核无问题） |
| C1 | P2-7 AuthControls、P2-8 storage 收敛 | a673ba1 |
| C2 | P2-9 SSE 改 options 对象 | cee2376 |
| C3 | P2-10 死代码/公式组件归位/lucide、e2e 目录 | refactor(frontend): 清理死代码… |
| e2e 修复 | 移动端用例改用 AiBall 入口 | 04c3102 |
| D1 | P3-12 提问记录侧栏（桌面左栏/移动抽屉） | feat(frontend): 新增按页提问记录侧栏 |
| D2 | P3-13 三处空态引导卡 | feat(frontend): 三处空态改为三步引导卡 |
| D3 | P3-14 多图连发（当前只发第一张） | feat(frontend): 截图待发区支持多图连发… |
| D4 | P3-15 选区拖移/八向缩放（含并行者 data-capture-ignore 修复一并提交） | feat(frontend): 截图选区支持确认前拖移与八向缩放 |

**已知限制（后续另立任务）**：① chat_history 无教材维度，提问记录侧栏会混排所有教材的提问，需后端加 textbook_id；② 多图连发待后端 `/solve-stream` 支持 `images[]` 后启用；③ useChat.ts 与 ScreenCapture.tsx 略超 300 行软限制（职责已尽量外抽，属可接受）。

**思路变动记录**：移动端聊天入口从"底部 FAB + MobileChatPanel"收敛为 AiBall 单入口（用户指定）；P0-1/P0-3 由并行收尾者完成（其改动仍在工作区未提交，本计划各批均回避了这两个文件）。

## 目标总览

1. 修掉 5 个已确认的正确性问题（含 2 个真 bug：离线 KaTeX 样式失效、截图 cropBBox 被丢弃）。
2. 把 AiBall 悬浮球的 `hasUnread` / `onRead` 从死值接线为真实状态。
3. 降重复：认证按钮三态合一、localStorage 收敛、API 事件回调改 options 对象。
4. 用后端已有的 `chat_history` 数据做「提问记录」侧栏，把错题本属性显性化。
5. 工程化：`tsbuildinfo` 移出 git、e2e 目录整理。

## 工作包分解

### P0 — 正确性修复（真 bug，先做）

| # | 任务 | 涉及文件 | 验收 |
|---|------|----------|------|
| 1 | **KaTeX CSS 本地化**：删除 `index.css` 顶部的 jsdelivr CDN `@import`，改为 `katex/dist/katex.min.css`（依赖已在 package.json），确认字体文件随 Vite 打包、离线可用 | `src/index.css` | 断网/容器环境下公式渲染样式正常；构建产物含 KaTeX 字体 |
| 2 | **截图 cropBBox 接线**：`App.tsx` 的 `handleCapture` 不再丢弃 `cropBBox`，透传给 `useChat.handleCapture`；`useChat` 发送截图提问时用真实 cropBBox 替换硬编码的"中间 80%"，并把 `marker_y_ratio` 从硬编码 50 改为选区中心 Y | `src/App.tsx`、`src/hooks/useChat.ts` | 框选页面边缘题目后，后端收到的 crop_bbox 与选区一致；徽标落点跟随选区 |
| 3 | **页码持久化合并为单键**：保留 PDFViewer 的 `pdf_viewer_page_v2`；删除 `useTextbookPreference` 的 `learnmath_pdf_page`、`saveCurrentPage`、`getActualPage`（App 未调用，属死代码）；页码恢复路径唯一 | `src/hooks/useTextbookPreference.ts`、`src/App.tsx` | 换教材/刷新后页码恢复行为不变；grep 全库只剩一个页码键 |
| 4 | **清除 PDFViewer 调试日志**：删除 3 处 `console.log` | `src/components/PDFViewer.tsx` | 生产 console 无输出 |

### P1 — AiBall 接线（用户指定）

| # | 任务 | 涉及文件 | 验收 |
|---|------|----------|------|
| 5 | **未读状态落地**：`useChat` 新增 `unreadCount` / `markRead()`。规则：AI 回复流结束（done/error）时，若聊天面板不可见则 +1；桌面端右栏常驻 → 恒 0；移动端由 App 依 `showMobileChat` / AiBall 展开态判定可见性。App 把死值 `hasUnread={false} onRead={()=>{}}` 替换为真实状态；AiBall 展开时 `onRead()` 清零 | `src/hooks/useChat.ts`、`src/App.tsx`、`src/components/AiBall.tsx` | 移动端 AI 回复到达且面板关闭 → 球上红点/角标出现；展开即清零；桌面端不出现角标 |
| 6 | **移动端双入口去重**：`showMobileChat` 与 AiBall 展开态二选一，避免两个聊天面板共存（推荐：保留 AiBall，删除底部固定入口按钮与 `MobileChatPanel`，AiBall 已自带展开面板；如保留 MobileChatPanel 则 AiBall 不重复挂载） | `src/App.tsx`、（可选删 `MobileChatPanel.tsx`） | 移动端任意时刻只有一个聊天入口/面板 |

### P2 — 可维护性重构（不改 UX）

| # | 任务 | 涉及文件 | 验收 |
|---|------|----------|------|
| 7 | **认证按钮三态合一**：新建 `AuthControls.tsx`，App Header 中游客/已登录/未登录三段 JSX 收拢为一个组件 | `src/App.tsx`、新建 `src/components/AuthControls.tsx` | 三种登录态渲染与跳转行为不变 |
| 8 | **localStorage 收敛**：新建 `src/utils/storage.ts`，统一 `loadJSON/saveJSON`（含 try/catch）；迁移 `useTextbookPreference`、`PDFViewer` 中散落的读写 | 新建 `src/utils/storage.ts` 及调用方 | 行为不变；原文件内不再有裸 try/catch JSON.parse |
| 9 | **SSE 调用改 options 对象**：`fetchWithStage` 的 12 个位置参数改为 `{ request, callbacks }` 结构；`useChat` 同步改造 | `src/services/api.ts`、`src/hooks/useChat.ts` | 流式问答、思考块、工具活动展示回归通过 |
| 10 | **死代码清理**：删除无引用的 `HeaderPreview.tsx`；手写内联 SVG 统一替换为 lucide-react 图标（不改视觉）；公式组件（Composer/History/Favorites/MathField/Preview/Common）收进 `components/formula/` 子目录 | 多处 | `tsc -b` 通过；无视觉回归 |
| 11 | **工程化**：`frontend/tsconfig.tsbuildinfo` 加入 `.gitignore` 并从 git 移除（`git rm --cached`）；`frontend/test-results/` 确认已在 ignore；e2e 规格文件若有则收进 `frontend/e2e/` | `.gitignore`、`frontend/` | git status 干净 |

### P3 — 产品增强（P0–P2 完成后做，一个包）

| # | 任务 | 涉及文件 | 验收 |
|---|------|----------|------|
| 12 | **提问记录侧栏**：教材内按页列出该生的历史提问（徽标），点击 → 跳转对应页 + 加载该串对话到聊天面板。数据源：现有 `useMarkers`/chat_history，桌面端放左栏、移动端做成抽屉 | `src/App.tsx`、`src/hooks/useMarkers.ts`、新建 `src/components/QuestionListPanel.tsx` 等 | 列表与页面徽标一致；点击后页码与对话正确恢复 |
| 13 | **首页空态引导卡**：未选教材/无消息时的空状态改为 3 步引导卡（选教材 → 框选提问 → 查看提问记录） | `src/App.tsx`、`src/components/ChatPanel.tsx` | 三处空态（PDF 区、聊天区、移动端）均更新 |
| 14 | **截图多图连发**：`pendingImage: string` 升级为 `pendingImages: PendingImage[]`（每张带自己的 `cropBBox`）；待发送区改缩略图列表（单张可删、可清空）；一次提问最多 N 张（建议 3，超量提示）。**需要后端配套**：当前 `/solve-stream` 只收单个 `image` 文件（[qa.py:104](../../app/routers/qa.py)），后端需加 `images[]` 多文件字段——前端先按多图数据结构设计，联调前保持只发第一张 | `src/hooks/useChat.ts`、`src/components/ChatPanel.tsx`、`src/App.tsx`、（后端 `app/routers/qa.py` 另立任务） | 可连截 2–3 张进入待发列表；发送、删除、清空交互正常；后端未支持前不丢第一张图 |
| 15 | **选区二次微调**：ScreenCapture 桌面框选确认后，选区支持拖拽移动 + 八向手柄缩放（react-image-crop 已在依赖中，可直接复用其交互或自绘手柄）；移动端 ImageCropper 路径已支持微调，保持不变 | `src/components/ScreenCapture.tsx` | 确认前可调整选区；✓ 后按调整后的选区截图且 cropBBox 正确 |

### 明确不做（Out of Scope）

- 教材书架/目录导航大改（当前 4 本书用 select 够用，等有真实教材扩展需求再说）。
- 回答末尾追问建议 chips（依赖后端 SSE 契约变化，需另立后端任务）。
- 后端 `/solve-stream` 的 `images[]` 多文件支持（任务 14 的配套项，另立后端任务；前端先把多图交互和数据结构做好）。
- 后端 Prompt、KG 工具任何改动。

## 依赖与顺序

```
P0(1–4) 全部独立，可并行
   │
   ├─► P1(5) AiBall 接线 依赖 P0-2 的 useChat 改动落点（避免冲突）
   ├─► P1(6) 双入口去重 依赖 P1-5 完成后再删冗余入口
   │
   ├─► P2(7–11) 依赖 P0/P1 落地后做（尤其 9 要在 2、5 之后，同一批文件）
   │
   └─► P3(12,13) 最后做，12 依赖 8 的 storage 工具和稳定的 useMarkers
        ├─► P3-14 多图连发 依赖 P0-2（cropBBox 通道先打通，多图才有意义）
        └─► P3-15 选区微调 与 14 同文件（ScreenCapture），一起改避免冲突
```

建议提交节奏：P0 一个 commit、P1 一个 commit、P2 拆 2–3 个 commit、P3 每任务一个 commit。

## 风险与回归点

| 风险 | 缓解 |
|------|------|
| cropBBox 真实化后，后端按新区域定位 KG 的行为变化 | 前端只透传参数、不改后端；提交流式问答全链路手工回归（文字/截图/追问三种） |
| 多图连发后端不支持时丢图 | 前端发送前检测：后端未加 `images[]` 前只发第一张 + UI 提示；后端配套另立任务 |
| 删 MobileChatPanel 影响移动端体验 | 先在真机/模拟器对比 AiBall 面板与 MobileChatPanel，确认 AiBall 面板高度、关闭手势可用再删 |
| storage 收敛引入 key 读写差异 | 保留原有 key 名不变，仅收敛读写函数 |
| options 对象改造破坏 SSE 回调时序 | 改造后跑一遍完整流式回归：思考块展开、工具活动状态流转、心跳不卡死 |

## 验证方式

1. `cd frontend && npm run build`（`tsc -b` 必须零错误）。
2. `start.bat` 起开发环境，手工回归：登录/游客、选教材、翻页恢复、框选提问（含页面边缘选区）、文字提问、追问、徽标点击回看、清除对话。
3. 移动端视口（<1024px）：AiBall 拖拽、展开/收起、未读角标、截图走 ImageCropper 路径。
4. 离线验证：DevTools Network 切 Offline 刷新，公式样式不塌（验证任务 1）。
