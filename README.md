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
│   └── user_profile_db.py# 用户画像读写（完整复刻自 ai-math）
├── models/
│   └── schemas.py        # Pydantic 请求/响应模型（仅认证 4 端点所需）
└── routers/
    └── auth.py           # /register /login /anonymous /me 四个认证端点
shared/
└── textbooks.json        # 4 本教材元数据（完整复刻自 ai-math）
```

## 如何启动

```bat
start.bat
```

后端跑在 `http://localhost:8000`，前端（`frontend/`）跑在 `http://localhost:5173`。
首次运行请先创建 venv 并安装依赖：`python -m venv venv && venv\Scripts\pip install -r requirements.txt`，
再把 `.env.example` 复制为 `.env` 并填入真实的 `JWT_SECRET` 与 `QA_LLM_API_KEY`。

## 数据库

SQLite 单文件（默认 `data/learning.db`），启动时自动建表（幂等）。
当前只有四张表：`users`（账号）、`user_profiles`（画像）、`chat_history`（问答历史）、
`screenshot_context_cache`（截图上下文缓存）。诊断/推荐所需的新表在下一任务补。
