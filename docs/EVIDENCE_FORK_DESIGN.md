# 证据自评「主干—分叉」两段式 · 设计与实施计划

> 日期：2026-08-18
> 触发：前端重构测试轮的真实 LLM 抽测（结果见 `docs/FRONTEND_REDESIGN_TEST_REPORT.md`）
> 状态：方案已与产品决策人对齐，待实施
> 范围：`app/services/qa/`、`app/services/agents/`、`app/services/qa/prompt_builder.py`、前端收尾状态和相关测试；不改现有 SSE 事件结构，不改 evidence 表结构

## 一、发现与定性

真实 LLM 抽测（2026-08-18，同一线程两轮）：

- 主回答阶段自主调用 `report_turn_outcome` 的次数为 **0**；两轮均由后端 `forced_fallback` 发起第二次真实模型调用完成自评。
- 评级语义正确：第一轮（学生仅提问）`unresolved / level 0`；第二轮（学生在引导下正确解释）`assisted / level 1`。
- 落库完整：聊天、用户、时间戳、节点关联齐全，`invalid_node_ids=0`，节点状态正确推进为 `learning`。
- 耗时：14.7s / 28.1s（两轮总耗时，含 fallback）。

**定性：双路径没有继续保留的工程价值。** 两轮实测只能证明本次主回答自主上报为 `0/2`，不能推出所有模型版本的普遍遵从率；但产品不需要依赖这种不确定行为。自评是对“学生最近一条消息及此前所获帮助”的内部判定，统一由后端确定性触发更容易约束、观测和测试。

**决策：把 forced_fallback 扶正为正式机制，删除 primary 路径，按「主干—分叉」模型统一表述。**

## 二、架构：主干—分叉两段式

```
retrieve_kg_context（KG 命中）
  → 主回答流（学生实时可见）
  → [回答文本流结束]
  → stage 事件："正在记录学习进度…"
  → 分叉调用（专用 one-shot 执行器，只挂 report_turn_outcome；
     上下文 = 主回答生成前的快照，不含刚生成的老师回答与 thinking；
     评价锚点 = 学生最近一条消息 + 此前对话中获得的全部帮助）
  → 校验（resolved ∪ 线程 resolved 集合 + 教材前缀）→ 落 evidence_turns
  → done
```

**快照语义（2026-08-18 决策人修订）**：分叉**不把刚生成的老师回答纳入本次评价**。理由：

1. **锚点无歧义**：分叉运行时学生还没看到新回答；若把新回答放进上下文，"老师最后提的问题"就变成学生尚未回应的那个，评价参照系漂移。快照语义下被评价对象永远是学生最近一条消息，它就是上下文中最后一条学生输入。
2. **更省**：分叉请求 = 主回答请求的原始消息 + 一小段收尾指令，与主请求前缀逐字节一致（连回答都不插入），cache 命中更纯；同时甩掉刚生成的 answer + thinking（thinking 可能数千 token）。
3. **与既有设计自洽**：PHASE2 已规定"同线程后续轮次可升级判断"——本轮教师讲授后学生未回应则落 unresolved；学生下轮回来说"懂了"，下一轮分叉在含本轮回答的完整历史里升级为 assisted/direct_taught。证据晚一轮落，不丢。

代价（诚实记录）：教师直接讲授后学生一去不回的**终局轮**只落 `unresolved / level 0`，不落 `direct_taught`。苏格拉底式系统里直接讲授本就稀有，且学生从未给出掌握信号时落 unresolved 反而更诚实——接受。

**分叉的四个性质**（设计的全部理由）：

| 性质 | 含义 | 收益 |
|---|---|---|
| 前缀共享 | 分叉请求 = 主回答请求的原始消息（快照）+ 一小段收尾指令 | 保留服务商前缀缓存的可能性；实际命中与折扣以 provider usage 数据为准 |
| 单向写 | 分叉产出只进证据库，不回写对话历史 | 主干永不污染；学生不可见；下一轮上下文无簿记痕迹 |
| 请求内串行 | 与主回答同一 SSE 请求内先后执行 | marker_id / chat_id / qa_turn_id 和本轮 resolved 集合现成；线程 resolved 仍按现有实现读取 DB |
| 一次性 | 单轮调用，无工具循环 | 成本有界；无死循环面 |

**延迟的处置不是压缩，是重叠**：分叉运行在学生阅读回答的时间窗内。阶段提示的作用是把这段等待从"转圈死寂"变成"可见的收尾动作"。

### 三个"不做"的论证

- **本阶段不裁剪分叉上下文**：完整历史能保留“此前是否给过提示”的评分依据，也保留前缀缓存的可能性。缓存收益不是本方案成立的前提；后续依据真实 token、缓存和延迟数据再决定是否裁剪。
- **不做 done 后异步自评**：脱离请求后需重查 DB 重建上下文绑定，留崩溃丢证据窗口，前端历史落库时序与 F1/F9 锁语义（流式禁翻页/禁切书）全被打破——即 ai-math 旧架构的三条失败模式。
- **分叉不接便宜模型**：单人学习应用量级，再铺一条模型客户端与配置的复杂度不值；cache 折扣已拿走大部分成本。

## 三、改动清单

| # | 改动 | 文件 | 说明 |
|---|---|---|---|
| C1 | 分叉前发阶段提示 | `app/services/qa/answer_service.py` | eligible 时、one-shot 分叉前发送 `sse_stage("evidence_report", "正在记录学习进度…")` |
| C2 | 主提示词删自评指令 | `app/services/qa/prompt_builder.py` | 删除"每轮教学的收尾都必须调用 `report_turn_outcome`…不得省略"整句（约 line 62）。主提示词回归纯教学职责 |
| C3 | 主回合工具列表摘掉 report 工具 | `app/services/agents/tools/__init__.py`、`app/services/qa/answer_service.py` | 见下方**陷阱警告**。工具 schema 才是 prompt token 大头，指令和工具定义要一起下 |
| C4 | 偏离注记 | `docs/PHASE2_LEARNING_MAP_PLAN.md` | 证据链路一节补注：primary 路径经实测废除，架构以本文档为准（**已完成**） |
| C5 | 固定分叉快照语义 | `app/services/qa/answer_service.py` | 使用 `runtime_messages + 收尾指令`，不追加刚生成的 assistant answer/thinking；提示明确锚定学生最近一条消息 |
| C6 | 专用 one-shot 执行器 | `app/services/agents/`、`app/services/qa/answer_service.py` | provider 只调用一次；强制 `report_turn_outcome`；成功执行工具后立即返回，不进入 ToolRuntime 工具循环，也不补 `tool_choice=none` 文本调用 |
| C7 | 正式路径与指标 | `app/services/qa/answer_service.py`、`app/services/qa/evidence_reporting.py` | `report_path` 改为 `evidence_fork`；记录 eligible、fork attempted、tool succeeded、evidence persisted、invalid ids；`latency_ms` 改为包含分叉的总耗时，并单独记录 main/fork 耗时 |
| C8 | 可见收尾状态 | `frontend/src/hooks/useChat.ts`、`ChatPanel.tsx`、`CaptureBubble.tsx` | 保留 stage key；正文已经出现时仍在正文下方显示 `evidence_report` 状态，done 后清除 |
| C9 | 回归测试 | `tests/`、`frontend/e2e/` | 锁定主工具列表、快照边界、one-shot 恰好一次 provider 调用、正式路径、指标/耗时和正文后的收尾状态 |

**C3 陷阱警告（实施前必读）**：当前分叉的工具定义是从主回合列表**过滤**出来的（`answer_service.py:292`：`report_tool_defs = [t for t in tool_defs if t.name == REPORT_TURN_OUTCOME_TOOL_NAME]`）。若直接从 `get_qa_tool_defs` 删除 report 工具，过滤结果为空 → `if report_tool_defs:` 不成立 → **分叉永不触发，证据链静默死亡**（ADR-001 决定了证据故障不向问答链抛出，所以不会有任何报错）。正确做法：

1. 主回合装配只挂 `retrieve_kg_context`（`get_qa_tool_defs` 加 `include_report_tool: bool = False` 参数，或拆成两个装配函数）；
2. 分叉块改为直接调用 `build_report_turn_outcome_tool()` 构造，不再过滤主列表。

**指标口径调整**：废止 primary `compliance`，改为 `fork_attempt_rate`、`fork_tool_success_rate`、`effective_persistence`。三者分别区分“触发了分叉”“模型给出合法工具调用”“证据通过校验并落库”。复测中 eligible 证据的 `report_path` 应为 `evidence_fork`。

## 四、分工与顺序

1. 负责人：本文档 + C4（PHASE2 注记）。
2. 执行 AI：C1–C9 按同一条链路实现 → 后端定向测试 → 前端构建/E2E → `python -m pytest -q` → 真实 LLM 复测（§五）。

## 五、验收

1. `python -m pytest -q` 全绿。注意 `tests/test_evidence_pipeline.py`、`tests/test_unified_qa_routing.py` 等可能有断言主回合工具列表或提示词内容的用例，需随 C2/C3 同步更新——**特别检查是否恰好有测试在保护 line 292 的过滤行为**。
2. 真实 LLM 复测三种收场，评级口径与改动前一致：学生独立答对 → `independent`；提示后答对 → `assisted`；放弃/未答出 → `unresolved`。**快照语义专项**：教师提示/讲授后学生未回应的轮次 → 落 `unresolved / level 0`（新语义，不再因老师回答了就直接闭合）；学生次轮回来说"懂了"或正确复述 → 该轮升级为 `assisted`（此前轮次的教师帮助在历史中可见）。
3. `invalid_node_ids=0`；evidence 行正常落库；节点状态推进正确。
4. SSE 事件序列（可在复测日志或浏览器 Network 中核对）：`content* → stage(evidence_report) → done`；分叉不产生任何 `tool_call`/`tool_result` 展示事件（report 是内部工具，原有逻辑即不入展示流）。
   前端在正文已存在时仍能看到“正在记录学习进度…”，done 后状态消失。
5. 回答质量人工判断无回归（删指令后模型应更专注教学）。
6. 记录改动前后同问题的总耗时各一轮（预期持平或略降；本改动的收益是 token 与职责清晰，不是延迟）。
7. 单测证明每个 eligible turn 的分叉恰好发起一次 provider 请求；不得出现分叉后的 no-tool 最终文本请求。
8. `done.latency_ms` 等于包含分叉在内的总耗时；日志同时给出 `main_latency_ms` 和 `fork_latency_ms`。

## 六、明确不做

- 不做 done 后异步自评（§二论证）。
- 不裁剪分叉上下文（§二论证）。
- 分叉不接便宜模型（§二论证）。
- 不改 evidence 表结构、评分 rubric 内容（rubric 仍在分叉的系统提示里，原样保留）。
- 不保留 primary 失败后的第二套 fallback；one-shot 证据分叉就是唯一正式路径，失败只记指标，不递归补救。
- 不承诺 provider 前缀缓存命中或固定折扣；缓存是待观测优化，不是正确性依赖。

## 七、风险与回退

| 风险 | 缓解 |
|---|---|
| C3 改错导致分叉静默不触发（证据停更、问答正常、无报错） | 验收 §五-1/3 的落库断言是唯一的抓住手段，必须执行；不能靠用户感知 |
| 删指令后个别模型版本行为变化 | 分叉是确定性机制，不依赖主回合配合，无影响 |
| provider 未返回工具调用、参数非法或落库失败 | 记录失败指标并正常结束问答；evidence 为 best-effort，不把诊断故障升级为回答故障 |
| 客户端在回答正文后、分叉完成前断开 | 当前请求会被取消，允许本轮 evidence 缺失；用指标发现，不为本阶段引入后台队列 |
| 回退 | 已提交时使用 `git revert <commit>`；未提交时只逆向本次精确 patch，不覆盖工作区其他改动 |
