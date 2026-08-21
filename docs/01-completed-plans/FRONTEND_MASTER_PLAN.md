# LearnMath 前端改版总控计划

> 日期：2026-08-21
> 状态：A/B/C 三条工作线全部完成并通过验收
> 用途：把三条前端工作线收进一份计划，供执行者按优先级取用。各线详情以分文档为准。

## 三条工作线

| 线 | 内容 | 详档 | 状态 |
|---|---|---|---|
| A. 数据正确性与状态重构 | turn 身份、后台任务注册表、页码单源、领域拆分 | `FRONTEND_REVIEW_CONSOLIDATED.md`（Batch 1–5） | Batch 1–5 完成 |
| B. KG 章内梯子视图 | 竖向正弦梯子 + 五态节点 + 内联详情卡 | `LEARNING_MAP_LADDER_VIEW_PLAN.md` | M1–M5 完成 |
| C. 界面与交互改版 | 框选流程、本页概要、地图首页（D2 纵向路径） | 本文档第二节 | 完成 |

## 一、依赖与配合关系

1. **五态色是 B/C 的公共契约**：`slate-300 未探索 / amber-400 学习中 / emerald-300 基本掌握 / emerald-600 已掌握 / rose-400 需巩固`。章总览（C）与章内梯子（B）必须使用同一组色值。执行时先把五态变量加进 `frontend/src/index.css`，两边共用，不各写一份。
2. **导航方向一致**：章总览（C-D2）纵向选章，章内（B）纵向爬节，两层同向。
3. **A 线 Batch 2（后台任务注册表）与 C 线框选改版的重叠已处理**：CaptureBubble 保持删除；后台任务不再依赖展示面存活，流式期间可导航、跨教材并发、显式取消、身份切换与 evidence 幂等分别由 E10–E17 守护。
4. **执行顺序已完成**：A2 后台任务注册表 → C-D2 地图首页 → B 章内梯子 → A3 页码单源 → A4 领域拆分 → A5 P2 收尾 → 全量验收。

## 二、C 线：界面与交互改版

### 2.1 已落地（2026-08-20/21，build + e2e 29 绿验证）

| # | 事项 | 关键文件 |
|---|---|---|
| C1 | 框选流程改版适配：定稿名「框选」，新链路「框选 → 确认截图 → 预览弹层 → 提问 → 截图进聊天输入区」；e2e 6 条用例 + helper `captureToChatInput` 重写 | `e2e/frontend-redesign.spec.ts`、`App.tsx`（askCapturedQuestion） |
| C2 | 删除死组件 `CaptureBubble.tsx`；`CaptureDraft` 类型迁至 `CapturePreviewSheet.tsx` | `src/components/` |
| C3 | 修复真 bug：流式期间翻页，回答永久从消息流消失。根因 `isTaskVisible` 门控把翻页误判为不可见；现流式更新只查组件挂载态，切对话时天然落空 | `src/hooks/useChat.ts` |
| C4 | 修复：发送新提问后切地图再回来，面板应停在对话视图（`sendNewPageQuestion` 补 `threadRequestKey` 递增） | `src/App.tsx` |
| C5 | PageNotesPanel 改「本页概要」：提问黑体标题（2 行截断）+ 答案摘要灰字预览 + 状态徽标 + 整卡点击 | `src/components/PageNotesPanel.tsx`、`src/utils/answerDigest.ts`（新增） |
| C6 | MapHome 撤「需要巩固」独立区块与 hero「来源提问」入口（信号留在章级摘要） | `src/components/MapHome.tsx` |

e2e 锚点事实（执行 D2 前必读）：输入框是 TipTap contenteditable，用 `getByRole('textbox', { name: '输入问题…' })` 定位；流式中锚点用「停止生成」按钮（无 disabled 属性可断）；待发送图为 `alt="待发送截图"`。

### 2.2 已完成：MapHome 首屏 D2 纵向路径

设计定稿 demo：`design-demos/map-home/d2-route-vertical.html`（亮/暗/移动三态已截图验证：`d2-check.png` 等）。

**语言规则**

1. 章 = 站：左侧竖轨，站点圆用五态色（学习中 amber-400 实心 + 22% 晕环；未探索 slate-300 空心圈）。
2. 站间距 = 本章知识点体量（柔化：基础间距 + 体量加成封顶，不得裸比例）。
3. 「你在这里」位置卡在当前站**内联展开**（非浮层），只装：小节名、`n/N 已探索`、继续学习按钮；无候选时退化为「从第 1 章开始 + 打开教材」。
4. 章名宋体（`serif-zh`）一行放下；「第 N 章 · 状态」小字在章名上方，知识点数小字跟章名同行。
5. 顶部保留账本行（教材选择器 + `N 章 · M 个知识点 · K 个已探索` + 刷新按钮）与五态图例行。
6. 桌面 / 移动同一形态，无方向切换。

**落地改造要点**

- 重写 `MapHome.tsx` 首屏 return；`selectedChapter` 分支、教材选择器、刷新按钮原样保留。
- 撤掉 hero「来源提问」按钮；`onOpenQuestion` / `questionItems` prop 及 `App.tsx` 传参同步删除（章内 NodeDetailCard 与节点图标仍保留该入口）。
- 章级状态映射：`needs_review>0 → rose / learning>0 → amber / 全 mastered → emerald-600 / explored=0 → slate / 其余 → emerald-300`。
- e2e 同步：站点按钮断言由 `/第 1 章.*查看地图/` 改为按章名定位；「学习地图」「选择教材」「刷新学习地图」「1 个学习中」「全部掌握」等锚点全部保留不变。
- 验收：`tsc --noEmit` 干净、`npm run build` 通过、`e2e/frontend-redesign.spec.ts` 全绿。

## 三、B 线：KG 章内梯子视图（已完成）

详档 `LEARNING_MAP_LADDER_VIEW_PLAN.md`。已完成：章总览、节内竖向正弦梯子、节点类型图形与五态角标、题型侧枝、聚焦子图、内联详情卡、跨章关系 chip、岛屿总览，以及移动端列表兜底。旧的 NodeEgoPanel 浮层方案已由内联详情卡替代。

## 四、A 线：正确性重构（摘要）

详档 `FRONTEND_REVIEW_CONSOLIDATED.md`。Batch 1–5 已全部完成：turn 身份与持久化状态、后台任务注册表、页码单一数据源、领域拆分及 P2 工程收尾均已落地。

## 五、本轮验收结果

- 前端单元测试：21 passed（5 files）。
- 前端构建：`npm run build` 通过。
- 后端全量：155 passed、3 skipped、32 subtests passed（`PYTHONPATH=D:\LearnMath python -m pytest -q`）。
- Playwright `frontend-redesign.spec.ts`：45 passed、47 条按项目条件跳过、0 failed；`review-shots.spec.ts`：2 passed、2 条按项目条件跳过。视觉截图位于 `artifacts/visual-review-0821/`。
- 依赖审计：仍有 6 条告警。Vite/Vitest 告警属于本地开发/测试服务；`mathlive <=0.109.2` 存在 XSS 公告，需单独评估升级到 0.110.x，不能用 `npm audit fix --force` 混入本轮。

## 六、A3–A5 完成记录

1. **A3 页码单源**：`usePdfPosition` 按教材持有页码，`PDFViewer` 改为 `page + onPageRequest` 受控契约；刷新、切书、地图落页与记录跳页统一走同一提交入口。
2. **A4 领域拆分**：提取 `useCaptureFlow` 与 `useWorkspaceNav`；`PageNotesPanel` props 按 page/conversation/composer 聚合。App 不再直接管理 SSE、页码持久化或截图识别生命周期。
3. **A5 P2 收尾**：URL 恢复 `view/chapter/textbook/page/thread`，补键盘翻页与编辑器避让；删除不可达页图分支和类型洞；集中 storage key 并增加 schema 版本；补语义 token。
4. **性能实测**：50 条含公式消息 + 60 个 SSE chunk 的最大帧间隔优化前约 383 ms；`MarkdownRenderer` memo 后通过 `<350 ms` 回归门槛。

## 附录：2026-08-21 v3 验收摘要

审查方式：`frontend/e2e/review-shots.spec.ts`（富 mock 截图脚本），截图存
`artifacts/visual-review-0821/`。v3 已用真实规模目录和 mock 场景检查章总览、竖向正弦梯子、内联详情卡、岛屿总览和移动端列表兜底。

| 检查 | 结果 |
|---|---|
| 前端单元测试 | 5 个测试文件、21 项通过 |
| 生产构建 | `npm run build` 通过；仅有既有 bundle 大小提示 |
| 前端重构 E2E | 45 passed、47 skipped、0 failed |
| 视觉审查截图 | 2 passed、2 skipped、0 failed |

旧 v2 的横向蛇形、胶囊节点和 `NodeEgoPanel` 浮层方案已在
`LEARNING_MAP_LADDER_VIEW_PLAN.md` 中标记为废弃；当前实现以 v3 的小图形、角标和内联详情卡为准。
