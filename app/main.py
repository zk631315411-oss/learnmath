import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import config
from app.db.connection import init_db
from app.routers import auth, chat, formula, qa, learning_map, learning_progress, textbook, manim

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

app = FastAPI(
    title="LearnMath API",
    description="LearnMath 后端：错题→反问→诊断→推荐的极简基础底座",
    version="0.1.0",
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
