# LearnMath 项目路径地图

> 更新日期：2026-08-21
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
| `app/services/qa/answer_service.py` | Agent 主回答、工具调用和证据分叉编排 |
| `app/services/qa/prompt_builder.py` | 教学行为和脚手架 Prompt |
| `app/services/agents/tool_runtime.py` | 有界工具调用运行时 |
| `app/services/agents/tools/retrieve_kg_context.py` | 面向模型的 KG 工具契约 |
| `app/services/agents/tools/report_turn_outcome.py` | 内部学习证据上报工具 |
| `app/db/kg_v44.py` | Neo4j 只读定位和关系检索 |
| `app/db/evidence_db.py` | 学习证据账本和进度 revision |
| `app/services/learning/projection.py` | 证据到五态学习状态的确定性投影 |
| `app/routers/learning_progress.py` | 用户稀疏学习进度接口 |

## 核心前端

| 路径 | 职责 |
|---|---|
| `frontend/src/hooks/useChat.ts` | 对话、后台回答任务和持久化协作 |
| `frontend/src/services/streamQA.ts` | SSE 客户端 |
| `frontend/src/hooks/useMapHomeData.ts` | 静态目录与用户进度合并 |
| `frontend/src/components/MapHome.tsx` | 全书学习地图首页 |
| `frontend/src/components/ChapterMapView.tsx` | 章节地图入口与列表/地图切换 |
| `frontend/src/components/ChapterLadderView.tsx` | KG 章总览、节梯子、岛屿总览和列表兜底 |
| `frontend/src/components/kg/NodeDetailCard.tsx` | 节点聚焦子图、关系详情和学习动作 |
| `frontend/public/map-catalog/` | 构建期生成的静态教材目录 |

## 数据与测试

| 路径 | 职责 |
|---|---|
| `data/learning.db` | 本地 SQLite 运行数据 |
| `data/textbooks/` | 发布使用的教材 PDF |
| `shared/textbooks.json` | 教材注册信息 |
| `scripts/export_learning_catalog.py` | 从 KG/PDF 导出静态学习目录 |
| `tests/` | 后端和领域逻辑测试 |
| `frontend/e2e/` | Playwright 端到端测试 |
| `artifacts/` | 截图和视觉验收产物 |

## 文档导航

文档分类、状态与阅读顺序见 [文档索引](../README.md)。当前项目阶段只以 [项目路线图](PROJECT_ROADMAP.md) 为准。
