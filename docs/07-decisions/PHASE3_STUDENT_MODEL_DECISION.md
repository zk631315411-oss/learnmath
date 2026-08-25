# 阶段 3 方案 A 决策记录

> 日期：2026-08-25
> 状态：当前主树有效
> 适用基线：`main@9eead7e` 及其工作区代码

## 决策

阶段 3 首发采用可解释的节点级学生模型：以 `evidence_turns` 为唯一事实源，经过
版本化 outcome adapter 后进行 Beta replay，并用 KG 的明确直接
`PREREQUISITE_OF` 关系生成教学建议。阶段 2 的五态地图投影仍然独立存在，不能把地图
状态当作正式 mastery，也不能让前置风险改写目标节点估计。

## 当前实现

- adapter/version：`evidence-beta-v1`；模型版本：`learner-beta-v1`；两者必须成对兼容。
- 先验为 Beta(1,1)，时间半衰期为 14 天；估计、不确定性和状态由
  `app/services/learning/student_model.py` 确定性计算。
- `independent` 且无脚手架提供强正向信号；带脚手架的 independent 降级为 assisted；
  assisted 提供弱正向信号；`direct_taught` 和 `unresolved` 不增加 Alpha/Beta。
- 内部状态为 `unknown`、`emerging`、`likely_ready`、`model_needs_review`。
- KG 风险只使用最多 5 个明确直接前置，服务于 `check_prerequisite`、排序和建议，
  不参与目标节点 estimate/state 计算。
- 公开接口为 `GET /api/learner-model` 和节点详情接口；合法教材但模型关闭、失败或
  不可用时返回中性 envelope，未知教材沿用现有 400 校验。

## Memory-first Agent 契约

在线 Agent 工具使用：

- `retrieve_learning_memory_index`：最多 3 个当前教材内、且已由本轮 KG 定位的节点；
  返回 memory summary、最多 5 条跨节点最近 observation、mastery view 和有限
  teaching hint。
- `retrieve_learning_memory_detail`：最多 3 条，只接受本轮 index 注册且同时绑定
  `evidence_id`、`user_id`、`textbook_id`、`node_id` 的引用；只返回学生问题和最终教师
  回复的短摘录，不返回 thinking 或 tool activities。

memory scope 使用 `contextvars` 按 QA 请求隔离，请求结束即失效。当前轮新写入的
observation 不进入当前轮的记忆读取结果，下一轮才可见。后端会把 memory 查询状态以
脱敏的 `learning_memory_status` 活动写入 SSE 和历史记录。当前主树前端尚未为该活动
增加专用四态文案，仍由通用 `AgentActivity` 展示；因此不能把“正在查询学习记录…”、
“已读取学习记录”、“学习记录部分可用，继续回答”、“学习记录暂时不可用”记录为已完成
UI 契约。

## 重要实现边界

当前主树采用读时 replay：每次模型或 memory 读取直接从不可变 `evidence_turns` 重算。
`learner_node_estimates` 和 `learner_model_runs` 只保留兼容表结构，当前版本不写入派生
快照或 run 记录。原实施计划中持久化快照、学生反馈接口、完整用户级画像、节点详情中的
完整 P3 展示、自动出题、PDF 导出、Bloom/SOLO 高阶诊断和 KG 消融实验均未实现。

`LEARNER_MODEL_ENABLED=true` 是默认部署值，阶段 3 的节点级模型和 memory-first Agent
已正式进入生产。代码、离线测试和 Agent memory 能力的生产可用，不等于完整学生画像已经
实现，也不等于 KG 已被证明带来学习收益；阶段 2 的真实学生闭合缺口、真实 LLM 链路和
干净设备部署仍需持续验收。

## 版本与回退

改变 outcome 映射、先验、衰减、不确定性、状态阈值或前置风险聚合规则时必须 bump
`model_version`，并与新的 `adapter_version` 建立明确兼容对。模型关闭、读取失败或
replay 异常时，问答 SSE 不被阻断，Agent 回退到既有 KG 和阶段 1教学规则。
