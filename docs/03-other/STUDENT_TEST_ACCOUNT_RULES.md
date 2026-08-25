# 学数有道学生测试账号规则

> 更新日期：2026-08-21  
> 适用范围：本地开发、真实 LLM 闭环验收、学习地图进度验证

## 1. 测试账号凭据

内测演示账号可以使用项目约定的固定账号名和共享密码，并在欢迎页、内测说明或初始化脚本中直接展示。账号只用于 LearnMath 内测体验，不得用于生产环境、外部服务或保存真实个人学习数据。

固定账号的密码应保持简单且便于内测用户输入；若账号将被移出内测范围、暴露到公网或改作正式用户账号，必须立即停用并重新设置凭据。不要把真实个人账号、真实个人密码或任何生产环境凭据写入文档、源码、自动化测试输出、截图文件名或提交日志。

## 2. 测试原则

1. 自动化回归默认 mock LLM，不消耗真实 API 额度。
2. 只有明确要求“真实 LLM 测试”时，才使用本地配置的测试账号发起真实问答。
3. 每次真实测试前记录对话数、evidence 数和各教材 revision，测试后对比增量。
4. 测试问题必须属于已选教材，且使用正确的 `textbook_id` 和页码。
5. 闭环测试至少两轮：第一轮让助手引导，第二轮模拟学生给出足以判断掌握程度的回答。
6. 真实学生测试不用脚本直接插入 evidence；真实测试 evidence 必须由 `/api/qa/solve-stream` 问答链路产生。内测初始化可以从已验收的样板账号复制 evidence，但必须重建目标账号和对话关联、保留复制记录，并在复制后重新校验学习进度。
7. 不把“模型回答成功”等同于“学习闭环成功”。必须检查 SSE `progress_delta`、数据库 evidence 和 `/api/learning-progress` 三者一致。
8. 测试产生的对话和 evidence 默认保留，用于观察学习地图累积行为；需要清理时必须同时说明清理范围和原因。
9. 命令行调用 API 时，请求体必须显式按 UTF-8 编码发送，并在首轮落库后抽查中文字段；禁止依赖 PowerShell 对字符串请求体的默认编码。

## 3. 标准真实问答流程

1. 使用 `/api/auth/login` 和本地测试凭据登录。
2. 选择一本教材，例如 `gaodai_shang`。
3. 通过正常 chat API 创建根对话，获得真实 `chat_id`。
4. 调用 `/api/qa/solve-stream` 发起第一轮问题，保存完整 SSE 事件。
   - PowerShell 应先把 JSON 转为 UTF-8 字节数组，并声明 `Content-Type: application/json; charset=utf-8`。
   - Python 应使用 `json=` 或 `json.dumps(..., ensure_ascii=False).encode("utf-8")`，不要传递未经编码确认的字符串请求体。
5. 使用相同 `chat_id` 和历史上下文发起学生回答或追问。
6. 等待 `done` 事件，记录 `qa_turn_id`、`latency_ms` 和 `progress_delta`。
7. 查询 `evidence_turns`，确认 `user_id`、`chat_id`、`textbook_id`、`node_id`、`outcome`、`created_at` 完整。
8. 查询 `/api/learning-progress`，确认 `catalog_version` 正确且 revision 单调增加。
9. 打开学习地图，确认受影响节点和所属章节更新，不出现 `/api/learning-map/chapters` 或 `/api/learning-map/nodes` 请求。

## 4. 通过标准

- 登录成功，身份来自 Bearer token。
- 流式回答包含正常 `content` 和最终 `done`，无 `error` 事件。
- 真实问答产生 evidence；禁止以数据库直插代替。
- evidence 能关联测试账号和真实 chat，时间戳非空。
- `progress_delta.revision` 与进度接口 revision 一致或不大于其最新值。
- 客户端忽略旧 revision，问答后不触发全图刷新。
- 学习地图仍由静态 catalog 渲染，进度接口失败也不影响章节结构和阅读入口。

## 5. 结果记录模板

```text
时间：
教材：
测试前：chat=?, evidence=?, revision=?
问题：
学生回答：
SSE：done/error；latency_ms=?；progress_delta revision=?
测试后：chat=?, evidence=?, revision=?
节点状态：
结论：通过 / 不通过
异常：
```
