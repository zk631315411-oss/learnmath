# LearnMath 前端重构测试报告

日期：2026-08-19  
依据：`../01-completed-plans/FRONTEND_REDESIGN_EXECUTION_PLAN.md`（v2）、`../08-deprecated/FRONTEND_REDESIGN_PLAN.md`、`../08-deprecated/FRONTEND_REDESIGN_TEST_PLAN.md`

## 1. 结论

前端重构与地图页改版已按执行计划完成。F1-F13、E1-E10、M1-M7、D1 均已落地并通过；地图 E2E 已迁移到静态 catalog + `/api/learning-progress` 夹具，不再依赖旧 `/api/learning-map/*` mock。

自动化问答 E2E 使用 `page.route` mock SSE；真实 LLM 闭环另见第 10 节，不混入自动化回归。

## 2. F1-F13 修复确认

| 项目 | 状态 | 实现摘要 |
|---|---|---|
| F1 流式期间页码分裂 | 通过 | `PDFToolbar` 保留页码/缩放显示并禁用翻页、页码输入和截图；`BottomSheet` 同步锁定翻页、档位和各入口；App 保留回调守卫。E10 覆盖。 |
| F2 失败章卡重试 | 通过 | `MapHome` 失败章卡改调 `onRetry()`，正常章卡仍进入阅读。 |
| F3 移动端重复页码控件 | 通过 | 移动端移除 `PDFToolbar`，页码、翻页和功能入口统一由 44px 把手栏提供。 |
| F4 右栏断点 | 通过 | 右栏保持 360px，仅在 `min-width: 1440px` 扩至 400px。 |
| F5 pendingCount 位置 | 通过 | 徽标移到“AI 旁批”按钮；E8 完成真实移动端裁剪后断言计数为 1。 |
| F6 Bubble 高度 | 通过 | 最大高度从 72dvh 调整为 60dvh，内容区内部滚动。 |
| F7 卡片预览过长 | 通过 | 本页记录回答预览限制为 3 行。 |
| F8 鉴权失败永久骨架 | 通过 | `useAuth` 暴露 `authReady`；App 等鉴权结束后再决定恢复策略，无 token 时可进入地图并直接阅读。新增 F8 E2E 覆盖匿名认证失败逃生口。 |
| F9 流式中切书/切地图 | 通过 | header 教材选择和地图/阅读切换在 Bubble streaming 时禁用并有回调守卫。E10 覆盖。 |
| F10 章节序号重复 | 通过 | `chapterTitle` 仅从原始章节字符串解析编号，卡片和详情不再叠加数组 index。M4/E7 覆盖。 |
| F11 章节卡状态摘要 | 通过 | 使用 `status_counts` 和分段状态条，零进度显示“尚未开始”。M4 覆盖。 |
| F12 移动端品牌折行 | 通过 | 小于 `sm` 隐藏品牌文字，教材入口不被挤压。移动端视觉归档覆盖。 |
| F13 body 旧背景令牌 | 通过 | `index.html` 删除 `bg-slate-50`，页面背景统一由 `--lm-bg` 控制。构建与视觉归档覆盖。 |

执行中另修复 3 个与计划链路直接相关的问题：

- 章节扫描命中后先持久化目标页，再挂载 PDFViewer，避免首次恢复把第 26 页覆盖回第 1 页。
- BottomSheet 从按钮起手时不抢占 pointer capture，恢复移动端翻页、AI、截图和工具按钮的真实点击。
- ImageCropper 在图片加载时初始化默认中心裁剪，用户无需先拖动即可“确认截取”。

## 3. 自动化结果

| 检查 | 结果 |
|---|---|
| `npm run build` | 通过，0 error；仅有 Vite 大 chunk 提示，不阻塞交付 |
| `python -m pytest -q` | 102 passed，3 skipped，23 subtests passed |
| evidence 专项 | 22 passed |
| Playwright 全量（chromium-desktop） | 34 passed，4 skipped；含公式编辑器和 redesign 套件 |
| Playwright redesign（chromium-mobile） | 3 passed，27 skipped；skip 为桌面专属用例 |
| `git diff --check` | 通过 |

E1-E10 结果：

| 用例 | 结果 | 核心证据 |
|---|---|---|
| E1 | 通过 | 对话视图翻页保持，来源页横幅可跳回 |
| E2 | 通过 | 本页提问 POST 新线程，对话追问 PATCH `follow_ups` |
| E3 | 通过 | 第 1/2/3 页记录隔离，空页 starters 正确 |
| E4 | 通过 | drawer 与框选 overlay 互斥，Esc 可取消 |
| E5 | 通过 | Bubble 追问后可在右栏展开且保留截图消息 |
| E6 | 通过 | 地图与阅读切换后活动对话仍在 |
| E7 | 通过 | 静态 catalog 页码直接落到第 26 页；无 section-page 请求时仍进入可用 reader |
| E8 | 通过 | 移动端三档、真实裁剪、默认确认、pendingCount=1 |
| E9 | 通过 | 地图与阅读明暗模式切换正确 |
| E10 | 通过 | streaming 中翻页、截图、切书、切地图均禁用，结束后恢复 |
| D1 | 通过 | SSE `progress_delta` 直接更新章节状态；`/api/learning-progress` 只请求一次 |

补充用例验证了 390x844 下 CaptureBubble 为贴底卡片，并可完成 mock 流式回答。

## 4. 地图新增用例

| 用例 | 结果 | 核心证据 |
|---|---|---|
| M1 | 通过 | 应用内教材菜单列出全部教材、当前项勾选；切书后章节/统计同步；单次共享请求和延迟旧响应隔离均有断言。 |
| M2 | 通过 | 教材选择刷新持久化；workspace 的 view/page 和地图缓存按教材/身份隔离；切换匿名身份后旧用户地图不会短暂显示。 |
| M3 | 通过 | manifest/index 先显示章节卡；章节详情使用静态教材 JSON，旧节点接口请求数为 0。 |
| M4 | 通过 | 章节编号不重复，learning/needs_review/mastered/未探索摘要与分段条正确；继续学习明确优先 needs_review。 |
| M5 | 通过 | 卡片进入地图内章节详情，返回按钮恢复章节网格。 |
| M6 | 通过 | 来源提问页优先；来源缺失时按当前节点 section、章节首节依次 fallback，均有页码断言。 |
| M7 | 通过 | progress 503 时静态章节仍可显示，并保留直接阅读与刷新进度入口。 |
| M8 | 通过 | E10 验证流式期间翻页、切书、切地图入口锁定，完成后恢复。 |

## 5. 视觉归档

归档目录：`artifacts/visual-20260818/`，最终验收有效截图 30 张（另有一次手工调试截图，不计入归档数量）。

| 场景 | 覆盖 |
|---|---|
| 地图 | 1440 明暗、1280 明、768 明暗、390 明暗、812 横屏明；使用 learning/needs_review 有 evidence 数据态 |
| 地图教材菜单 | 1440、1280、768、390、812 明色打开态 |
| 章节详情 | 1440 明暗、1280 明、768 明暗、390 明暗、812 明，含展开节点 |
| 阅读 + drawer/工具全屏 | 1440 明暗、1280 明、812 横屏明 |
| 阅读 + BottomSheet 半屏 | 768 明、390 明暗、812 横屏明 |
| CaptureBubble 完成态 | 1440 明，右边缘选区自动向左放置 |

人工抽查结论：未发现横向溢出、控件重叠或文本截断；390 半屏布局和 812x375 横屏工具布局可用；暗色 drawer 的遮罩、边界和对比度正常；主色为 indigo，状态色仍可区分。

## 6. 接口性能实测

测试环境：本机后端 `127.0.0.1:8001`、真实 Neo4j/PDF 数据、独立匿名用户；时间为单次串行请求墙钟耗时。以下旧地图接口数据保留作为迁移前基线。

| 请求 | 首次/本轮耗时 |
|---|---:|
| `/learning-map/chapters?gaodai_shang` | 2444 ms |
| `/learning-map/chapters?gaodai_xia` | 873 ms |
| `/learning-map/chapters?gaoshu_shang` | 1615 ms |
| `/learning-map/chapters?gaoshu_xia` | 1206 ms |
| 重复 `/learning-map/chapters?gaodai_shang` | 1978 ms |
| `/learning-map/nodes` 单章范围 | 439–1307 ms |

新链路不再调用上述接口。运行时实际链路为：静态 `manifest.json`（包含最小节点索引）+ 单次 `/api/learning-progress`；章节详情才按需读取静态教材 JSON。桌面 E2E 已断言旧地图接口请求数为 0，D1 已断言问答后的 progress 请求不重复。

静态目录导出结果：四本教材生成成功，根 manifest 约 2.3 MB（浏览器可缓存），完整教材 JSON 按教材约 1.0–2.3 MB；构建脚本已校验节点 ID、章节顺序、PDF 页码范围和目录 hash。

## 7. section-page 真实抽测

通过本地 8001 后端和真实 PDF 书签/文本解析调用 12 个样本。高等代数两册均精确命中 PDF 书签页；高等数学两册没有可提取目录/正文文本，按契约返回 `page:null`，不参与精度判定。

| 教材 | section | API page / confidence | PDF 书签起始页 | 误差 | 结论 |
|---|---:|---:|---:|---:|---|
| 高等代数上册 | 1.1 | 26 / 1.0 | 26 | 0 | 通过 |
| 高等代数上册 | 2.1 | 52 / 1.0 | 52 | 0 | 通过 |
| 高等代数上册 | 3.1 | 102 / 1.0 | 102 | 0 | 通过 |
| 高等代数下册 | 7.1 | 15 / 1.0 | 15 | 0 | 通过 |
| 高等代数下册 | 8.1 | 165 / 1.0 | 165 | 0 | 通过 |
| 高等代数下册 | 9.1 | 240 / 1.0 | 240 | 0 | 通过 |
| 高等数学上册 | 1.1 | null / 0 | 无可提取目录 | - | 记录，不判精度 |
| 高等数学上册 | 2.1 | null / 0 | 无可提取目录 | - | 记录，不判精度 |
| 高等数学上册 | 3.1 | null / 0 | 无可提取目录 | - | 记录，不判精度 |
| 高等数学下册 | 7.1 | null / 0 | 无可提取目录 | - | 记录，不判精度 |
| 高等数学下册 | 8.1 | null / 0 | 无可提取目录 | - | 记录，不判精度 |
| 高等数学下册 | 9.1 | null / 0 | 无可提取目录 | - | 记录，不判精度 |

## 8. evidence 链路审计

- `tests/test_evidence_db.py`、`tests/test_evidence_pipeline.py`、`tests/test_evidence_reporting.py`：22 passed。
- `useChat.ts` 发往 `streamQA` 的请求仍携带 `chat_id`、`marker_id`、`page_number`、`textbook_id`、`crop_bbox`、`screenshot_context_id`。
- 当前数据库有 3 条真实 `agent_self_report` evidence，全部能关联到现存 user 和 chat，且 `created_at` 完整。
- 同一真实线程先记录 `unresolved`，后记录 `independent`；另一较新线程记录 `unresolved`，符合未提供闭合信号时的预期。
- `AiBall.tsx` 已删除，源码与 E2E 无 AiBall 引用。

## 9. 已知边界

- 高等数学两册是扫描型 PDF 且缺少可提取书签/文本，章节定位按既定 fallback 进入 reader，但无法提供精确页码。若要提高命中率，需要后续增加 OCR/人工目录索引；本轮没有引入该范围。
- Vite 报告主 bundle 超过 500kB；当前功能和加载均正常，属于后续性能优化项。

## 10. 真实 LLM 链路复验

2026-08-18 使用独立匿名用户走真实后端完成两轮高等代数问答，没有使用 SSE mock。

- user：`cc9a4541-d5f3-4923-9b1b-19afb69984e9`
- chat：`37eadc28-8665-44ac-b123-cc613dde6bce`
- 第一轮耗时 14.734s：真实调用 `retrieve_kg_context`，精确命中 `gaodai_shang:node:60a83e5e6d8c`（线性无关）；落 evidence 为 `unresolved / level 0`。
- 第二轮耗时 28.133s：先得到“线性无关/线性相关”候选，再用 node_id 精确 resolved；学生给出正确解释后落 evidence 为 `assisted / level 1`。
- 两条 evidence 的 `user_id/chat_id/qa_turn_id/node_id/created_at` 均完整，`invalid_node_ids=0`。
- 学习地图接口返回该节点 `status=learning`、`closed_evidence_count=1`、`chat.available=true`，证明聊天、证据和地图投影已闭环。
- 两轮自评的 `report_path` 均为 `forced_fallback`：主回答阶段没有自主调用自评工具，后端的强制收尾流程通过第二次真实模型调用完成了 `report_turn_outcome`。因此最终闭环可靠，但当前可靠性来自 fallback，而非主轮模型稳定自觉上报。
