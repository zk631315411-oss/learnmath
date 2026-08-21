# 第三阶段：学生学习建模设计稿

> 项目：学数有道（LearnMath）
> 日期：2026-08-21
> 状态：待选择方案，尚未进入实现
> 目标：依据 KG 节点和学习证据建立可解释、可重放、能辅助教学的学生模型

## 0. 摘要

第三阶段不等于给 `user_profiles` 增加更多字段，也不把大模型的一次判断直接写成“学生画像”。本阶段应建立三层边界：

```text
不可变证据事实
  -> 节点级模型估计（带不确定性和来源）
  -> 有边界的教学动作与学生可见解释
```

当前推荐方案是 **方案 A：可解释的节点级贝叶斯/遗忘模型 + KG 前置风险 + Open Learner Model**。它可以使用当前 `evidence_turns`，不要求先有完整题库，能够回放和人工审计。方案 B、C 作为后续离线对照和演进路线，不应在当前数据规模上直接替代生产基线。

本稿等待的不是“要不要做画像”，而是选择第一版模型的复杂度和验收范围。选择方案后，另立实施计划和数据库迁移计划。

## 1. 当前基础与问题

### 1.1 已有数据

当前系统已经拥有：

- `evidence_turns`：`user_id`、`chat_id`、`qa_turn_id`、`node_id`、`textbook_id`、`scaffolding_level`、`outcome`、`source`、`report_path`、`model_version`、`created_at`；
- `project_status()`：把节点证据投影成 `unexplored / learning / basically_mastered / mastered / needs_review`；
- KG：节点、教材、章节、section、`PREREQUISITE_OF` 及其他关系；
- 静态教材目录和用户稀疏学习进度；
- 统一问答链路和内部 `report_turn_outcome` 证据分叉。

### 1.2 关键缺口

1. `project_status()` 是地图展示状态，不是经过校准的知识掌握概率。
2. 自由问答的 `independent / assisted / direct_taught / unresolved` 不是标准题目答对/答错标签，不能未经验证直接喂给 BKT、IRT 或深度知识追踪模型。
3. 当前没有稳定的题目—知识点 Q 矩阵、题目难度和连续答题序列，因此不能假设已有条件足以训练 NCDM、Deep-IRT 或 GRKT。
4. 当前 `user_profiles` 的 `weak_points`、`strong_points`、`learning_preferences` 是认证兼容字段，不具备生成规则、来源、置信度和版本语义。
5. KG 的邻接关系适合约束候选和复习顺序，不能因为某个前置节点薄弱就自动判定后置节点薄弱。

## 2. 研究流程与依据

### 2.1 本轮研究问题

本阶段先回答四个问题，再决定模型复杂度：

1. 当前自由问答证据能否支持节点级学习估计，哪些字段必须保留原始来源？
2. 在稀疏、非标准答题数据下，BKT、认知诊断和深度知识追踪分别需要什么前置条件？
3. KG 的先修关系应该影响什么：学生状态、候选范围、复习顺序，还是教学解释？
4. 怎样把“KG 参与了流程”与“KG 带来了更好的定位或学习结果”区分开？

### 2.2 执行过的研究流程

| 步骤 | 执行内容 | 产出 |
|---|---|---|
| R1 代码基线 | 阅读 `evidence_db.py`、`projection.py`、`progress.py`、`user_profile_db.py`、QA/evidence 路由和 schemas | 确认 evidence 是事实账本，地图投影不是 mastery，画像兼容字段没有生成契约 |
| R2 论文机制核查 | 对照 BKT、DKT、DKVMN、SAKT、AKT、Deep-IRT、NCDM、Prerequisite-Driven DKT、GKT/GIKT/GRKT、Dynamic LENS、Open Learner Model | 按数据需求、可解释性、时间/图结构和不确定性归纳适配边界 |
| R3 GitHub 契约核查 | 阅读项目 README、入口代码、输入输出格式、许可证、依赖和近期维护迹象；不把 benchmark 分数当产品证据 | 形成 §2.4 的复用/隔离清单 |
| R4 适配矩阵 | 用当前 `evidence_turns`、KG 边界、题库/Q 矩阵缺口逐项对照 | 排除当前直接训练深度 KT 的假设，保留 A/B/C 三条路线 |
| R5 研究设计 | 为 KG 开启/关闭、模型校准、人工标注和未来事件预测分别定义指标 | 形成 §7.1 的对照实验协议和 §9 的验收门槛 |

研究结论不是“某论文分数最高”，而是：**当前先建立可重放的证据—节点状态基线，再用统一时间切分和 KG 消融实验验证是否值得增加模型复杂度。**

### 2.3 论文机制与 LearnMath 取舍

| 来源 | 核心机制 | 对 LearnMath 的结论 |
|---|---|---|
| Corbett & Anderson, BKT（1995）[DOI](https://doi.org/10.1007/BF01099821) | 每个知识点用潜在掌握状态和 `P(L0/T/G/S)` 在线更新 | 适合作为小数据、可审计的节点级基线；不能假定知识点独立且只能有二元掌握 |
| Piech et al., DKT（2015）[arXiv](https://arxiv.org/abs/1506.05908) | RNN 从交互序列预测下一次答题 | 可做离线预测基线；隐藏状态不可直接作为学生可见画像或教学依据 |
| Zhang et al., DKVMN（2017）[arXiv](https://arxiv.org/abs/1611.08108) | 静态 key 表示概念，动态 value 表示概念掌握度 | 阶段 4 形成题目日志后可借鉴；当前缺少 Q 矩阵和规范题目序列 |
| Pandey & Karypis, SAKT（2019）[arXiv](https://arxiv.org/abs/1907.06837) | 自注意力选择与当前知识点相关的历史交互 | 可用于离线相关证据排序；注意力权重不能直接解释为因果依据 |
| Ghosh et al., AKT（2020）[arXiv](https://arxiv.org/abs/2007.12324) | 单调注意力、时间衰减和 Rasch 正则化 | 借鉴遗忘/时间衰减；第一版用规则或 BKT，不直接照搬复杂模型 |
| Su et al., Deep-IRT（2018）[arXiv](https://arxiv.org/abs/1904.11738) | 动态学生能力和题目难度的 IRT 组合 | 依赖固定题目难度，适合阶段 4 题库成熟后使用 |
| Wang et al., Neural Cognitive Diagnosis（2020）[arXiv](https://arxiv.org/abs/1908.08733)；[EduCDM](https://github.com/bigdata-ustc/EduCDM) | 带单调约束的学生—题目—知识点交互 | 适合响应矩阵形成后的离线比较；不适合当前自由聊天冷启动 |
| Prerequisite-Driven DKT（2018）[DOI](https://doi.org/10.1109/ICDM.2018.00019) | 将前置结构纳入知识追踪 | 先修图应约束状态解释和推荐候选，不应替代学生证据 |
| GKT（2019）[DOI](https://doi.org/10.1145/3350546.3352513)；[代码](https://github.com/jhljx/GKT) | GNN 在知识点图上建模熟练度传播 | 说明 KG 时序模型可行，但需要大量规范交互和稳定图 |
| GIKT（2020）[arXiv](https://arxiv.org/abs/2009.05991)；[代码](https://github.com/ApexEDM/GIKT) | 题目、知识点及历史交互的图结构建模 | 可作为后续图模型参照，不应把论文 AUC 当作教学收益证明 |
| GRKT（2024）[arXiv](https://arxiv.org/abs/2406.12896)；[代码](https://github.com/JJCui96/GRKT) | 通过概念图区分检索、强化、学习和遗忘 | 最贴合当前 KG，但图传播会放大错误，先做离线实验和限幅传播 |
| Dynamic LENS（2024）[arXiv](https://arxiv.org/abs/2407.17427) | 带 epistemic uncertainty 的动态潜状态 | 无论采用何种模型，画像都必须同时输出估计、不确定性和观测依据 |
| Bull & Kay, Open Learner Model（2018）[arXiv](https://arxiv.org/abs/1807.00154) | 让学生检查、纠正和反思系统的学习模型 | 学生看到的应是证据、估计、更新时间和待验证项，而不是绝对能力标签 |
| pyBKT（[CAHLR/pyBKT](https://github.com/CAHLR/pyBKT)）、pyKT（[pykt-toolkit](https://github.com/pykt-team/pykt-toolkit)） | 可复现 BKT/KT 基线 | 用于离线复现和模型对拍，不把开源 benchmark 分数直接当产品验收 |

研究共识：**事实账本、模型估计、教学动作必须分离**；模型可以重放，事实不能被模型覆盖；KG 可以限制推理范围，但不能凭邻居关系自动制造掌握证据。

### 2.4 GitHub 项目核查与复用边界

本轮核查重点是官方 README/代码契约，而不是复制实现。许可证和维护状态是“能否作为依赖”的判断条件；模型机制可借鉴，不代表整个仓库适合放入 LearnMath 运行时。

| 项目 | 许可证/维护观察 | 输入/输出契约 | LearnMath 处理 |
|---|---|---|---|
| [CAHLR/pyBKT](https://github.com/CAHLR/pyBKT) | MIT；近期仍有代码更新；Windows 可用纯 Python | `user_id/skill/correct` 表格；输出预测和状态序列 | 只借鉴 BKT 参数和 `partial_fit` 思路；先经过 outcome adapter，不直接接收自然语言 evidence |
| [bigdata-ustc/EduCDM](https://github.com/bigdata-ustc/EduCDM) | Apache-2.0；代码更新较慢 | 交互日志 + item-to-KC Q 矩阵；输出学生/题目/知识点参数 | 阶段 4 题库形成后做 NCDM/IRT 离线基线，不嵌入在线请求 |
| [HFUT-LEC/EduStudio](https://github.com/HFUT-LEC/EduStudio) | MIT；批量实验框架，依赖 PyTorch | `rawdata → middata → cachedata`，含 interaction/Q-matrix 和解释评估 | 借鉴数据标准化、配置、训练、评估分层；独立实验环境，不放桌面生产容器 |
| [bigdata-ustc/EduKTM](https://github.com/bigdata-ustc/EduKTM) | Apache-2.0；模型集合维护偏旧 | DKT/DKVMN/GKT/AKT 等模型各有 ETL | 作为论文复现实验参考，不作为生产依赖 |
| [pykt-team/pykt-toolkit](https://github.com/pykt-team/pykt-toolkit) | MIT；常用 benchmark 工具，偏 GPU/Conda | 序列预处理、Q-matrix、多题 KC fusion、时间/学生切分 | 借鉴无 KG/KG 对照和防 label leakage 的评估协议 |
| [jhljx/GKT](https://github.com/jhljx/GKT) | MIT；PyTorch 旧版本依赖 | `user_id/skill_id/correct` 序列 + 概念图 | 借鉴图邻居传播，离线 ablation；不直接部署 |
| [ApexEDM/GIKT](https://github.com/ApexEDM/GIKT) | 未发现明确许可证；TensorFlow 1.x 依赖 | question/skill/answer + 邻居采样 | 只借鉴高阶邻居聚合；许可证和依赖不满足生产引入条件 |
| [JJCui96/GRKT](https://github.com/JJCui96/GRKT) | 研究代码；依赖和数据要求较高 | 概念图 + 交互序列；区分检索、强化、学习和遗忘 | 作为 KG 时序研究候选；图传播必须限幅、可回放 |
| [jdxyw/deepKT](https://github.com/jdxyw/deepKT) | MIT；小型旧版 PyTorch 项目 | question id 序列 + 二值结果；输出下一题预测 | 可做最小无 KG DKT/SAKT baseline；不负责解释性画像 |
| [PengLinzhi/DyGKT](https://github.com/PengLinzhi/DyGKT) | 未发现明确许可证；研究代码 | 带时间戳的学生—题目动态图边 | 只有题目事件规模足够后再评估；当前不引入 |

共同限制：这些项目通常假设二值 `correct`、稳定题目 ID、长序列和 Q 矩阵；当前 `independent / assisted / direct_taught / unresolved` 不能直接替换成 `0/1`。因此开源项目用于**方法对照和数据协议借鉴**，生产层保留 LearnMath 自己的 evidence provenance、模型版本和回退逻辑。

## 3. 设计目标与非目标

### 3.1 目标

1. 对每个教材 KG 节点给出可重放的学习估计和不确定性。
2. 保留估计所依据的证据行、模型版本和时间窗口。
3. 能解释“为什么建议复习这个节点/先学哪个前置”。
4. 支持匿名用户转正式用户、删除提问记录后证据仍可追溯的现有语义。
5. 为阶段 4 的选题提供稳定输入，但不在本阶段生成题目。
6. 允许学生指出模型“不准确”，但不允许直接改写原始证据。

### 3.2 非目标

- 不把单次 LLM 自评等同于正式掌握；
- 不生成“智力、学习能力、学习风格、人格”等敏感或不可验证标签；
- 不用深度模型直接写入 `evidence_turns`；
- 不因 KG 前置节点状态自动改变后置节点 mastery；
- 不在没有题库和人工标注前训练生产级 DKT/DKVMN/GRKT；
- 不把画像字段直接显示成“你差/你已经完全掌握”的固定结论；
- 不把学习模型用于考试、防作弊或高风险决策。

## 4. 统一数据契约（所有方案都必须遵守）

### 4.1 三层数据

```text
evidence_turns（事实层，只追加）
  -> learner_node_estimates（估计层，可按 model_version 重放）
  -> learner_action_context（动作层，按场景实时生成）
```

#### A. 事实层：现有 `evidence_turns`

不改写历史 outcome。新增字段只有在证明数据治理需要时才考虑，例如人工标注关联 ID；模型重算不得覆盖 `source=agent_self_report` 的原始行。

#### B. 估计层：建议新增 `learner_node_estimates`

每个 `(user_id, textbook_id, node_id, model_version)` 一行当前估计，至少包括：

| 字段 | 含义 |
|---|---|
| `estimate` | 0–1 的模型估计；不是考试分数 |
| `uncertainty` | 0–1 的不确定性，证据少时不能伪装成确定 |
| `state` | `unknown / emerging / likely_ready / needs_review` 等对外中性状态 |
| `evidence_count` | 全部证据行数 |
| `closed_evidence_count` | `independent/assisted/direct_taught` 行数 |
| `independent_count` | 独立表现次数 |
| `assisted_count` | 在提示/脚手架下表现次数 |
| `direct_taught_count` | 需要直接讲授的次数 |
| `unresolved_count` | 未闭合次数 |
| `last_observed_at` | 最近一次有效观测时间 |
| `last_closed_at` | 最近一次闭合观测时间 |
| `decay_risk` | 由时间衰减和最近独立表现计算的复习风险 |
| `prerequisite_risk` | 前置知识风险，只用于解释/排序，不改本节点估计 |
| `supporting_evidence_refs` | 支持估计的 `evidence_turns.id` 列表，限制长度 |
| `contradicting_evidence_refs` | 造成不确定或冲突的证据 ID 列表，限制长度 |
| `model_version` | 估计算法和参数版本 |
| `computed_at` | 估计生成时间 |
| `stale` | 估计是否落后于最新 evidence |

第一版不把所有字段都暴露给学生；内部字段和学生文案必须分离。

#### C. 动作层：不长期存储的上下文

给 Agent 或前端的上下文按当前场景生成，最多包含目标节点及有界前置节点：

```json
{
  "node_id": "gaodai_shang:...",
  "estimate": 0.62,
  "uncertainty": 0.28,
  "state": "emerging",
  "reason_refs": ["evidence-id-1", "evidence-id-2"],
  "prerequisite_risk": 0.74,
  "recommended_action": "check_prerequisite",
  "action_expires_at": "2026-08-28T00:00:00Z"
}
```

### 4.2 用户级摘要

用户级摘要必须从节点估计实时或按版本聚合，不采用手工维护的“强项/弱项数组”作为唯一事实。第一版建议只派生以下字段：

- `active_textbook_id`：当前会话上下文，不是能力属性；
- `coverage_ratio`：有证据节点数 / 教材节点数；
- `review_frontier`：需要巩固且存在可解释来源的节点，最多 10 个；
- `prerequisite_bottlenecks`：阻塞多个后置节点的前置节点，最多 10 个；
- `recent_learning_nodes`：最近有活动的节点，最多 10 个；
- `uncertain_nodes`：证据不足或冲突最大的节点，最多 10 个；
- `explicit_preferences`：只有学生主动声明并确认的偏好，不由模型从一次对话猜测。

不输出“学生是视觉型/听觉型”“学习能力差”等人格化标签。

## 5. 证据到模型的适配规则

### 5.1 不直接把四值 outcome 当二元答题标签

当前四值的语义不同：

| outcome | 能说明什么 | 不能说明什么 |
|---|---|---|
| `independent` | 学生在当前上下文中给出独立可识别表现 | 不能证明长期稳定掌握 |
| `assisted` | 学生在提示/脚手架下完成或复述 | 不能等同于独立答对 |
| `direct_taught` | 教学介入发生，或学生在讲授后被识别为已理解 | 不能单独证明学生掌握 |
| `unresolved` | 本轮没有形成可闭合证据 | 不能解释为一定不会 |

因此建立独立的 `evidence_adapter`，把原始 outcome 映射成模型观测时必须带：

- `adapter_version`；
- 映射原因；
- 置信度；
- 是否需要人工复核；
- 是否只影响 `review_risk` 而不更新 `mastery_estimate`。

在没有人工标注前，默认采取保守策略：`independent` 才提供强正向信号，`assisted` 提供弱正向信号，`direct_taught` 和 `unresolved` 不直接增加 mastery，而增加不确定性/复习风险。具体权重必须由离线校准确定，不能把下面的数字写死成教育事实。

### 5.2 时间衰减

时间只降低“最近可用性”或提高复习风险，不删除历史证据。第一版可用可配置半衰期：

```text
recency_factor = exp(-ln(2) * days_since_last_closed / half_life_days)
decay_risk = 1 - recency_factor * independent_signal
```

公式是工程近似，不是遗忘曲线的科学证明；参数必须记录在 `model_version` 中并可重放。

### 5.3 KG 先修约束

只读取有明确 `PREREQUISITE_OF` 的有界直接前置。建议：

```text
prerequisite_risk(node) = aggregate((1 - estimate(prerequisite)) * relation_weight)
```

风险只用于：

- 给 Agent 提示“先检查哪个前置”；
- 给地图显示“可能受阻”；
- 给阶段 4 生成候选复习路径。

它不直接修改后置节点的 `estimate`，也不把普通 supporting/application 关系当成前置。

## 6. 三个候选方案

### 方案 A：可解释节点模型（推荐首发）

#### 架构

```text
evidence_turns
  -> outcome adapter（版本化、保守映射）
  -> 节点级 Beta/BKT + 时间衰减
  -> KG 直接前置风险
  -> Open Learner Model 展示和教学动作
```

可以用 BKT 的参数化形式实现在线更新，也可以先用 Beta 后验做更贴合四值证据的原型。两者都必须保存参数版本、观测映射和证据引用。

#### 生产字段

- `estimate`、`uncertainty`、`state`；
- `evidence_count`、四类 outcome 计数；
- 最近独立/闭合时间、`decay_risk`；
- 前置风险、支持/冲突证据引用；
- 模型版本和是否过期。

#### 教学使用

| 条件 | 动作 |
|---|---|
| `estimate` 低且前置风险高 | 先检查最高风险的直接前置 |
| `estimate` 中等且不确定性高 | 提一个最小可观察问题，不宣布掌握状态 |
| `estimate` 较高但近期衰减风险高 | 给一个短迁移/复习检查 |
| `independent` 证据不足 2 条 | 不显示“已掌握”，只显示“已有独立表现，仍待验证” |
| evidence 过期或模型 stale | 回退到阶段 2 地图状态和最近证据 |

#### 优点

- 使用当前数据即可开始；
- 解释、重放、回退和人工审核成本最低；
- 与现有 `evidence_turns`、KG 和学习地图改动最小；
- 容易做学生可见的证据解释；
- 可作为 B/C 的冷启动和安全回退层。

#### 缺点

- 对复杂部分掌握和多知识点交互表达有限；
- outcome 到模型观测的映射需要人工校准；
- 预测精度上限可能低于深度模型；
- 不能仅凭它证明 KG 的教学效果。

#### 适用判断

适合当前阶段，建议作为**唯一首发生产方案**。

### 方案 B：认知诊断与题目能力模型

#### 架构

```text
题目/练习响应 + Q 矩阵 + KG
  -> BKT/DKVMN/NCDM/Deep-IRT
  -> 节点 proficiency + 学生能力 theta + 题目难度
  -> 选题/复习动作
```

自由问答证据作为旁路解释和冷启动来源，不直接与标准题目响应混为一张训练表。

#### 优点

- 能同时解释学生能力、知识点和题目难度；
- 与阶段 4 自动选题天然衔接；
- 可用 AUC、Brier、ECE、题目后验等标准指标进行离线比较；
- 比单纯规则更能表达多知识点题目。

#### 缺点

- 必须先建立题库、Q 矩阵、题目难度和稳定答题日志；
- 冷启动和稀疏用户表现不稳定；
- 需要处理题目泄漏、练习顺序和不同教材 ID 的迁移；
- 训练模型的指标仍不等于真实学习收益；
- 工程量和数据治理成本中等偏高。

#### 启动条件

- 至少一套版本化题库和人工审核答案；
- 每题关联 1–5 个 KG 节点且 Q 矩阵可审计；
- 有足够的用户—题目—结果序列；
- 方案 A 已运行并作为冷启动/回退模型。

#### 适用判断

适合阶段 3 后半段或阶段 4 前置，不适合现在直接作为第一版画像。

### 方案 C：KG 时序图模型与不确定性层

#### 架构

```text
连续交互序列 + KG 先修/关系图
  -> GRKT/GKT/AKT 风格时序图模型
  -> 节点潜状态 + 图结构风险传播 + uncertainty head
  -> 受限教学策略
```

模型可以学习先修、强化、学习和遗忘之间的复杂关系，但生产层仍需保留方案 A 的证据和阈值保护。

#### 优点

- 最充分利用 LearnMath 的 KG 核心差异；
- 可以表达跨节点、先修和长期序列关系；
- 个性化和预测上限最高；
- 适合研究“KG 是否带来额外预测/教学收益”。

#### 缺点

- 需要规模更大的高质量时序数据；
- 图谱错误会导致状态传播和系统性误判；
- 模型解释难，GNN 的邻居影响不能直接当教学证据；
- 训练、回放、版本、漂移和线上延迟成本最高；
- 学术 benchmark 的提升不等于学生真实学习改善。

#### 安全约束

- 图传播只改变候选优先级和不确定性，不直接写入 evidence；
- 传播深度、权重和时间窗有硬上限；
- 任何高风险动作都要回退到可解释模型；
- 先离线对比方案 A，不能直接替换生产估计。

#### 适用判断

适合作为研究线和 KG 价值验证线，不适合作为当前阶段唯一产品方案。

## 7. 三方案对比与建议

| 维度 | A：可解释节点模型 | B：认知诊断/题目模型 | C：KG 时序图模型 |
|---|---:|---:|---:|
| 当前数据可用性 | 高 | 低 | 低 |
| 可解释性 | 高 | 中高 | 中低 |
| 对 KG 的利用深度 | 中 | 中 | 高 |
| 工程复杂度 | 低 | 中 | 高 |
| 冷启动能力 | 高 | 低 | 低 |
| 阶段 4 衔接 | 中 | 高 | 高 |
| 错误传播风险 | 低 | 中 | 高 |
| 适合作为首发生产 | **是** | 否 | 否 |
| 适合作为研究对照 | 是 | 是 | **是** |

建议采用分层路线，而不是三选一后永久锁死：

1. **现在选择 A**：实现生产可解释基线和学生可见 OLM。
2. **数据积累后评估 B**：题库和 Q 矩阵稳定后进行认知诊断对照。
3. **研究线评估 C**：用消融实验回答“KG 结构是否带来额外收益”，通过后保留 A 作为回退。

### 7.1 KG 增益对照实验（第三阶段必须保留的研究线）

功能上调用了 KG，只能证明“KG 参与了流程”；要证明 KG 有用，必须让 KG 成为可关闭的实验变量。建议预注册以下假设：

- **H1 定位增益**：开启 KG 后，目标知识点 Top-1/Top-3 定位准确率提高；
- **H2 教学增益**：开启 KG 后，前置建议的人工相关性和针对性提高；
- **H3 学习增益**：在同等问题难度和模型预算下，学生后续独立表现或短迁移表现提高。

#### 实验条件

| 条件 | 对模型可见内容 | 用途 |
|---|---|---|
| G0 无 KG | 原始问题和对话历史；隐藏教材节点和关系 | 无 KG 基线 |
| G1 KG 定位 | G0 + `retrieve_kg_context` 的目标节点、边界内前置/后置和证据 | 区分 KG 定位价值 |
| G2 KG + 学习模型 | G1 + 方案 A 的目标节点估计、置信度和有界前置风险 | 区分“KG 结构”与“学生模型动作”叠加价值 |
| G3 图模型（离线） | G1 的静态图 + 方案 C 的时序状态 | 只用于研究，不进入首发生产 |

G0/G1/G2 必须固定同一模型供应商、模型版本、温度、最大轮数、工具预算和回答界面；只改变允许读取的上下文。G3 使用同一时间切分和相同输入事件，不能用更有利的数据切分制造增益。

#### 数据和标注

1. 先从真实问答中抽取 100–200 轮做 pilot，人工标注目标节点、前置相关性、学生表现是否独立、证据是否闭合和短迁移结果；数量只是启动门槛，正式样本量根据 pilot 方差做功效分析。
2. 按用户和时间切分，未来轮次只能使用切分点之前的 evidence；同一轮教师回答、thinking 和最终闭合标签不能泄漏给预测输入。
3. 对 G0/G1/G2 使用成对问题或分层随机分配，控制教材、章节、问题类型、是否带图片和学生历史长度；报告缺失和退出，不只报告完成样本。

#### 指标

| 目标 | 指标 |
|---|---|
| 定位 | target-node Hit@1/Hit@3、章节/section 命中率、人工定位准确率 |
| 前置 | prerequisite precision/recall、建议动作针对性评分、无前置时误报率 |
| 估计 | Brier、log loss、ECE/校准曲线、置信区间覆盖率、冷启动和稀疏用户分层结果 |
| 学习 | 后续独立表现率、短迁移正确率、闭合 evidence 时间/轮数、重复泛化提问率 |
| 体验 | 学生对“建议是否有帮助”的盲评、回答延迟、失败回退率 |

结果使用配对 bootstrap 或按学生/问题的混合效应模型报告 95% 置信区间。AUC 单独提高不能宣布 KG 有教学收益；如果只有 H1 成立，只能宣称“KG 改善定位”，不能宣称“KG 让学生学得更好”。

#### 项目决策门槛

以下是本项目的预先约定目标，不是论文中的普适教育结论：

- H1：G1 相对 G0 的目标节点 Hit@1 至少提高 10 个百分点，且人工定位准确率的置信区间不跨 0；
- H2：前置建议 precision 不低于 G0，并在有明确前置的样本上提高至少 10 个百分点；
- H3：G2 相对 G1 的后续独立/迁移表现提高，且 95% 置信区间不跨 0；延迟增加超过 20% 时必须提供缓存或降级方案；
- 任一条件出现系统性错误传播、隐私越界或高不确定性误报，立即回退到 G1/A 的可解释路径。

只有 H1、H2、H3 的证据分别达到门槛，才可以在项目宣传中区分“KG 定位有用”“KG 教学有用”和“KG 学习收益有证据”。

## 8. 方案 A 的实施草案

### 8.1 P0：证据适配与离线回放

1. 建立 100–200 条真实问答轮次的人工标注集：节点是否定位正确、学生是否独立表现、提示依赖程度、证据是否闭合。
2. 计算 Agent 自评与人工标注的一致性：按 outcome 分层报告 precision/recall、Cohen's kappa 或 Krippendorff's alpha。
3. 实现 `evidence_adapter`，所有映射带 `adapter_version`，不能修改原证据。
4. 建立纯函数 replay：同一 evidence 输入和同一 model_version 必须得到相同 estimate。

### 8.2 P1：估计层与版本化存储

建议新增：

- `learner_node_estimates`：当前节点估计；
- `learner_model_runs`：每次重放的版本、输入 revision、参数摘要、开始/结束时间、失败信息；
- `learner_model_feedback`：学生/人工对估计的“不准确”反馈，不直接改 evidence。

写入规则：先追加 evidence，再在同一用户/教材 revision 上重算受影响节点；模型失败不阻断回答，标记 estimate stale 并保留旧估计。

### 8.3 P2：读取接口和 Agent 上下文

建议接口：

```text
GET /api/learner-model?textbook_id=...
GET /api/learner-model/nodes/{node_id}?textbook_id=...
POST /api/learner-model/feedback
```

内部工具建议为 `retrieve_learner_model_context(node_ids, textbook_id)`，只返回目标节点和有界直接前置的紧凑上下文，不把全量画像塞进 Prompt。

初版教学动作只允许：

- `check_prerequisite`：先检查一个前置；
- `ask_minimal_probe`：提出一个可观察问题；
- `review_with_variation`：给一个短变式/迁移检查；
- `defer_and_collect_evidence`：证据不足，不做强结论。

禁止模型直接调用“修改画像”工具；画像由后端根据证据重放产生。

### 8.4 P3：前端呈现

节点详情分成三层：

1. **证据事实**：最近活动、独立/提示/讲授/未闭合次数；
2. **系统估计**：当前状态、置信等级、更新时间；
3. **下一步**：建议复习哪个前置或做哪个验证动作。

默认文案使用“已有证据 / 仍需验证 / 建议复习”，不直接显示“你能力差”。学生可以点击“这条判断不准确”，反馈进入 `learner_model_feedback`。

### 8.5 方案 B/C 的离线实现边界

方案 B、C 不是首发生产接口，但要从第一天按可复用的实验协议留出输入和输出：

**B：认知诊断/题目模型实验包**

1. 建立版本化题库：`item_id`、题面、答案、难度、人工审核状态、关联 KG 节点和 Q 矩阵版本。
2. 将标准作答转换为 canonical interaction：`user_id`、`item_id`、`node_ids`、`response`、`timestamp`；自由问答 evidence 作为单独的冷启动数据集，不混入 `correct`。
3. 在 EduCDM/EduStudio/pyKT 的独立环境比较 BKT、NCDM、Deep-IRT/DKVMN；按未来事件切分，输出 `p_next_correct`、节点 proficiency、校准指标和模型版本。
4. 研究输出只能写入实验产物，不能覆盖 `evidence_turns` 或直接改变生产学生可见状态；达到数据量、校准和冷启动门槛后，才评估是否作为方案 A 的 shadow model。

**C：KG 时序图模型实验包**

1. 从指定 `catalog_version` 导出静态节点和关系快照，只允许审核通过的关系进入训练图；记录图版本、边类型和传播深度。
2. 至少做三组消融：无 KG、仅 `PREREQUISITE_OF`、完整允许关系；所有组使用同一用户/时间切分和相同序列。
3. 以 GKT/GRKT/AKT 风格模型预测未来可验证表现，同时输出不确定性、邻居影响和错误传播审计，不把 attention/GNN 权重当成解释事实。
4. 先以离线/影子模式运行，若图质量、校准和 H1–H3 指标不优于 A/G1，就保持 A 为生产回退，不升级图模型。

## 9. 验收指标与门槛

### 9.1 数据与回放

- 同一 evidence fixture 重放结果稳定；
- 任一估计都能找到来源 evidence 和 `model_version`；
- evidence 删除策略与既有产品语义一致；
- 模型失败不影响 SSE 问答和地图基本读取；
- 并发重试不重复生成 revision 或重复反馈。

### 9.2 质量与校准

- Agent 自评与人工标注按 outcome 分层报告，不只报告总体准确率；
- 报告 calibration curve、Brier/ECE 或等价校准指标；
- 单次证据不能直接达到“已掌握”；
- 高不确定性节点不能触发强结论或高风险动作；
- 前置风险不会篡改后置节点 mastery。

### 9.3 教学动作

- 每个动作都能追溯到目标节点、模型版本和证据引用；
- Agent 收到模型上下文后仍遵守阶段 1 的教学规则；
- 模型服务不可用时回退到阶段 2 `project_status` 和原始 KG；
- 采样人工复核动作是否真的围绕缺失前置，而不是泛化讲解。

### 9.4 产品与隐私

- 学生可见结论带时间和不确定性；
- 学生反馈不会删除或篡改原始证据；
- 用户删除学习痕迹的语义单独定义，不能隐式实现；
- 不生成敏感人格化画像字段；
- 跨教材隔离和匿名转正式用户迁移通过。

## 10. 必须由人选择的事项

请在下面三项中先选择一个**首发方向**：

1. **A：可解释节点模型（推荐）**：最快形成可验收产品，先解决证据可靠性和可解释教学动作。
2. **B：认知诊断/题目模型**：提前为阶段 4 投入题库和 Q 矩阵建设，接受当前无法立即训练的事实。
3. **C：KG 时序图模型**：优先做研究型 KG 增益验证，接受数据、解释和工程成本。

我的建议是选择 A，并把 B/C 明确放入离线研究路线；只有当 A 的人工一致性、校准和动作收益达到门槛后，才允许模型复杂度升级。
