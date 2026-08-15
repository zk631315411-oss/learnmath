# LearnMath KG 工具调用设计

> 版本：v0.6（定向检索，已按本地 Neo4j 结构实现）  
> 日期：2026-08-14  
> 数据参照：本地 Neo4j v4.4 图谱（8,668 个节点，12,849 条关系）

## 1. 目标与边界

本工具负责把学生的自然语言问题定位到当前教材中的知识节点，并返回适合教学使用的定义、教材证据、关系和条件规则。它不修改图数据库，不负责更新学生画像，也不强制每轮问答查询 KG。

统一调用链：

```text
文字问题 / 截图
-> Kimi 判断是否需要教材知识
-> retrieve_kg_context(query, node_id?, focus?)
-> 教材范围内确定性召回与消歧
-> 按教学方向和稳定 node_id 展开有界上下文
-> Kimi 定位缺失知识并讲解
```

截图不走独立检索路径。Kimi 先读取图片，再把题目考查的概念、定理、公式、方法或题型组织成 `query`。

本次不做：

- 修改节点、关系、属性、索引或约束；
- 新增全文索引；
- 应用侧候选缓存；
- 页码到 `section_node_id` 的映射；
- 学习画像、苏格拉底状态机或自动出题。

## 2. 工具契约

工具名：`retrieve_kg_context`

模型可填写的参数只有：

| 参数 | 必填 | 用途 |
|---|---|---|
| `query` | 是 | 用于定位知识点的简洁数学查询；截图题由 Kimi 读图后生成 |
| `node_id` | 否 | 上次返回 `ambiguous` 后，从候选中选择稳定节点再次展开 |
| `focus` | 否 | 最多两个教学检索方向；省略时为 `["overview"]` |

`textbook_id` 和 `page_number` 由后端按当前问答上下文绑定，不暴露给模型修改。当前 `page_number` 只保留在返回范围和日志语义中，暂不伪装成章节定位。

`focus` 可选值：

| 值 | 查询内容 |
|---|---|
| `prerequisites` | 入向 `PREREQUISITE_OF`，即当前知识的明确前置 |
| `successors` | 出向 `PREREQUISITE_OF`，即明确依赖当前知识的后置 |
| `supporting` | 支撑当前知识理解、计算或证明的普通语义关系 |
| `applications` | 当前知识的应用与扩展，不混入严格后置 |
| `rules` | 直接或经 `HAS_PROPERTY` 获得的 RuleCase |
| `structure` | `SUPERIOR/PART_OF/EQUATIVE` 结构关系 |
| `overview` | 上述六个具体方向的有界概览 |

`focus` 至少一个、最多两个、不得重复；`overview` 只能单独使用。`ambiguous` 返回会保留 `requested_focus`，Kimi 使用 `node_id` 消歧时必须重复原方向。

工具注册描述明确告诉 Kimi 可以查询：

- 概念、定理、公式、方法和题型；
- 定义、说明与教材原文证据；
- 明确前置知识、支撑知识和应用扩展；
- 上下位、组成和同层并列结构；
- RuleCase 的适用对象、条件、结论及条件所需知识。

Kimi 按教学目的选择方向：

- “要先学什么”：`["prerequisites", "supporting"]`；
- “后面学什么”：`["successors", "applications"]`；
- “有什么用途”：`["applications"]`；
- “怎么判定、为什么成立”：`["rules"]`；
- “属于什么、由什么组成、相关概念”：`["structure"]`；
- 无法判断：`["overview"]`。

## 3. 候选召回与消歧

只在后端绑定的教材范围中匹配正式核心类型：

```text
Concept -> Theorem -> Formula -> Method -> ProblemClass
```

匹配顺序：

1. `exact_name`：节点名称等于查询；
2. `exact_alias`：任一别名等于查询；
3. `name_in_query`：学生问题包含节点名称；
4. `alias_in_query`：学生问题包含节点别名；
5. `query_in_name_or_alias`：节点名称或别名包含查询。

同一匹配类型内按固定类别顺序、名称长度、名称和 `node_id` 稳定排序。包含匹配要求被包含文本至少两个字符，避免单字符查询扩散。

候选只返回 `match_type`，不生成数值相关度。解析规则：

- 唯一精确名称或精确别名直接解析；
- 没有精确项但只有一个候选时直接解析；
- 多个精确项或多个非精确候选返回 `ambiguous`；
- Kimi 能结合题意判断时，用候选 `node_id` 再调用；否则询问学生；
- 没有候选返回 `not_found`。

因此“导数的几何意义”即使同时召回更宽泛的“导数”，仍由唯一精确名称直接解析；“矩阵的秩”不会再被长名称候选挤出。

## 4. 返回状态

### `resolved`

返回：

- `selected_node`：稳定 ID、名称、类型、别名、章节、来源、定义和教材证据；
- `relationships`：按教学用途分组的有向关系；
- `rule_cases`：仅在请求 `rules` 或 `overview` 时返回；
- `requested_focus`：Kimi 原始请求的方向；
- `retrieved_focus`：实际执行的具体方向，`overview` 会展开为六个方向；
- `empty_focus`：已执行但没有结果的方向，不包含未请求方向；
- `focus_stats`：各已执行方向的 `returned_count` 和 `truncated`；
- `limits`：本次查询使用的边界。

`kg_basis_available=true`，Kimi 可以依据这些材料定位知识缺口并教学。

### `ambiguous`

返回不带数值权重的候选列表。此时尚未提供某个节点的完整教学依据，Kimi 应选择 `node_id` 再查，不能把候选本身当作确定结论。

### `not_found`

`kg_basis_available=false`。Kimi 可以继续一般数学回答，但必须明确说明本轮没有 KG 依据。数据库连接、Cypher 或权限异常不会伪装成 `not_found`，而是作为工具执行错误进入现有运行时错误流程。

## 5. 关系语义

所有关系保留原关系类型、方向、说明、证据和置信度。`HAS_MEMBER` 与 `HAS_ANCHOR` 是导航关系，不进入数学教学上下文。

### `explicit_prerequisites`

- 入向 `PREREQUISITE_OF`：另一个节点是当前节点的明确前置知识。

### `explicit_successors`

- 出向 `PREREQUISITE_OF`：当前节点是另一个节点的明确前置知识。

严格后置单独返回，不归入普通应用扩展；严格前置为空时也不使用支撑关系冒充。

### `supporting_knowledge`

- 出向 `USES`：当前知识的理解、计算或证明需要目标节点；
- 入向 `DERIVES`：来源节点是推导当前知识的依据；
- 入向 `GETS`：来源方法、公式或定理可得到当前知识；
- 入向 `HAS_PROPERTY`：来源对象或主题具有当前性质。

### `applications_and_extensions`

- 入向 `USES`：其他知识会使用当前节点；
- 出向 `DERIVES`：当前节点可推导目标节点；
- 出向 `GETS`：当前方法、公式或定理可得到目标节点；
- 出向 `HAS_PROPERTY`：目标节点是当前对象或主题的性质；

### `structural_context`

- `SUPERIOR`：具体或下位类型指向一般或上位类型；
- `PART_OF`：组成部分指向整体；
- `EQUATIVE`：抽取模块定义的同层并列关系，不解释为数学等价。

## 6. RuleCase 展开

只支持两条明确路径：

```text
selected -[:HAS_RULE_CASE]-> RuleCase

selected -[:HAS_PROPERTY]-> theorem_or_property
         -[:HAS_RULE_CASE]-> RuleCase
```

对已选中的 RuleCase，再展开：

```text
RuleCase -[:HAS_CONDITION*]-> ConditionExpression
ConditionExpression -[:REFERS_TO]-> required KGNode
RuleCase -[:HAS_OUTCOME*]-> Outcome
```

这里的 `*` 表示允许的关系名集合，不是无界路径：条件只允许 `HAS_CONDITION`、`HAS_CONDITION_AND`、`HAS_CONDITION_OR`，结论同理。`REFERS_TO` 只在已返回规则的条件节点内展开，不作为普通邻居查询，从而避免大量无关入向关系进入上下文。

## 7. 查询边界

核心节点、定义和一段教材证据不受方向选择影响，始终返回。关系和规则按方向查询，未请求方向既不执行也不返回空数组。每组先取“可见上限 + 1”，多出的最后一项只用于设置 `truncated=true`，不会进入模型上下文，也不额外执行总数统计。

当前实现限制：

| 内容 | 上限 |
|---|---:|
| 候选节点 | 12 |
| 定向关系或 RuleCase | 每个请求方向 15 |
| `overview` 关系或 RuleCase | 每个具体方向 5 |
| RuleCase 条件/结论明细行 | 每类 80 |
| 单段主要教材证据 | 1,600 字符 |

所有 Cypher 都是参数化只读查询，只使用 `MATCH`、`OPTIONAL MATCH`、`CALL`、`WITH`、`RETURN`、`ORDER BY` 和 `LIMIT`。不执行 `CREATE`、`MERGE`、`SET`、`DELETE`、`DROP` 或 Schema 操作。

模型收到定向且有界的教材上下文；前端和历史中的 `tool_activities` 只保存精简展示结果、请求方向、空方向和截断状态，避免重复持久化大段教材原文。

## 8. Agent 运行时

生产问答继续由文字和截图共用同一个多模态 `ToolRuntime`：

```text
max_model_rounds = 5
max_total_calls = 3
retrieve_kg_context.max_calls_per_turn = 3
```

五轮是最多五次仍允许自主选择工具的模型调用。若模型仍未收尾，运行时保留现有 `tool_choice="none"` 强制收尾，因此极端情况下会再有一次模型请求。现有重复调用去重、单工具上限、超时、连续失败和强制收尾逻辑不变。

## 9. 本地验证基线

本地 Neo4j 的只读回归基线：

| 查询 | 期望 |
|---|---|
| 为什么线性无关要求所有系数为0 | 定位“线性无关”，取得定义证据，并经 `HAS_PROPERTY` 展开 RuleCase |
| 线性无关性 | 通过包含匹配定位“线性无关” |
| 导数的几何意义 | 唯一精确名称优先于宽泛“导数” |
| 矩阵的秩 | 唯一精确名称稳定排在首位并直接解析 |

当前本地实测四例均为 `resolved`；“线性无关”展开 9 条 RuleCase。Aura 在替换为同一图数据后只需运行同一组回归与结果一致性检查，无需新增索引。

定向回归中，“线性无关”的 `rules` 返回 9 条，`applications` 返回 8 条，严格 `prerequisites` 为空并进入 `empty_focus`；`overview` 的应用和规则各返回 5 条且标记 `truncated=true`。这些结果反映当前图数据，不通过修改图谱补齐。

## 10. 验收条件

- 文字和截图都注册同一个 `retrieve_kg_context`；
- 截图由 Kimi 读图形成查询，不进入独立视觉直答链路；
- 精确节点不被长名称候选挤出；
- 真实多候选可通过第二次 `node_id` 调用解析；
- `focus` 默认、枚举、去重、数量和 `overview` 互斥规则生效；
- 未请求方向不查询、不返回，空方向和截断状态可被模型及前端识别；
- 明确前置、明确后置、支撑知识和应用扩展互不冒充；
- 所有关系按实际方向归类并保留证据；
- `EQUATIVE` 在工具描述、返回含义和前端语义中均为同层并列；
- 概念可经 `HAS_PROPERTY` 展开定理的 RuleCase；
- 普通邻居查询不包含 `REFERS_TO`；
- 技术错误不被吞掉或伪装成未命中；
- 前端仍消费原有 `thinking`、`content`、`tool_call`、`tool_result`、`done` 和 `error` SSE 事件。
