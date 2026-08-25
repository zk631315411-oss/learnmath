# 阶段 3主树自动化基线记录（2026-08-25）

> 目的：为本次文档更新提供当前主树代码事实和测试证据。
> 这是自动化基线记录，不替代完整学生画像、真实学生链路或 KG 学习收益验收；阶段 3 节点级模型已按生产决策默认启用。

## 环境

- 工作目录：`D:\LearnMath`
- 分支：`main`
- 基线提交：`9eead7e`
- 默认开关：`LEARNER_MODEL_ENABLED=true`（阶段 3节点级模型已按生产决策默认启用）

## 阶段 3专项测试

命令：

```text
python -m pytest -q tests/test_learner_model.py tests/test_learner_model_db.py tests/test_learner_model_api.py tests/test_learning_memory.py
```

结果：`41 passed`，1 个 Starlette/httpx 弃用警告。

覆盖范围包括 Beta replay、版本参数、模型 API、教材隔离、memory index/detail、scope 和
当前工具边界。专项测试通过说明节点级生产能力的代码基线可运行；它不代表完整学生画像
或 KG 学习收益已经完成验证。

## 全量后端回归

命令：

```text
python -m pytest -q
```

结果：`211 passed, 3 skipped, 32 subtests passed`。

全量后端回归通过；保留 1 个 Starlette/httpx 弃用警告，不影响测试结果。

## 前端单元测试

命令：

```text
cd frontend
npm run test:unit
```

结果：未启动。当前 `frontend/node_modules` 中没有可执行的 `.bin/vitest` 入口，命令返回
`vitest is not recognized`。因此本记录不对前端单元测试作通过判断。

## 文档和路径检查

- `git diff --check`：通过；仅有 Git 的 LF/CRLF 提示。
- 阶段 3文档中引用的后端、工具、前端状态组件和专项测试路径：均存在；检查发现前端尚未专门渲染 `learning_memory_status` 的四条中文状态文案。
- 本记录未检查真实 LLM、浏览器交互或 Docker 干净设备部署；这些是生产后的持续验收项。

## 结论

当前主树可以记录为“阶段 3节点级生产能力已实现，专项自动化测试通过，默认启用”。这不等于
“完整学生画像已完成”或“KG 已被证明带来学习收益”；真实 LLM、真实学生链路和干净设备
部署仍需单独持续验收。
