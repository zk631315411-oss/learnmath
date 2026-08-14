from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import config
from app.db.connection import init_db
from app.routers import auth, chat, qa

# 确保数据目录存在并初始化数据库（幂等，重复启动无副作用）
config.ensure_dirs()
init_db()

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
app.include_router(qa.router)


@app.get("/")
def root():
    return {"message": "LearnMath API", "version": "0.1.0"}


@app.get("/health")
def health():
    return {"status": "ok"}
