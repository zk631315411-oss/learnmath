# LearnMath 后端：错题→反问→诊断→推荐的极简基础底座

本目录是 LearnMath 的后端，从 `D:\ai-math`（只读原材料库）极简复刻而来。
ai-math 是一个功能完整但体量庞大的教学系统；LearnMath 只保留"错题 → 反问 → 诊断 → 推荐"
最小闭环所需的地基，其余模块（画像、KG、练习、可视化、干预等）一律不搬。

## 为什么精简

- **只保留最小闭环**：认证 + 问答历史 + SSE 问答就够撑起阶段 1 的演示闭环。
- **少一半依赖，少一半维护**：剪掉 Neo4j、Redis、S3、Worker 等基建，单机 SQLite 即可跑通。
- **后续模块按需追加**：QA services、诊断服务放在下一个任务补，目录结构已为此留好位置。

## 当前包含的模块

```
app/
├── config.py             # 配置：LLM 密钥、JWT 密钥、数据库路径（环境变量注入）
├── main.py               # FastAPI 入口：注册路由、初始化数据库、CORS
├── auth/
│   └── jwt_handler.py    # JWT 签发/校验 + 密码哈希（完整复刻自 ai-math）
├── db/
│   ├── connection.py     # SQLite 连接 + 建表（users / user_profiles / chat_history / screenshot_context_cache）
│   ├── auth_db.py        # 账号 CRUD（完整复刻自 ai-math）
│   ├── user_profile_db.py# 用户画像读写（完整复刻自 ai-math）
│   ├── chat_history_db.py# 问答历史 CRUD + migrate_user_id（匿名→登录迁移）
│   └── screenshot_context_cache_db.py  # 截图上下文缓存读写（完整复刻自 ai-math）
├── models/
│   └── schemas.py        # Pydantic 请求/响应模型（认证 4 端点 + QA 请求）
├── routers/
│   ├── auth.py           # /register /login /anonymous /me 四个认证端点
│   ├── chat.py           # 历史 CRUD（/history） + /migrate 徽标迁移
│   └── qa.py             # POST /solve-stream：SSE 流式问答（文字+图片多模态）
└── services/
    ├── llm_service.py    # qa_client / qa_async / vision_chat（精简自 ai-math）
    ├── image_processing.py  # 图片预处理（完整复刻自 ai-math，多模态必需）
    └── qa/
        ├── prompt_builder.py       # 苏格拉底 4 段 prompt 模板（精简版）
        ├── contracts.py            # QATurnInput 数据契约
        ├── answer_service.py       # 文字/视觉双路径编排
        ├── streaming_service.py    # SSE 事件构造（stage/content/done/error/heartbeat）
        └── vision_context_service.py # 截图上下文缓存读写 + 判定
shared/
└── textbooks.json        # 4 本教材元数据（完整复刻自 ai-math）
```

## SSE 事件契约（与 ai-math 保持一致，前端可原样解析）

| 事件 | data 字段 |
|------|-----------|
| `stage` | `{stage, text}` |
| `content` | `{text}` |
| `done` | `{full_text, thinking, sources, sequence_id, qa_turn_id}`（视觉路径追加 `screenshot_context_id`） |
| `error` | `{error}` |
| `heartbeat` | `{text: ""}` |

## 如何启动

```bat
start.bat
```

后端跑在 `http://localhost:8000`，前端（`frontend/`）跑在 `http://localhost:5173`。
首次运行请先创建 venv 并安装依赖：`python -m venv venv && venv\Scripts\pip install -r requirements.txt`，
再把 `.env.example` 复制为 `.env` 并填入真实的 `JWT_SECRET` 与 `QA_LLM_API_KEY`。

## 数据库

SQLite 单文件（默认 `data/learning.db`），启动时自动建表（幂等）。
当前只有四张表：`users`（账号）、`user_profiles`（画像）、`chat_history`（问答历史，
含 page_number/marker_y_ratio/marker_type/thumbnail/crop_bbox/screenshot_context_id，
即前端徽标的持久化依据）、`screenshot_context_cache`（截图上下文缓存，多模态问答去重复用）。
诊断/推荐所需的新表在后续任务补。

## 无 LLM key 时的行为

服务照常启动；问答端点降级为 SSE `error` 事件（"QA LLM 服务未配置..."），不崩溃。
多模态图片超 15MiB 返回 413，非法请求返回 422。
