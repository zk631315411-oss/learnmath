# LearnMath 文档索引

> 最后更新：2026-08-25
> 本文件是第 5 类“文档索引、状态说明、阅读顺序”的唯一入口。当前项目状态以
> [项目路线图](04-project-map/PROJECT_ROADMAP.md) 为准；历史计划中的“当前”表述只用于追溯。

## 分类规则

| 类别 | 目录或入口 | 放入内容 | 处理规则 |
|---|---|---|---|
| 01 | `01-completed-plans/` | 已完成计划 | 计划范围已实施，并有对应验收记录；保留为实施依据和历史背景，不再当作待办清单 |
| 02 | `02-pending-plans/` | 待执行计划 | 尚未实施、尚未批准，或需要重新基线化；执行前必须重新核对代码和当前路线图 |
| 03 | `03-other/` | 其他文件 | 测试账号规则、操作规范、记录模板等不属于计划或架构决策的资料 |
| 04 | `04-project-map/` | 项目路径地图 | 当前路线图、运行入口和代码目录导航；优先于历史计划判断项目现状 |
| 05 | `docs/README.md` | 文档索引、状态说明、阅读顺序 | 为保持 `docs/` 的直接入口，索引保留在根目录，不另建只有一个文件的目录 |
| 06 | `06-acceptance-records/` | 验收记录 | 带日期的测试、性能、真实链路和视觉结果；记录当时结论，不自动代表今天仍通过 |
| 07 | `07-decisions/` | 决策原因 | 当前仍有效的架构契约、边界和取舍；与计划完成与否是两条不同生命周期 |
| 08 | `08-deprecated/` | 废弃的计划与文档 | 被后续方案覆盖、与当前实现冲突或不再执行；仅供追溯，禁止直接据此开发 |

## 状态说明

- **已完成**：该计划的实施范围已落地，并存在验收证据。后续发现的新问题应另立修复计划，不回写成“未完成”。
- **待执行**：设计尚未批准、实现尚未开始，或草案需要先删去已经完成的工作包。
- **部分通过**：工程链路可以运行，但产品目标、真实学生链路或业务有效性仍有未闭合项。
- **决策**：描述稳定契约和设计原因，不代表所有依赖它的功能都已完成。
- **已废弃**：只保留演进记录。若历史文档与当前路线图冲突，以路线图、决策文档和最新验收记录为准。

测试数量、接口耗时、模型表现和截图都是带日期的快照；需要判断当前是否通过时，应重新运行测试。

## 当前项目状态

| 阶段或能力 | 当前状态 | 依据和下一步 |
|---|---|---|
| 阶段 1：KG 定位与针对性教学 | 已完成 | 文字/图片问答、KG 定位、前后置检索和多轮教学已实现；KG 是否带来教学收益仍需对照评价 |
| 阶段 2：学习地图 | 工程完成，业务部分通过 | 证据账本、确定性投影、静态目录、梯子视图和地图 UI 已实现；真实学生后续轮次闭合证据仍有失败记录 |
| Manim 动画链路 | 二维能力已实现，三维暂未开放 | [Manim 能力边界与演进方向](07-decisions/MANIM_SCOPE_AND_SECURITY.md)；复杂二维函数可生成有限采样近似，三维需先完成受控 Renderer 验收 |
| 阶段 3：学生学习建模 | 节点级生产能力已实现，默认启用；扩展验收持续进行 | [阶段 3决策记录](07-decisions/PHASE3_STUDENT_MODEL_DECISION.md)、[实现基线设计稿](02-pending-plans/PHASE3_STUDENT_MODEL_DESIGN.md)；当前以 `evidence_turns` 读时 replay、节点级 Beta 估计和 memory-first Agent 工具为准 |
| 阶段 4：选题与生成题目 | 未开始 | 等阶段 3 形成稳定、可解释输入，并另立题库和选题验收计划 |
| 错题/笔记 PDF 导出 | 未开始 | 尚无获准执行计划 |
| 桌面、平板和移动适配 | 已实现，有验收记录 | 见 `06-acceptance-records/` |
| Windows Docker 一键部署 | 脚本和离线包链路已实现 | 仍需干净设备最终验收，不能把本地启动成功当成发布验收 |

## 推荐阅读顺序

### 第一次了解项目

1. [当前项目路线图](04-project-map/PROJECT_ROADMAP.md)：先确定阶段状态、优先级和未闭合风险。
2. [项目代码路径地图](04-project-map/PROJECT_PATH_MAP.md)：再定位运行入口、后端、前端、数据和测试。
3. [KG 工具调用决策](07-decisions/KG_TOOL_DESIGN.md)：理解 KG 如何被调用、返回什么以及不负责什么。
4. [证据分叉决策](07-decisions/EVIDENCE_FORK_DESIGN.md)：理解 evidence 的来源、失败语义和产品验收边界。
5. [前端重构验收报告](06-acceptance-records/FRONTEND_REDESIGN_TEST_REPORT.md)：查看现有地图、阅读和问答链路的实测结果。

### 接手当前前端或地图工作

1. [前端改版总控计划](01-completed-plans/FRONTEND_MASTER_PLAN.md)。
2. [静态教材目录与用户进度方案](01-completed-plans/LEARNING_MAP_STATIC_CATALOG_PROGRESS_PLAN.md)。
3. [梯子视图完成计划](01-completed-plans/LEARNING_MAP_LADDER_VIEW_PLAN.md)。
4. [梯子视图验收记录](06-acceptance-records/LEARNING_MAP_LADDER_VIEW_TEST_20260821.md)。
5. [真实学生链路测试记录](06-acceptance-records/STUDENT_TEST_RUN_20260819.md)，重点查看证据闭合失败项。

### 进入第三阶段实现与复核

1. [项目路线图](04-project-map/PROJECT_ROADMAP.md) 的阶段 2/3 部分。
2. [阶段 3决策记录](07-decisions/PHASE3_STUDENT_MODEL_DECISION.md)，确认当前实现契约和未覆盖范围。
3. [证据分叉决策](07-decisions/EVIDENCE_FORK_DESIGN.md)，确认 evidence 来源和闭合缺口。
4. [阶段 3实现基线设计稿](02-pending-plans/PHASE3_STUDENT_MODEL_DESIGN.md)，查看原方案与当前代码的差异。
5. 阶段 3已按生产决策默认启用；继续阅读验收记录，区分节点级生产能力与完整画像、真实学生链路等后续边界。

### 进入 Manim 动画工作

1. [Manim 能力边界与演进方向](07-decisions/MANIM_SCOPE_AND_SECURITY.md)：先确认二维范围、三维限制、近似表达和安全原因。
2. [项目代码路径地图](04-project-map/PROJECT_PATH_MAP.md)：定位队列、Dispatcher、Renderer、策略校验和媒体接口。
3. 运行当前 golden cases 和队列 smoke，再讨论三维或更高质量渲染，不直接删除策略检查。

## 文件清单与处理方式

### 01 已完成计划

| 文件 | 状态 | 处理方式 |
|---|---|---|
| `FORMULA_EDITOR_PLAN.md` | 已完成 | 保留实施和测试边界，不能当作新增公式需求清单 |
| `FRONTEND_ADJUSTMENT_PLAN.md` | 已完成 | 保留前端专项调整和历史验收 |
| `FRONTEND_MASTER_PLAN.md` | 已完成 | 当前前端三条工作线的汇总入口 |
| `FRONTEND_REDESIGN_EXECUTION_PLAN.md` | 已完成 | 与验收报告配套，保留执行顺序和验收标准 |
| `FRONTEND_REVIEW_CONSOLIDATED.md` | 已完成 | 保留审查问题、修复批次和风险说明 |
| `LEARNING_MAP_LADDER_VIEW_PLAN.md` | 已完成 | v2/v3 均已落地；v3 验收见 2026-08-21 记录 |
| `LEARNING_MAP_STATIC_CATALOG_PROGRESS_PLAN.md` | 已完成 | 保留静态目录与用户进度分离契约 |
| `PHOTO_CONTENT_RECOGNITION_PLAN.md` | 已完成 | 保留拍照识别范围和不做事项 |
| `TEXTBOOK_ISOLATION_PLAN.md` | 已完成 | 保留教材隔离、迁移和兼容规则 |

### 02 待执行计划

| 文件 | 状态 | 执行前处理 |
|---|---|---|
| `CONTEST_TIANQING_AI_2026_PLAN.md` | 进行中（截止 2026-08-31） | 赛事材料只描述已实现能力，不涉及代码改动；视频与文档按该计划时间线推进 |
| `PV_PRODUCTION_PLAN.md` | 待执行 | PV 分镜、录屏清单、配音稿、剪辑步骤；所有实机画面已在 localhost:8090 验证 |
| `INTERNAL_TEST_WELCOME_PLAN.md` | UI/反馈已验收，数据准备中 | 欢迎弹窗、反馈问卷和反馈接口已完成；PV 素材与测试账号模拟数据由独立工作线继续执行，见 `INTERNAL_TEST_WELCOME_ACCEPTANCE_20260826.md` |
| `KG_KNOWLEDGE_MAP_PLAN_DRAFT.md` | 待重新基线化 | 先删除已由静态目录、关系导出和梯子视图覆盖的工作包，再决定是否继续 |
| `PHASE3_STUDENT_MODEL_DESIGN.md` | 实现基线与偏离说明 | 保留研究和方案背景；当前代码以读时 replay、memory index/detail 为准，未实现部分继续列为后续工作 |

### 03 其他文件

| 文件 | 用途 |
|---|---|
| `STUDENT_TEST_ACCOUNT_RULES.md` | 测试账号凭据、真实学生测试流程、通过标准和结果模板 |

### 04 项目路径地图

| 文件 | 用途 |
|---|---|
| `PROJECT_ROADMAP.md` | 当前阶段状态、优先级、主要风险和次要流程 |
| `PROJECT_PATH_MAP.md` | 运行入口、核心代码、数据、测试和文档导航 |

### 06 验收记录

| 文件 | 结论 |
|---|---|
| `FRONTEND_REDESIGN_TEST_REPORT.md` | 前端重构和地图基础链路通过；记录了真实 LLM 闭环的边界 |
| `LEARNING_MAP_LADDER_VIEW_TEST_20260821.md` | 梯子视图 v3 的单测、构建、E2E 和视觉审查通过 |
| `STUDENT_TEST_RUN_20260819.md` | 真实学生链路部分通过，后续闭合 evidence 未通过 |
| `PHASE3_STUDENT_MODEL_TEST_20260825.md` | 当前主树自动化基线；阶段 3专项测试通过，完整回归和前端单测仍有环境/既有失败项 |
| `STUDENT_VIEW_MOBILE_REVISION_20260826.md` | 移动端学生视角修订验收通过；截图、面板、空状态和左滑删除专项及单线程全量 E2E 已通过 |

### 07 决策原因

| 文件 | 当前意义 |
|---|---|
| `KG_TOOL_DESIGN.md` | KG 工具的参数、返回结构、关系语义和验收契约 |
| `EVIDENCE_FORK_DESIGN.md` | 主干回答与证据分叉的架构、失败语义和已知产品缺口 |
| `PHASE3_STUDENT_MODEL_DECISION.md` | 阶段 3当前实现的模型、记忆工具、边界和开关契约 |
| `MANIM_SCOPE_AND_SECURITY.md` | Manim 当前二维边界、三维限制原因、复杂函数近似说明和后续优化验收条件 |

### 08 废弃的计划与文档

`FRONTEND_REDESIGN_PLAN.md`、`FRONTEND_REDESIGN_TEST_PLAN.md`、`MAP_PAGE_REDESIGN_PLAN.md`、`PHASE2_LEARNING_MAP_PLAN.md` 和 `PROJECT_PLAN_V0.3.md` 只用于解释方案演进；`header-preview.html` 只是历史预览文件。它们不能覆盖当前路线图、决策文档或最新验收结果。

## 待执行事项的入口

- 阶段 3：先阅读 [阶段 3决策记录](07-decisions/PHASE3_STUDENT_MODEL_DECISION.md)，再阅读[实现基线设计稿](02-pending-plans/PHASE3_STUDENT_MODEL_DESIGN.md)和代码路径地图。当前节点级模型和 memory-first Agent 默认启用；仍不得将其宣称为完整学生画像，也不得把尚未完成的真实学生链路、自动出题或学习收益实验写成已完成。
- 真实 KG 地图：先阅读 [KG 知识地图草案](02-pending-plans/KG_KNOWLEDGE_MAP_PLAN_DRAFT.md)，逐项重新基线化；不能整份从头照做。
- 阶段 2 证据可靠性和 KG 效果对照：目前只有路线图中的优先级，尚未形成获准实施计划。

需要研究历史方案时才进入 `08-deprecated/`；历史目录中的内容不能直接恢复为当前任务。
