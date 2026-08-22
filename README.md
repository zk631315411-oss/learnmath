# 学数有道（LearnMath）

LearnMath 是以教材知识图谱为核心的 AI 教学 Agent 项目，从 `D:\ai-math`（只读原材料库）
精简演进而来。当前已完成阶段 1“KG 定位 → 引导教学 → 继续验证”和阶段 2 学习地图的
核心工程；阶段 2 的证据有效性仍需继续验收，学习画像、个性化练习和考试机制尚未实现。

项目现状、文档分类和推荐阅读顺序见 [文档索引](docs/README.md)。

## 为什么精简

- **只保留最小闭环**：统一多模态 Agent + Neo4j 只读 KG 工具 + 原始问答历史。
- **基础设施有界**：Neo4j 与 SQLite 承载业务数据；Manim 动画使用内部 Redis、可信 Dispatcher 和断网 Renderer，不引入对象存储。
- **现实版优先**：教学逻辑由 Prompt 软约束，显式状态机、掌握度和学习画像留作未来演进。

## 当前包含的模块

```
app/
├── config.py             # 配置：LLM 密钥、JWT 密钥、数据库路径（环境变量注入）
├── main.py               # FastAPI 入口：注册路由、初始化数据库、CORS
├── auth/
│   └── jwt_handler.py    # JWT 签发/校验 + 密码哈希（完整复刻自 ai-math）
├── db/
│   ├── connection.py     # SQLite 连接 + 建表（users / user_profiles / chat_history / screenshot_context_cache / evidence_turns）
│   ├── auth_db.py        # 账号 CRUD（完整复刻自 ai-math）
│   ├── user_profile_db.py# 用户画像读写（完整复刻自 ai-math）
│   ├── chat_history_db.py# 问答历史 CRUD + migrate_user_id（匿名→登录迁移）
│   ├── evidence_db.py    # evidence_turns 自评证据读写（阶段 2：批量插入 + 按用户/节点查询）
│   ├── kg_v44.py         # Neo4j 只读定位与定向关系检索
│   └── screenshot_context_cache_db.py  # 截图上下文缓存读写（完整复刻自 ai-math）
├── models/
│   └── schemas.py        # Pydantic 请求/响应模型（认证 4 端点 + QA 请求）
├── routers/
│   ├── auth.py           # /register /login /anonymous /me 四个认证端点
│   ├── chat.py           # 历史 CRUD（/history） + /migrate 徽标迁移
│   └── qa.py             # POST /solve-stream：SSE 流式问答（文字+图片多模态）
└── services/
    ├── llm_service.py    # 统一多模态、流式工具调用客户端
    ├── image_processing.py  # 图片预处理（完整复刻自 ai-math，多模态必需）
    ├── agents/           # ToolRuntime 与 retrieve_kg_context / report_turn_outcome 工具
    └── qa/
        ├── prompt_builder.py       # Prompt 驱动的软教学流程与四级脚手架 + 每轮收尾自评
        ├── contracts.py            # QATurnInput 数据契约
        ├── answer_service.py       # 文字/截图统一 ToolRuntime 编排 + 自评证据采集落库
        ├── evidence_reporting.py   # 自评 node_id 校验 + 落库（阶段 2，内部工具不进展示流）
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
| `done` | `{full_text, thinking, sources, tool_activities, qa_turn_id}`（截图追加 `screenshot_context_id`） |
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

### 开发模式

```bat
start.bat
```

后端默认跑在 `http://localhost:8001`，前端跑在 `http://localhost:5173`。使用独立的 8001 端口可避免误连仍在 8000 运行的 `ai-math` 服务；如需改端口，启动前设置 `LEARNMATH_API_PORT`。
首次运行请先创建 venv 并安装依赖：`python -m venv venv && venv\Scripts\pip install -r requirements.txt`，
再把 `.env.example` 复制为 `.env` 并填入真实的 `JWT_SECRET` 与 `QA_LLM_API_KEY`。

## 数据库

SQLite 保存应用数据（默认 `data/learning.db`），Neo4j 保存教材知识图谱。SQLite 启动时自动建表（幂等）。
核心表包括：`users`（账号）、`user_profiles`（现有兼容表）、`chat_history`（问答历史，
含 page_number/marker_y_ratio/marker_type/thumbnail/crop_bbox/screenshot_context_id，
以及同徽标 `follow_ups`、思考和工具活动；`textbook_id` 记录教材归属，
NULL 老数据表示全教材可见，不回填）、`screenshot_context_cache`（截图上下文缓存）、
`evidence_turns`（阶段 2 自评证据账本：请求内 one-shot 证据分叉上报的节点掌握状态，
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

## 无 LLM key 时的行为

服务照常启动；问答端点降级为 SSE `error` 事件（"QA LLM 服务未配置..."），不崩溃。
多模态图片超 15MiB 返回 413，非法请求返回 422。
