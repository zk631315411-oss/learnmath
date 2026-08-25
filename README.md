# 学数有道（LearnMath）

LearnMath 是以教材知识图谱为核心的 AI 教学 Agent 项目，从 `D:\ai-math`（只读原材料库）
精简演进而来。阶段 1 和阶段 2 的核心工程已完成，阶段 3 的节点级 Beta 学生模型和
memory-first Agent 已正式进入生产并默认启用。阶段 2 的证据有效性、真实学生链路和
干净设备部署仍需持续验收；完整学生画像、个性化练习和考试机制尚未实现。

项目现状、文档分类和推荐阅读顺序见 [文档索引](docs/README.md)。

## 为什么精简

- **只保留最小闭环**：统一多模态 Agent + Neo4j 只读 KG 工具 + 原始问答历史。
- **基础设施有界**：Neo4j 与 SQLite 承载业务数据；Manim 动画使用内部 Redis、可信 Dispatcher 和断网 Renderer，不引入对象存储。
- **现实版优先**：阶段 1 教学由 Prompt 与 KG 工具协作；阶段 3 的 Beta 状态只读使用，默认开启，不能替代正式考试或完整画像。

## 当前包含的模块

```
app/
├── config.py             # 配置：LLM 密钥、JWT 密钥、数据库路径（环境变量注入）
├── main.py               # FastAPI 入口：注册路由、初始化数据库、CORS
├── auth/
│   └── jwt_handler.py    # JWT 签发/校验 + 密码哈希（完整复刻自 ai-math）
├── db/
│   ├── connection.py     # SQLite 连接 + 建表（认证、聊天、截图、evidence、Manim 和阶段 3兼容表）
│   ├── auth_db.py        # 账号 CRUD（完整复刻自 ai-math）
│   ├── user_profile_db.py# 用户画像读写（完整复刻自 ai-math）
│   ├── chat_history_db.py# 问答历史 CRUD + migrate_user_id（匿名→登录迁移）
│   ├── evidence_db.py    # evidence_turns 不可变事实账本（阶段 2）
│   ├── learner_model_db.py # 阶段 3从 evidence 读时 replay 的估计数据形状
│   ├── kg_v44.py         # Neo4j 只读定位与定向关系检索
│   └── screenshot_context_cache_db.py  # 截图上下文缓存读写（完整复刻自 ai-math）
├── models/
│   └── schemas.py        # Pydantic 请求/响应模型（认证 4 端点 + QA 请求）
├── routers/
│   ├── auth.py           # /register /login /anonymous /me 四个认证端点
│   ├── chat.py           # 历史 CRUD（/history） + /migrate 徽标迁移
│   ├── learner_model.py  # /api/learner-model 只读学生模型接口
│   ├── formula.py       # /api/formula 公式和混合内容识别
│   ├── manim.py         # /api/manim 动画任务和媒体状态
│   └── qa.py             # POST /solve-stream：SSE 流式问答（文字+图片多模态）
└── services/
    ├── llm_service.py    # 统一多模态、流式工具调用客户端
    ├── image_processing.py  # 图片预处理（完整复刻自 ai-math，多模态必需）
    ├── agents/           # ToolRuntime、KG/evidence、Manim 和 learning-memory 工具
    ├── learning/         # Beta 学生模型、前置风险和 memory index/detail
    ├── formula_conversion_service.py # LaTeX 清洗、转换和显示模式判断
    ├── formula_vision_service.py     # 公式和混合题目图片识别
    ├── manim_queue.py     # 动画队列和渲染任务提交
    └── qa/
        ├── prompt_builder.py       # Prompt 驱动的软教学流程与四级脚手架 + 每轮收尾自评
        ├── contracts.py            # QATurnInput 数据契约
        ├── answer_service.py       # 文字/截图统一 ToolRuntime 编排 + 自评证据采集落库
        ├── evidence_reporting.py   # 自评 node_id 校验 + evidence 落库（阶段 2）
        ├── streaming_service.py    # SSE 事件构造
        └── vision_context_service.py # 截图上下文缓存读写 + 判定
shared/
└── textbooks.json        # 4 本教材元数据（完整复刻自 ai-math）
```

## SSE 事件契约（与 ai-math 保持一致，前端可原样解析）

| 事件 | data 字段 |
|------|-----------|
| `stage` | `{stage, text}` |
| `thinking` | `{text}` |
| `tool_call` / `tool_result` | KG 工具参数、状态与可展示结果 |
| `content` | `{text}` |
| `artifact` | Manim 动画制品的排队/媒体状态（不含生成源码） |
| `done` | `{full_text, thinking, sources, tool_activities, qa_turn_id}`（包含经脱敏的学习记录状态；截图追加 `screenshot_context_id`） |
| `error` | `{error}` |
| `heartbeat` | `{text: ""}` |

Manim 当前以教学示意为定位：二维函数、几何、向量、参数曲线和复杂二维函数近似已接入；处处连续但处处不可导的函数只能按有限项、有限采样绘制。三维 `ThreeDScene`、真实相机旋转、OpenGL/GPU 和外部资源暂未开放，原因与后续优化入口见 [Manim 能力边界与演进方向](docs/07-decisions/MANIM_SCOPE_AND_SECURITY.md)。

## 如何启动

### Windows 一键部署

正式发布包分为两个部分：单独的 Docker Desktop 安装包，以及 LearnMath 应用包（容器镜像、四本教材和启动脚本）。新电脑先运行 Docker 安装包，再在 LearnMath 应用包中双击：

```bat
Install-LearnMath.bat
```

安装脚本会首次询问模型 API Key 和 Neo4j Aura 凭据，启动容器，等待完整健康检查后自动打开浏览器。用户不需要安装 Python、Node.js 或本地 Neo4j。两个安装包的制作方式和 Docker Desktop 授权注意事项见 `deploy/README.md`。

安装完成后，日常使用双击 `Start-LearnMath.bat` 启动、`Stop-LearnMath.bat` 停止。启动会拉起全部五个服务（web、api、redis、manim-dispatcher、manim-renderer），并等待 Web `/health` 返回成功后再提示可访问。对外访问地址为 `http://127.0.0.1:<LEARNMATH_PORT>`，端口在 `deploy/runtime.env` 的 `LEARNMATH_PORT` 中配置（安装时自动挑选空闲端口），改完后重新启动生效。`Start-LearnMath.bat` 使用本地已有镜像，不会自动重新构建；修改生产代码后需先执行镜像构建，再重新启动服务。

这两个入口用途不同：

| 入口 | 用途 | 服务范围 |
|------|------|----------|
| `Start-LearnMath.bat` | 正式体验 | Docker Compose 全部五个服务，包含完整动画链路 |
| `start.bat` | 本地开发调试 | Python 后端 + Vite 前端；Redis、Dispatcher 和 Renderer 需要额外启动 |

普通使用者只需要使用 `Start-LearnMath.bat`。`start.bat` 保留给需要热更新、接口调试或前端测试的开发者。

在 Claude Code 中也可以用指令 `/start`、`/stop` 启动和停止这套 Docker 服务（见 `.claude/commands/`）。

### 开发模式

```bat
start.bat
```

后端默认从 `8001`、前端默认从 `5173` 开始选取端口；如果端口已被占用，脚本会自动选择后续空闲端口，并在启动窗口中打印实际地址。也可以显式设置
`LEARNMATH_API_PORT` 和 `LEARNMATH_FRONTEND_PORT`（例如 `set LEARNMATH_API_PORT=8002 && set LEARNMATH_FRONTEND_PORT=5174 && start.bat`）。脚本会检查 Python/npm 依赖，必要时自动修复缺失的前端依赖，并把前端代理指向实际后端端口。
首次运行请先创建 venv 并安装依赖：`python -m venv venv && venv\Scripts\pip install -r requirements.txt`，
再把 `.env.example` 复制为 `.env` 并填入真实的 `JWT_SECRET` 与 `QA_LLM_API_KEY`。

#### 开发模式下启用 Manim 动画（可选）

`start.bat` 只起后端和前端，**不含** Manim 渲染链路。开发模式要真渲染动画，需额外起三个进程（生产模式的 compose 会自动拉起，开发模式需手动）：

```bat
REM 1) 主机 Redis（开发后端默认连 127.0.0.1:6379）
docker run -d --name learnmath-dev-redis -p 127.0.0.1:6379:6379 redis:7.4.5-alpine redis-server --save "" --appendonly no

REM 2) Dispatcher：消费 Redis 队列 -> 写入渲染 spool（需 PYTHONPATH 指向项目根）
set PYTHONPATH=%CD% && venv\Scripts\python -m scripts.run_manim_dispatcher

REM 3) Spool worker：取 spool 任务 -> 调用 manim 渲染出 mp4
venv\Scripts\python -m app.workers.manim_worker
```

前置：venv 内需安装 manim（`venv\Scripts\pip install manim`），worker 会以 `python -m manim` 自包含调用，不依赖系统 manim.exe。未启用时调用动画工具会优雅降级（回答正常完成，仅提示渲染服务不可用），不影响其余问答功能。

## 数据库

SQLite 保存应用数据（默认 `data/learning.db`），Neo4j 保存教材知识图谱。SQLite 启动时自动建表（幂等）。
核心表包括：`users`（账号）、`user_profiles`（现有兼容表）、`chat_history`（问答历史，
含 page_number/marker_y_ratio/marker_type/thumbnail/crop_bbox/screenshot_context_id，
以及同徽标 `follow_ups`、思考和工具活动；`textbook_id` 记录教材归属，
NULL 老数据表示全教材可见，不回填）、`screenshot_context_cache`（截图上下文缓存）、
`evidence_turns`（阶段 2 自评证据账本：请求内 one-shot 证据分叉上报的节点学习观察，
含 user_id / chat_id / qa_turn_id / node_id / textbook_id / scaffolding_level / outcome /
source / model_version，按 user_id+node_id 建索引；删除提问记录不级联删除证据），以及
`manim_artifacts`（动画源码、异步状态和媒体路径；跟随聊天迁移与删除）。模型生成源码不会返回前端，
Renderer 不挂载 SQLite、不接收 LLM/JWT/Neo4j 密钥，并通过无网络容器执行。

### 为什么现在开始记录证据（阶段 2 变动说明）

阶段 1 只做「KG 定位 → 引导教学 → 验证」闭环，没有长期状态。阶段 2 要展示
学习地图、告诉学生「哪里还学得不太好」，就必须有跨轮次的掌握证据。因此引入
`evidence_turns` 自评账本：主回答完成后由请求内证据分叉调用 `report_turn_outcome`
上报本轮教学目标知识点的 `student_outcome`（independent / assisted /
direct_taught / unresolved），后端校验 node_id 合法（必须来自本轮/本线程 resolved
结果且前缀匹配绑定教材）后落库。之所以用「主 Agent 自评单入口」而不是「KG resolved
自动落库」，是因为 resolved 是模型的检索解释、不代表学生的客观行为（设计与评审理由见
`docs/08-deprecated/PHASE2_LEARNING_MAP_PLAN.md` §1.4 决策 4；该文件仅用于历史追溯）。

### 阶段 3：节点学习模型与学习记忆

`evidence_turns` 继续是唯一事实源。`LEARNER_MODEL_ENABLED` 默认开启（可通过环境变量显式
关闭进行回滚或隔离诊断），后端按固定
版本的 outcome adapter 和 Beta replay 计算节点状态，并由
`retrieve_learning_memory_index` / `retrieve_learning_memory_detail` 为 Agent 提供
有界的跨对话学习记忆。当前估计是读时重算，不写入新的学生反馈或人格化画像；Agent
只能读取当前教材和本轮 KG 已定位节点，模型不可用时回退到既有 KG/阶段 1规则。

## 无 LLM key 时的行为

服务照常启动；问答端点降级为 SSE `error` 事件（"QA LLM 服务未配置..."），不崩溃。
多模态图片超 15MiB 返回 413，非法请求返回 422。
