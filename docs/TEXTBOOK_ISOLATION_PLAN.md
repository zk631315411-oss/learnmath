# 提问记录按教材隔离方案

> 日期：2026-08-16
> 起因：前端审核发现 `chat_history` 无 `textbook_id`，提问记录侧栏与页面徽标跨教材混串（高代的提问点击后跳到高数同页码）
> 范围：后端 schema/API + 前端落库/消费，全链路
> 约束：不改 SSE 问答契约；老数据不回填、不丢失

## 1. 问题复述

提问记录只存「第几页」不存「哪本书」：

- 落库：`POST /api/chat/history` 的 [SaveChatRequest](../../app/routers/chat.py#L18) 无 `textbook_id` 字段（尽管 `/solve-stream` 问答时前端传了它用于 KG 圈定）；
- 读取：[useMarkers.ts:31](../../frontend/src/hooks/useMarkers.ts#L31) 按 `user_id + page_number` 过滤、[useQuestionList.ts](../../frontend/src/hooks/useQuestionList.ts) 拉全量，都没有教材维度；
- 跳转：[App.tsx](../../frontend/src/App.tsx) `handleQuestionSelect` 直接 `setCurrentPage(page_number)`，页码落在**当前打开的书**上。

## 2. 方案总览

给 `chat_history` 加 `textbook_id` 列，全链路贯通：落库时写入 → 查询时按当前教材过滤 → 点击其他教材的记录时先切书再跳页。老数据（`textbook_id IS NULL`）保持现状行为（所有教材可见），不回填。

## 3. 后端改动（3 处，均在现有模式内）

### 3.1 schema 迁移 — `app/db/connection.py`

- 新库：`CREATE TABLE IF NOT EXISTS chat_history` 语句中加 `textbook_id TEXT` 列；
- 老库：在 [connection.py:52](../../app/db/connection.py#L52) 的幂等迁移列表中追加 `("textbook_id", "TEXT")`（沿用 Phase 2 迁移同款 try/ALTER/except 模式，启动时自动补列）；
- 不建复合索引：单用户记录量小（百级），现有 `idx_chat_history_user_id` 足够。

### 3.2 DB 层 — `app/db/chat_history_db.py`

- `save_chat_history(...)` 加可选参数 `textbook_id: Optional[str] = None`，INSERT 列清单同步加一列；
- `get_chat_history(...)` 加可选参数 `textbook_id: Optional[str] = None`：
  - 传入时过滤条件为 `(textbook_id = ? OR textbook_id IS NULL)`——**老数据保持所有教材可见**，新数据精确归属；
  - 与 `page_number`、`chat_id` 参数自由组合；**执行时修正**：chat_id 精确查分支不参与教材过滤（lead 决策——按 id 取单条记录与教材归属无关，跨教材的精确恢复不能被误伤）。

### 3.3 路由 — `app/routers/chat.py`

- `SaveChatRequest` 加 `textbook_id: Optional[str] = None`，`create_history` 透传给 `save_chat_history`；
- `GET /history/{user_id}` 加查询参数 `textbook: Optional[str] = None`，透传给 `get_chat_history`（**执行时统一命名为 `textbook_id`**，与列名、POST 字段同一术语）；
- `UpdateChatRequest` / `PATCH` 不动（教材归属创建时确定，不允许改）。

## 4. 前端改动（5 处）

### 4.1 API 层 — `frontend/src/services/api.ts`

- `createChatHistory` 请求体加 `textbook_id`；
- `getChatHistoryByUser(userId, page, limit, textbookId?)`、`getAllChatHistory(userId, limit, textbookId?)` 追加 `textbook` 查询参数。

### 4.2 落库 — `frontend/src/hooks/useChat.ts`

- `createChatHistory` 调用处传 `textbookId: textbookId || undefined`（hook 已持有该值，零新依赖）。

### 4.3 类型 — `frontend/src/components/PageMarker.tsx`

- `Marker` 接口加 `textbook_id?: string | null`。

### 4.4 两个消费方按教材过滤

- `useMarkers(user, currentPage)` 加第三个参数 `textbookId`，fetch 时透传；`textbookId` 变化时 refetch（App 调用处已持有）；
- `useQuestionList(user, chatMessageCount)` 加 `textbookId` 参数，同上。

效果：徽标只在所属教材的页面上出现；侧栏只列当前教材的提问（NULL 老数据两边都仍可见，见 3.2）。

### 4.5 跨教材点击 — `App.tsx` `handleQuestionSelect`

```text
if (marker.textbook_id && marker.textbook_id !== textbookId) {
  savePage(marker.textbook_id, marker.page_number)  // 先写页码恢复键
  setTextbookId(marker.textbook_id)                  // 再切书：PDFViewer 的恢复 effect 恰好落在目标页
} else {
  setCurrentPage(marker.page_number)                 // 同书/老数据：现状直跳
}
```

关键点：**利用 PDFViewer 既有的「换教材恢复页码」机制完成跳页**，而不是切书后再 `setCurrentPage`——后者会被 restore effect 用旧页码覆盖（时序竞态）。`savePage` 是 PDFViewer 内 `pdf_viewer_page_v2` 的写入函数，需导出复用（或把该函数挪到 `utils/storage.ts` 层，顺带完成存储收敛的尾巴）。

NULL 老数据点击不切书、直跳页码（与现状一致，不惊喜）。

## 5. 明确不做

- **老数据回填**：可根据 page_count/教材元数据猜归属，但 4 本书页码大量重叠，猜错比不猜更糟；保持 NULL = 全教材可见。
- `/solve-stream` 问答链路：已带 `textbook_id`，本方案不涉及。
- `migrate_user_id`（匿名→登录迁移）：按 user_id 整批迁移，与教材无关，不动。

## 6. 验收清单

| # | 场景 | 预期 |
|---|------|------|
| 1 | 老库启动（含无 textbook_id 列的 learning.db） | 幂等迁移补列，不报错，老数据完整 |
| 2 | 全新库启动 | 建表即含 textbook_id |
| 3 | 高代里提问 → 落库 | 记录 textbook_id = gaodai_shang |
| 4 | 切到高数 | 侧栏不显示该提问（NULL 老数据仍显示）；高代页面上的徽标在高数同页码不再出现 |
| 5 | 侧栏点击其他教材的记录 | 自动切书 + 落到正确页 + 对话加载 |
| 6 | 后端 pytest 补一条：保存带 textbook_id → 按教材过滤查询 | 通过 |
| 7 | 前端 `npm run build` + e2e | 零错误、全量通过 |

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 老库 ALTER 失败 | 沿用现有幂等模式（列已存在则跳过），验收场景 1 覆盖 |
| 跨教材跳页时序竞态 | 用「先写恢复键再切书」绕开 restore effect 覆盖问题（4.5），验收场景 5 实测 |
| 过滤条件 `(= ? OR IS NULL)` 让老数据在所有书可见，用户可能困惑 | 这是刻意的兼容选择；后续若在意可在侧栏给 NULL 记录加「未标记教材」徽标，本方案不做 |

## 8. 工作量与提交节奏

约半天。建议 2 个 commit：后端 schema+API 一个；前端贯通一个。验收 1–5 手工实测（复用本次审核的浏览器预览环境），6–7 自动化。

## 9. 完成记录（2026-08-16，lead 流程执行）

两个 commit 落地，均经 coder 实现 + reviewer 审核：

- 后端：feat(db): chat_history 增加 textbook_id 并支持按教材过滤查询——schema/幂等迁移、DB 层过滤（含 3.2 注记的 chat_id 偏离）、路由参数（统一命名 textbook_id）、新增 tests/test_textbook_isolation.py（含老库迁移用例 C）；
- 前端：feat(frontend): 提问记录按教材隔离并支持跨教材跳转——API 层贯通、Marker 类型、useMarkers/useQuestionList/useChat 落库与过滤、savePage 抽取为 utils/pagePosition、跨教材点击（先写恢复键再切书）、切书重置线程（用户拍板：新线程属于新书则跳过重置，消解竞态）；
- 自动化验收：pytest 43 passed + 3 skipped（含新用例）、npm run build 零错误、playwright 3 passed + 1 skipped；
- 补充修正（计划遗漏、lead 执行时补上）：useChat 加载对话 effect 依赖加 currentPage——否则跨教材点击时对话永远不加载（页码要等 PDFViewer 加载完新教材才更新，effect 早已因页码不匹配跳过）；
- 运行时库验证：data/learning.db 10 条老数据 textbook_id 全为 NULL（未回填），列由启动迁移自然补上。
