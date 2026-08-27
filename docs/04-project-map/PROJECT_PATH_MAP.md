# LearnMath 项目路径地图

> 更新日期：2026-08-25
> 状态：当前有效

## 运行入口

| 路径 | 职责 |
|---|---|
| `app/main.py` | FastAPI 应用入口、路由注册和数据库初始化 |
| `frontend/src/main.tsx` | React 前端入口 |
| `frontend/src/App.tsx` | 顶层学习空间编排 |
| `start.bat` | 本地开发启动 |
| `Install-LearnMath.bat` | Windows 发布包安装入口 |
| `deploy/compose.yml` | 发布环境容器编排 |

## 核心后端

| 路径 | 职责 |
|---|---|
| `app/routers/qa.py` | 统一文字/图片 SSE 问答入口 |
| `app/routers/formula.py` | 单公式和整页混合内容识别接口 |
| `app/routers/manim.py` | Manim 动画生成、队列和媒体状态接口 |
| `app/services/qa/answer_service.py` | Agent 主回答、工具调用和证据分叉编排 |
| `app/services/qa/prompt_builder.py` | 教学行为和脚手架 Prompt |
| `app/services/agents/tool_runtime.py` | 有界工具调用运行时 |
| `app/services/agents/tools/retrieve_kg_context.py` | 面向模型的 KG 工具契约 |
| `app/services/agents/tools/report_turn_outcome.py` | 内部学习证据上报工具 |
| `app/db/kg_v44.py` | Neo4j 只读定位和关系检索 |
| `app/db/evidence_db.py` | 学习证据账本和进度 revision |
| `app/db/learner_model_db.py` | 阶段 3节点估计的读时 replay、公共估计数据形状和兼容表结构 |
| `app/services/learning/projection.py` | 证据到五态学习状态的确定性投影 |
| `app/services/learning/model_adapter.py` | 四类 evidence outcome 到 Beta 观测的版本化适配 |
| `app/services/learning/student_model.py` | Beta 后验、时间衰减、不确定性和四态模型状态 replay |
| `app/services/learning/learner_model_service.py` | 学生可见模型 API 数据、KG 前置风险和教学动作派生 |
| `app/services/learning/learning_memory_service.py` | memory index/detail 查询、证据摘要和可见回答摘录 |
| `app/services/learning/learning_memory_scope.py` | QA 请求级 memory 引用注册与并发隔离 |
| `app/routers/learning_progress.py` | 用户稀疏学习进度接口 |
| `app/routers/learner_model.py` | `/api/learner-model` 和节点详情只读接口 |
| `app/services/agents/tools/retrieve_learning_memory_index.py` | Agent 有界读取当前教材内节点学习记忆索引 |
| `app/services/agents/tools/retrieve_learning_memory_detail.py` | Agent 读取当前 index 返回的有限 evidence 详情 |
| `app/services/formula_conversion_service.py` | LaTeX 清洗、转换和公式显示模式判断 |
| `app/services/formula_vision_service.py` | 公式和混合题目图片识别 |
| `app/services/manim_queue.py`、`app/services/manim_policy.py` | Manim 队列、资源限制和生成策略校验 |

## 核心前端

| 路径 | 职责 |
|---|---|
| `frontend/src/hooks/useChat.ts` | 对话、后台回答任务和持久化协作 |
| `frontend/src/services/streamQA.ts` | SSE 客户端 |
| `frontend/src/hooks/useMapHomeData.ts` | 静态目录与用户进度合并 |
| `frontend/src/components/MapHome.tsx` | 全书学习地图首页、章节展开和教材切换 |
| `frontend/src/components/kg/SectionLadderPanel.tsx` | 章节小节的梯子、岛屿关系和节点详情组合入口 |
| `frontend/src/components/kg/SectionLadder.tsx` | 小节主干梯子、节点选择和关系布局 |
| `frontend/src/components/kg/NodeFocusCard.tsx` | 节点聚焦子图、关系详情和学习动作 |
| `frontend/src/components/AgentActivity.tsx` | 学生可见的 KG 工具活动和 learning-memory 查询状态；内部记忆明细不直接展示 |
| `frontend/src/components/formula/FormulaComposer.tsx` | 数学输入、结构导航和公式编辑 |
| `frontend/src/components/formula/RecognizedContentCard.tsx` | 拍照混合内容识别结果编辑和插入 |
| `frontend/src/components/ChatPlusMenu.tsx`、`PhotoPreviewSheet.tsx` | 拍照识别、相册识别和拍题提问入口 |
| `frontend/src/components/MarkdownRenderer.tsx` | Markdown、GFM、KaTeX 和公式展示 |
| `frontend/public/map-catalog/` | 构建期生成的静态教材目录 |

## 数据与测试

| 路径 | 职责 |
|---|---|
| `data/learning.db` | 本地 SQLite 运行数据 |
| `data/textbooks/` | 发布使用的教材 PDF |
| `shared/textbooks.json` | 教材注册信息 |
| `scripts/export_learning_catalog.py` | 从 KG/PDF 导出静态学习目录 |
| `tests/` | 后端和领域逻辑测试 |
| `tests/test_learner_model.py`、`test_learner_model_db.py`、`test_learner_model_api.py`、`test_learning_memory.py` | 阶段 3公式、replay、API 和 Agent memory 边界测试 |
| `frontend/e2e/` | Playwright 端到端测试 |
| `artifacts/` | 截图和视觉验收产物 |

## 文档导航

文档分类、状态与阅读顺序见 [文档索引](../README.md)。当前项目阶段只以 [项目路线图](PROJECT_ROADMAP.md) 为准。
