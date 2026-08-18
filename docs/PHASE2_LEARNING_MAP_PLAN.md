# LearnMath 阶段 2：学习地图实施计划

> 范围：阶段 2「展现学生的学习地图，让学生知道自己哪里还学得不太好」
> 日期：2026-08-17（v3.1，明确 Mikhelson 工程裁剪、互斥投影与运行可靠性口径）
> 理论依据：Mikhelson 2026《苏格拉底式测试的理论基础》（动态评价 / ZPD / 渐进脚手架 / 证据冗余 / 事后校准）。本计划借鉴其“在何种支持条件下完成”与“多条证据缓冲单次误判”的思想，裁剪为自由学习场景版本；不是对论文 Bloom×SOLO 分值桶、120% 过采样、影子账本、状态机和教师复核队列的直接复现。
> 前置结论（已与需求方确认）：
> 1. 证据入口 = **主 Agent 自评工具单入口**；v2 曾引入的「KG resolved 自动落 exposure 行」兜底经复议**否决**（理由见 §1.4 决策 4）；
> 2. 地图形态 = 当前章小地图 + 全书章地图，分层展示；
> 3. 无证据节点 = 「未探索」灰色；前置全薄弱的后置节点标「可能受阻」提示、不标红；
> 4. 地图实时刷新（问答结束即更新），不引入 Worker / 轮询 / WebSocket / 灰度档位；
> 5. 沉默（学生不置可否离开）是常态：未闭合证据只能点亮「学习中」，不能参与定色；
> 6. 章地图可行性前提**已实测通过**（见 §1.0）。

## 1.0 可行性前提核查（已于动工前完成）

2026-08-16 对 Neo4j 生产库做只读抽样，结果：

| 教材 | 节点数 | chapter 覆盖 | section 覆盖 | 章数 | 单章节点范围 |
|---|---:|---:|---:|---:|---|
| gaodai_shang | 1514 | 100% | 100% | 6 | 112–443 |
| gaodai_xia | 1466 | 100% | 100% | 5 | — |
| gaoshu_shang | 3281 | 100% | 100% | 6 | 305–1063 |
| gaoshu_xia | 2407 | 100% | 100% | 6 | — |
| 合计 | 8668 | 100% | 100% | — | — |

章值为真实教材章名（如「第3章 线性方程组解集的结构」）。**前提成立，无需补属性方案、无需改用 SUPERIOR/PART_OF 爬树。**

附带发现（直接影响 UI 设计，已写入 P2-11）：节点分布极不均匀（高数上第 1 章 1063 个节点），章内小地图**不能平铺全部节点**，必须按 section 折叠分组 + 默认「只显示有证据/受阻节点」。

## 1.1 证据模型：请求内 one-shot 证据分叉

> **实施定案（2026-08-18）**：主回答只挂 `retrieve_kg_context`，不再包含自评提示或工具。回答文本流结束后，同一 SSE 请求使用主回答生成前的消息快照执行一次 one-shot 证据分叉，并强制调用 `report_turn_outcome`。快照锚定学生最近一条消息，不含教师针对该消息刚生成的回答与 thinking。完整设计、失败语义和验收记录见 `docs/EVIDENCE_FORK_DESIGN.md`。

证据分叉上报本线程在目标知识点上的当前状态：

```json
{
  "node_ids": ["gaodai_shang:线性无关"],
  "scaffolding_level": 3,
  "student_outcome": "assisted"
}
```

- `node_ids`：1–3 个 KG 稳定 id，必须来自本轮/本线程 `resolved` 的工具结果（服务端校验，非法值丢弃记日志）；落库**每节点一行**，同一 `qa_turn_id` 多行。
- `textbook_id` **不进自报 schema**：由后端按当前问答上下文绑定（与 `retrieve_kg_context` 同一既定约定，见 KG_TOOL_DESIGN）；落库时校验 node_id 前缀与上下文教材一致，不一致丢弃记日志。
- **调用粒度**：eligible turn 只发起一次 provider 请求和一次工具调用；同一 call 内最多 3 个 node_id，且共享一个 outcome。失败只记指标，不递归补救，也不阻断学生可见回答。
- `scaffolding_level`：本线程在该知识点用到的最深脚手架级数 `0–4`。**v1 仅采集、不参与定色**——为调参与离线校准预留数据，避免语义悬空。
- `student_outcome`：`independent | assisted | direct_taught | unresolved`。前三者为闭合证据（学生有可识别收场信号：说懂了、正确复述、提出进阶新问题）；`unresolved` 为未闭合。**时序语义（易误读，特别强调）**：分叉虽然在回答流结束后执行，但评价快照停在回答生成前，描述的是截至学生最近一句话的状态。学生问完就离开时最新证据自然停在 unresolved；日后回来补一句「懂了」，下一轮分叉再根据历史帮助升级判断。
- 同线程后续轮次可升级判断（学生回来说「懂了」→ 新一轮把该节点从 unresolved 提为 assisted）。**读时按时间序取最新闭合证据收口，历史行全部保留**（不是物理覆盖）。
- `chat_id` 对齐现有「徽标 + follow_ups」模型：追问轮次的 evidence 挂主徽标行 id，`qa_turn_id` 保留溯源到具体轮次。

## 1.2 证据表（SQLite，新表）

```sql
CREATE TABLE IF NOT EXISTS evidence_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT,                 -- 主徽标行 id（chat_history.id）
  qa_turn_id TEXT,              -- SSE turn id，溯源到具体轮次
  node_id TEXT NOT NULL,
  textbook_id TEXT,
  scaffolding_level INTEGER,    -- 0..4，v1 仅采集
  outcome TEXT NOT NULL,        -- independent|assisted|direct_taught|unresolved
  source TEXT NOT NULL,         -- agent_self_report | offline_calibration
  model_version TEXT,           -- 校准重放时区分标签版本
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_evidence_user_node ON evidence_turns(user_id, node_id);
```

四值是对论文交互变量的工程映射：`independent ≈ k=0 成功`，`assisted ≈ k=1..3 成功`，`direct_taught ≈ k=4 直接教学`；`unresolved` 是自由学习中新增的未闭合状态。它们用于学习地图，不等同于论文的总结性考试分数。

## 1.3 投影规则 v1（确定性纯函数，无 LLM）

对每 `(user_id, node_id)` 读证据序列（读时取最新，不删行）。**`source` 不参与 v1 投影**——`offline_calibration` 行的优先级规则随 P3 校准脚本一并定义。

规则按下表**自上而下首次命中即返回**，因此互斥且覆盖全部证据序列。“多数”严格定义为 `count > window_size / 2`。

| 优先级 | 状态 | 规则（v1 默认，常量化可调） | 颜色 |
|---:|---|---|---|
| 1 | 未探索 | 无任何证据 | 灰 |
| 2 | 学习中 | 有证据但闭合证据 < 2 条 | 黄 |
| 3 | 已掌握 | ≥2 条闭合且最新两条均为 independent | 绿 |
| 4 | 薄弱 | ≥2 条闭合，且最新闭合 = direct_taught；或最近至多 5 条闭合中 assisted/direct_taught 严格过半 | 红 |
| 5 | 基本掌握 | 其余所有闭合证据 ≥2 条的情况 | 浅绿 |

派生提示（不落库，读时计算）：节点本身无薄弱证据、但其 KG 明确前置（PREREQUISITE_OF 有界前几项）全部薄弱 → 「可能受阻」徽章，不改节点本色。

学生可见文案中性化：内部状态名保持「薄弱 / direct_taught」，地图上显示为「**建议再听讲解**」一类中性措辞，不出现「薄弱」「差」。

「闭合 ≥2 才定色」是对 Mikhelson 证据冗余思想的最小代理：单条自评误判无法封顶或抹黑任何节点；它不是论文 120% 分值缓冲的直接实现。unresolved 不参与长期定色；当闭合证据仍不足 2 条时，节点显示为「学习中」。

## 1.4 设计决策留痕

1. **小地图 v1 = 按 section 分组的节点列表，不做前后置连线的子图视图。** 理由：证据稀疏期，图视图是大片灰点挂几条边，视觉上像「什么都没学」，误导性强；前置关系 v1 由「可能受阻」徽章消费。后续迭代（证据足够密、或接入主动测评后）再加连线视图。已与需求方确认。
2. **非补偿性的保留形式**：仅体现为「已掌握必须 independent、assisted 封顶基本掌握」一条规则；`scaffolding_level` v1 只采集不定色。完整 Bloom×层级分值桶是考试机制，不做。
3. **不给掌握度数字**：章头进度条语义为「**探索进度**」= 有证据节点数 / 章内节点数（覆盖度），不是掌握分数。
4. **否决「KG resolved 自动落 exposure 证据行」（评审②复议结论）。** 否决理由：(a) 范畴错误——resolved 是**模型的检索解释**而非学生的客观行为，确定性落库不改变其主观性；(b) exposure 触发「未探索→学习中」无阈值保护，模型误定位会留下无法稀释的假触点；(c) 与 chat_history 双写同一事实，学生删除提问记录后 evidence 残留幽灵数据；(d) 「问过什么」已由提问记录侧栏完整承载，exposure 不提供地图的核心价值（掌握判断）。替代方案：漏报用日志埋点 + 上报率度量治理；若未来要在地图显示「问过但没结论」的触点，**读时从 chat_history 派生**（单一数据源、随删除自然消失），列为可选后续项，不进 v1。
5. **删除提问记录不级联删除 evidence（产品语义）。** 与决策 4(c) 不矛盾：4(c) 否决 exposure 的理由是「冗余副本」——副本残留是纯损失；自报行不是副本，是地图的独立资产。因此产品语义定为：**删除提问记录 ≠ 清除学习痕迹**，地图状态保留；且 ≥2 闭合定色阈值使单条残留无法定色。若未来需要真正的「清除学习痕迹」功能（含 evidence 级联删除），另行立项，不在 v1。

## 2. 系统架构

```text
学生提问
  → 现有 SSE 问答流（不变）
  → Kimi 收尾前调用 report_turn_outcome（不增加前端 HTTP 请求，仍在同一 SSE 内；通常增加一次模型调用）
  → 后端校验 node_id 合法性后落 evidence 行（一次 insert，毫秒级；**落库异常捕获后仅记日志，证据丢失不阻断回答**，沿用 ADR-001「诊断不拖垮问答」教训）
  → 前端 SSE done 到达后重新拉取 GET /api/learning-map（读时聚合）
```

投影（`app/services/learning/projection.py`）纯函数：输入 evidence 行 + KG 节点/前置关系，输出节点状态。重放 = 重跑函数。

## 3. 工作包分解

### P0 — 后端证据回路

| # | 任务 | 涉及文件 | 验收 |
|---|------|----------|------|
| 1 | 新建 `evidence_turns` 表与读写层；每个 SSE 问答轮次生成独立 `qa_turn_id`；确保 `created_at` 默认值生效 | `app/db/connection.py`、新建 `app/db/evidence_db.py`、`answer_service.py` | 幂等建表；同线程追问的 qa_turn_id 不同；读写和时间序单测过 |
| 2 | **分叉可观测性**：每轮结构化记录 `eligible`、`fork_attempted`、`fork_tool_succeeded`、`evidence_persisted`、非法 node_id 数及 main/fork/total latency | `app/services/qa/answer_service.py`、`evidence_reporting.py` | 可按 distinct qa_turn_id 计算分叉触发率、工具成功率和有效落库率，结果不超过 100% |
| 3 | one-shot 自评工具 `report_turn_outcome`（内部工具：不进 SSE tool_activities 展示流、学生不可见；只接受 resolved 的 `selected_node.node_id`） | `app/services/agents/one_shot_tool.py`、`tools/report_turn_outcome.py`、`answer_service.py` | eligible turn 恰好一次 provider 调用；正确落库；关系节点不能冒充目标；前端 AgentActivity 不显示它 |
| 4 | 主 prompt 删除自评职责；分叉提示保留四值 rubric、node_id 来源和“学生最近一条消息”快照边界 | `app/services/qa/prompt_builder.py`、`answer_service.py` | 真实问答标签符合快照语义；刚生成的教师回答不能单独形成闭合证据 |
| 5 | 匿名账号转正式账号时迁移 evidence，与 chat_history 使用同一次迁移请求和事务语义 | `app/db/chat_history_db.py`、`app/routers/chat.py` | 切换账号后提问记录和学习地图均保留 |

### P1 — 地图接口与投影

| # | 任务 | 涉及文件 | 验收 |
|---|------|----------|------|
| 6 | 投影纯函数 + 互斥规则表单测（含 I,I / A,A / D,I / A,A,A,I,I、unresolved、5 条窗口、blocked 派生） | 新建 `app/services/learning/projection.py`、`tests/` | 任意证据序列恰好得到一个状态；规则表全用例通过 |
| 7 | `GET /api/learning-map/chapters?textbook_id=`：从 Bearer token 取得 user_id，按章聚合五档计数 + **探索进度**（有证据节点数/章内节点数） | 新建 `app/routers/learning_map.py`、`app/main.py` | 不接受任意 user_id；空证据全灰；计数正确；进度语义为覆盖度 |
| 8 | `GET /api/learning-map/nodes?textbook_id=&chapter=`：从 token 取得 user_id，返回章内节点明细（按 section 分组；含状态、闭合证据数、blocked 徽章） | 同上 | blocked 正确；单章 1063 节点时响应可接受（必要时加仅证据过滤参数） |
| 9 | Neo4j 不可用：地图接口返回 `503 + map_unavailable`，问答链路不受影响 | 同上 | 断 Neo4j 后地图显示暂不可用，仍可继续提问 |

### P2 — 前端地图 UI

| # | 任务 | 涉及文件 | 验收 |
|---|------|----------|------|
| 10 | 数据层：`getChapterMap`/`getNodeMap` + `useLearningMap`；实时刷新 = `chat.isLoading` true→false 后 refetch | `frontend/src/services/api.ts`、新建 `frontend/src/hooks/useLearningMap.ts` | 问答结束后地图自动更新；503 显示地图暂不可用而不影响问答 |
| 11 | 章地图：每章一行（章名 + 五档计数条 + **探索进度条**） | 新建 `frontend/src/components/LearningMapPanel.tsx` | 无百分数字样；空态「提问后这里会出现你的学习地图」 |
| 12 | 小地图：按 section **折叠分组**（单章可达 1063 节点，实测分布见 §1.0）；默认「只显示有证据/受阻节点」，可展开全部；节点行 = 状态点 + 名称 + 「可能受阻」徽章 + 「建议再听讲解」中性文案；点节点跳最近仍存在的提问记录，记录已删时保持不可跳转 | 新建 `frontend/src/components/ChapterMapView.tsx` | 大章不卡；徽章不标红；文案无「薄弱」；孤立 evidence 不产生坏链接 |
| 13 | 入口集成：桌面左栏 / 移动抽屉加 Tab（提问记录 / 学习地图）。**注意**：`QuestionListPanel.tsx` 已存在且在运行（阶段 1 另一进程完成，commit fc5a269）——开工前确认工作树干净、阶段 1 零散文件已提交，避免与该进程未提交改动冲突 | `frontend/src/App.tsx` 等 | 两形态可切换；视觉走查通过 |

### P3 — 离线校准与度量（可延后）

| # | 任务 | 涉及文件 | 验收 |
|---|------|----------|------|
| 14 | 校准脚本：便宜模型重放重打标签，`source=offline_calibration` + `model_version` 写新行（不覆盖旧行）；**同时定义 source 优先级投影规则**（本任务交付物之一） | 新建 `scripts/calibrate_evidence.py` | 重放后投影按新标签生效；旧行可审计 |
| 15 | 度量：调用合规率 = 有 report 调用的 eligible qa_turn / eligible qa_turn；有效落库率 = 有合法 evidence 的 eligible qa_turn / eligible qa_turn；另看 unresolved 占比；>50% 时评估「懂了/还不懂」轻按钮（届时单独立项） | 日志/脚本 | 两个比率按 qa_turn 去重且不超过 100%，有数据支撑决策 |

## 4. 依赖与顺序

```
P0(1–5) 后端证据回路（2、3 可并行，4 依赖 3）
   └─► P1(6–9) 投影与接口
        └─► P2(10–13) 前端 UI（13 依赖阶段 1 工作树干净）
             └─► P3(14–15) 上线后按需
```

提交节奏：P0 一个 commit、P1 拆 2 个、P2 拆 2 个、P3 独立。

## 5. 风险与对策

| 风险 | 对策 |
|------|------|
| Kimi 忘记自评（上报率不足） | P0-2 日志埋点 + P3-14 上报率度量先行量化，低阈值迭代 prompt；不预建数据层兜底（见 §1.4 决策 4） |
| 自评系统性偏差 | ≥2 条闭合定色稀释；unresolved 不定色；P3 离线校准兜底 |
| 自评工具泄漏到学生可见流 | P0-3 展示层过滤，验收专查 |
| 模型编造 node_id | 服务端只接受本轮/本线程 resolved 结果中的 id，非法丢弃记日志 |
| 模型误定位导致证据挂错节点 | 自报带 outcome 语义，误定位的对话通常被报为 unresolved/direct_taught 且可被后续轮次覆盖；≥2 闭合阈值进一步稀释 |
| 单章节点过多（实测最多 1063） | P1-7 过滤参数 + P2-11 折叠分组 |
| Neo4j 抖动 | P1-9 返回地图暂不可用；KG 查询超时；问答链路独立 |

## 6. 验证方式

1. 后端 `pytest`：投影规则表、evidence 读写、接口种子数据。
2. 手工全链路：三种收场（独立答出/提示后答出/问完就跑）→ evidence 行、地图颜色实时变化。
3. **上线门槛：抽 10 个已定色节点，人工核对对话内容与颜色吻合度**——直接服务「证明 KG 有用」的总目标；轻量执行，过一遍眼记录结论即可，不出正式报告。
4. 前端：构建零错误；桌面/移动走查 Tab、折叠、徽章、空态；问答后实时刷新。
5. 回归：阶段 1 主链路不受影响（本阶段对问答流程的侵入 = prompt 增补 + 同一 SSE 内的内部自评工具调用 + 至多一次同步 insert）。

## 7. 明确不做

- Mikhelson 的二维分值桶、考试状态机、教师复核/申诉队列（非考试场景）。
- 15 维素养画像、多评分器异步管线（ai-math 困境四柱：Worker/轮询/灰度档/重放基础设施，全部不引入）。
- KG exposure 自动落证据行（评审②经复议否决，见 §1.4 决策 4）。
- 主动出题探测盲区（阶段 4）。
- 前后置连线的子图视图（v1 列表形态，见 §1.4 决策 1）。
- 掌握度分数数字（章头只有探索进度=覆盖度）。
- 「懂了/还不懂」按钮（等 P3-14 数据）。
