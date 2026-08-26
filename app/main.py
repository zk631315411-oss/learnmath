import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import config
from app.db.connection import init_db
from app.routers import auth, chat, formula, qa, learning_map, learning_progress, textbook, manim, learner_model
from app.services.manim_queue import reconcile_active_artifacts_loop


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _log_config_audit()
    # 后台把无网络 renderer 写入文件 spool 的渲染结果周期性回写到 SQLite，
    # 否则 artifact 状态只会在前端轮询时才推进，可能滞留 queued/running。
    stop_event = asyncio.Event()
    reconcile_task = asyncio.create_task(reconcile_active_artifacts_loop(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await asyncio.gather(reconcile_task, return_exceptions=True)

# 确保数据目录存在并初始化数据库（幂等，重复启动无副作用）
config.ensure_dirs()
init_db()

# Evidence metrics must remain searchable in both local Uvicorn logs and
# production process output; the application logger otherwise defaults to a
# warning-only last-resort handler.
evidence_logger = logging.getLogger("learnmath.evidence")
evidence_logger.setLevel(logging.INFO)
if not evidence_logger.handlers:
    uvicorn_error_logger = logging.getLogger("uvicorn.error")
    if uvicorn_error_logger.handlers:
        evidence_logger.handlers.extend(uvicorn_error_logger.handlers)
    else:
        evidence_logger.addHandler(logging.StreamHandler())
evidence_logger.propagate = False

# 启动配置审计日志：与 evidence 日志同等可见性。
config_logger = logging.getLogger("learnmath.config")
config_logger.setLevel(logging.INFO)
if not config_logger.handlers:
    config_logger.handlers.extend(evidence_logger.handlers or [logging.StreamHandler()])
config_logger.propagate = False

# 学习记忆服务端注入日志：注入发生与否、注入文本必须在生产容器日志中
# 可检索（验证「AI 教师读取学习记忆」由机制保证的关键证据）。
memory_logger = logging.getLogger("learnmath.learning_memory")
memory_logger.setLevel(logging.INFO)
if not memory_logger.handlers:
    memory_logger.handlers.extend(evidence_logger.handlers or [logging.StreamHandler()])
memory_logger.propagate = False


def _log_config_audit() -> None:
    """可选功能的配置审计：只记录"有无"，绝不记录密钥值。

    防止「本地 .env 配了 key，但部署环境（runtime.env/服务器）没同步」导致
    功能静默缺失（如公式识别 503 not_configured），启动日志一眼可见。
    """
    from app.services.llm_service import llm_service

    features = {
        "llm": llm_service.is_available(),
        "knowledge_graph": bool(config.NEO4J_URI),
        "formula_vision(图片识别)": bool(config.FORMULA_VISION_API_KEY),
        "formula_fallback(备用识别)": bool(config.FORMULA_FALLBACK_API_KEY),
        "learner_model": bool(getattr(config, "LEARNER_MODEL_ENABLED", True)),
    }
    summary = ", ".join(f"{name}={'on' if enabled else 'OFF'}" for name, enabled in features.items())
    config_logger.info("startup config audit: %s", summary)

app = FastAPI(
    title="LearnMath API",
    description="LearnMath 后端：错题→反问→诊断→推荐的极简基础底座",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS：开发阶段放开跨域，前端独立端口可直连
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(formula.router)
app.include_router(qa.router)
app.include_router(learning_map.router)
app.include_router(learning_progress.router)
app.include_router(textbook.router)
app.include_router(manim.router)
app.include_router(learner_model.router)


@app.get("/")
def root():
    return {"message": "LearnMath API", "version": "0.1.0"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    """Deployment readiness: the API, model configuration, and KG are available."""
    from app.db.kg_v44 import _run
    from app.services.llm_service import llm_service

    if not llm_service.is_available():
        raise HTTPException(status_code=503, detail="LLM service is not configured")
    try:
        _run("RETURN 1 AS ok")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Knowledge graph is unavailable") from exc
    return {"status": "ready", "llm": "configured", "kg": "available"}
