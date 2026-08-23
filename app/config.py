import os
from pathlib import Path

# 项目根目录：config.py 位于 app/ 下，上一级即后端根目录
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

# 手动解析 .env，保证 python-dotenv 未安装时核心配置仍可用
if ENV_FILE.exists():
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv:
    load_dotenv(ENV_FILE)

# 运行时数据目录：SQLite 数据库放这里
DATA_DIR = BASE_DIR / "data"


class Config:
    BASE_DIR: Path = BASE_DIR
    DATA_DIR: Path = DATA_DIR

    @classmethod
    def ensure_dirs(cls):
        # 数据库文件写入前必须保证父目录存在，否则 sqlite3.connect 直接报错
        cls.DATA_DIR.mkdir(parents=True, exist_ok=True)
        cls.MANIM_RENDER_DIR.mkdir(parents=True, exist_ok=True)

    # QA 文字回答用的 LLM（OpenAI 兼容协议）
    QA_LLM_API_KEY: str = os.getenv("QA_LLM_API_KEY", "")
    QA_LLM_API_BASE: str = os.getenv(
        "QA_LLM_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    QA_LLM_MODEL: str = os.getenv("QA_LLM_MODEL", "kimi-k2.7-code")

    # 公式转写默认复用问答模型，也可通过 FORMULA_* 使用独立模型。
    FORMULA_API_KEY: str = os.getenv("FORMULA_API_KEY") or QA_LLM_API_KEY
    FORMULA_API_BASE: str = os.getenv("FORMULA_API_BASE") or QA_LLM_API_BASE
    FORMULA_MODEL: str = os.getenv("FORMULA_MODEL") or QA_LLM_MODEL
    FORMULA_CONVERSION_TIMEOUT_SECONDS: float = float(
        os.getenv("FORMULA_CONVERSION_TIMEOUT_SECONDS", "8")
    )
    FORMULA_CONVERSION_TOTAL_TIMEOUT_SECONDS: float = float(
        os.getenv("FORMULA_CONVERSION_TOTAL_TIMEOUT_SECONDS", "15")
    )

    # 公式截图识别视觉 provider。视觉 key 与描述转写/fallback key 始终分离。
    FORMULA_VISION_API_KEY: str = os.getenv("FORMULA_VISION_API_KEY", "")
    FORMULA_VISION_API_BASE: str = os.getenv(
        "FORMULA_VISION_API_BASE", "https://open.bigmodel.cn/api/paas/v4"
    )
    FORMULA_VISION_MODEL: str = os.getenv("FORMULA_VISION_MODEL", "glm-4.1v-thinking-flash")
    FORMULA_VISION_THINKING: str = os.getenv("FORMULA_VISION_THINKING", "disabled")
    FORMULA_VISION_TIMEOUT_SECONDS: float = float(
        os.getenv("FORMULA_VISION_TIMEOUT_SECONDS", "25")
    )
    FORMULA_FALLBACK_API_KEY: str = os.getenv("FORMULA_FALLBACK_API_KEY", "")
    FORMULA_FALLBACK_API_BASE: str = os.getenv("FORMULA_FALLBACK_API_BASE", "")
    FORMULA_FALLBACK_MODEL: str = os.getenv("FORMULA_FALLBACK_MODEL", "")
    FORMULA_FALLBACK_TIMEOUT_SECONDS: float = float(
        os.getenv("FORMULA_FALLBACK_TIMEOUT_SECONDS", "5")
    )
    FORMULA_RECOGNIZE_TOTAL_TIMEOUT_SECONDS: float = float(
        os.getenv("FORMULA_RECOGNIZE_TOTAL_TIMEOUT_SECONDS", "30")
    )
    FORMULA_CONTENT_VISION_TIMEOUT_SECONDS: float = float(
        os.getenv("FORMULA_CONTENT_VISION_TIMEOUT_SECONDS", "30")
    )

    # SQLite 数据库路径，可用环境变量覆盖以便隔离测试（空值回退默认路径）
    DB_PATH: str = os.getenv("AI_MATH_DB_PATH") or str(DATA_DIR / "learning.db")

    # JWT 签名密钥，生产环境必须通过环境变量注入强随机值
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change-me-in-production")

    # Phase 3: the learner model is opt-in until the P0 evidence gate is
    # manually accepted.  Keep the public API available as a neutral envelope
    # while this flag is false.
    LEARNER_MODEL_ENABLED: bool = os.getenv("LEARNER_MODEL_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }
    LEARNER_MODEL_DEBUG: bool = os.getenv("LEARNER_MODEL_DEBUG", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }
    APP_ENV: str = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).strip().lower()

    # Neo4j Aura（与 ai-math 共用同一个实例）
    NEO4J_URI: str = os.getenv("NEO4J_URI", "")
    NEO4J_USER: str = os.getenv("NEO4J_USER", "")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "")

    MANIM_REDIS_URL: str = os.getenv("MANIM_REDIS_URL", "redis://127.0.0.1:6379/0")
    MANIM_QUEUE: str = os.getenv("MANIM_QUEUE", "learnmath-manim")
    MANIM_RENDER_DIR: Path = Path(os.getenv("MANIM_RENDER_DIR", str(DATA_DIR / "manim")))
    MANIM_SPOOL_DIR: Path = Path(os.getenv("MANIM_SPOOL_DIR", str(DATA_DIR / "manim-spool")))
    MANIM_RENDER_POLL_SECONDS: float = float(os.getenv("MANIM_RENDER_POLL_SECONDS", "0.5"))
    MANIM_MAX_QUEUE: int = int(os.getenv("MANIM_MAX_QUEUE", "2"))
    MANIM_MAX_SOURCE_BYTES: int = int(os.getenv("MANIM_MAX_SOURCE_BYTES", "120000"))
    MANIM_MAX_DURATION_SECONDS: float = float(os.getenv("MANIM_MAX_DURATION_SECONDS", "12"))
    MANIM_RENDER_TIMEOUT_SECONDS: int = int(os.getenv("MANIM_RENDER_TIMEOUT_SECONDS", "90"))
    MANIM_MAX_OUTPUT_BYTES: int = int(os.getenv("MANIM_MAX_OUTPUT_BYTES", "26214400"))


config = Config()
