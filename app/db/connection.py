import sqlite3

from app.config import config


def get_conn():
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def init_db():
    conn = get_conn()
    cursor = conn.cursor()

    # WAL 模式：多读一写并发，reader 与 writer 互不阻塞
    cursor.execute("PRAGMA journal_mode=WAL")

    # 用户画像表：匿名/注册用户的基础资料（认证闭环依赖它）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY,
            grade TEXT,
            weak_points TEXT DEFAULT '[]',
            strong_points TEXT DEFAULT '[]',
            learning_preferences TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # 问答历史表：根问答一条记录，后续原始对话保存在 follow_ups 中。
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_history (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            sources TEXT,
            knowledge_points TEXT,
            page_number INTEGER,
            textbook_id TEXT,
            marker_y_ratio REAL,
            marker_type TEXT DEFAULT 'screenshot',
            thumbnail TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Phase 2 遗留迁移：给旧 chat_history 表补字段（幂等，已存在则跳过）
    # generation_* / client_turn_id（Batch 1 生成状态契约）：
    # generation_status 带常量默认值，历史行自动迁为 completed；
    # generation_updated_at 不能用非常量 DEFAULT，历史行在下方回灌为 created_at。
    for col, col_type in [
        ("page_number", "INTEGER"),
        ("marker_y_ratio", "REAL"),
        ("marker_type", "TEXT DEFAULT 'screenshot'"),
        ("thumbnail", "TEXT"),
        ("crop_bbox", "TEXT"),
        ("screenshot_context_id", "TEXT"),
        ("thinking", "TEXT"),
        ("tool_activities", "TEXT"),
        ("follow_ups", "TEXT DEFAULT '[]'"),
        ("textbook_id", "TEXT"),
        ("generation_status", "TEXT NOT NULL DEFAULT 'completed'"),
        ("generation_error", "TEXT"),
        ("generation_updated_at", "TEXT"),
        ("client_turn_id", "TEXT"),
        ("title", "TEXT"),
    ]:
        try:
            cursor.execute(f"ALTER TABLE chat_history ADD COLUMN {col} {col_type}")
        except Exception:
            # 列已存在时 ALTER 必然失败，这是预期的幂等分支而非异常
            pass
    # 历史行回灌生成时间戳（幂等：只动 NULL 行）
    cursor.execute(
        "UPDATE chat_history SET generation_updated_at=created_at "
        "WHERE generation_updated_at IS NULL"
    )

    # 用户账号表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            device_id TEXT NOT NULL,
            is_anonymous INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 兼容历史库：早期建表缺 is_anonymous 列时补上
    if "is_anonymous" not in {row[1] for row in cursor.execute("PRAGMA table_info(users)").fetchall()}:
        cursor.execute("ALTER TABLE users ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0")
    # 一个设备最多对应一个匿名身份；正式账号仍可复用同一 device_id。
    # 部分唯一索引兼容已有正式账号和历史数据。
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_anonymous_device_id "
        "ON users(device_id) WHERE is_anonymous=1"
    )

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id)
    """)

    # 截图上下文缓存表：同一截图不重复走 VL 提取，按指纹复用
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS screenshot_context_cache (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            image_hash TEXT NOT NULL,
            textbook_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            crop_bbox TEXT,
            crop_bbox_hash TEXT,
            full_context_hash TEXT,
            pdf_crop_path TEXT,
            md_match_status TEXT,
            md_match_confidence REAL,
            md_match_text TEXT,
            locator_signals TEXT,
            vision_summary TEXT,
            vision_extraction TEXT,
            extraction_version TEXT,
            vision_model TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 兼容历史库：补缺的列（幂等）
    for column, definition in (
        ("user_id", "TEXT"),
        ("vision_extraction", "TEXT"),
        ("extraction_version", "TEXT"),
    ):
        try:
            cursor.execute(f"ALTER TABLE screenshot_context_cache ADD COLUMN {column} {definition}")
        except Exception:
            # 列已存在时 ALTER 必然失败，这是预期的幂等分支而非异常
            pass

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_screenshot_cache_lookup
        ON screenshot_context_cache(image_hash, textbook_id, page_number, crop_bbox_hash, full_context_hash)
    """)

    # 自评证据账本表（阶段 2：请求内 one-shot 分叉上报节点掌握状态）
    # 与 chat_history 解耦：删除提问记录不级联删除学习痕迹（见计划 §1.4 决策 5）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS evidence_turns (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          chat_id TEXT,
          qa_turn_id TEXT,
          node_id TEXT NOT NULL,
          textbook_id TEXT,
          scaffolding_level INTEGER,
          outcome TEXT NOT NULL,
          source TEXT NOT NULL,
          report_path TEXT NOT NULL,
          model_version TEXT,
          created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
        )
    """)

    evidence_columns = {
        row[1] for row in cursor.execute("PRAGMA table_info(evidence_turns)").fetchall()
    }
    if "report_path" not in evidence_columns:
        cursor.execute("ALTER TABLE evidence_turns ADD COLUMN report_path TEXT")
        cursor.execute(
            "UPDATE evidence_turns SET report_path='unknown' WHERE report_path IS NULL"
        )
    # Batch 1：client_turn_id 是前端生成的稳定逻辑 turn 身份，用于重试幂等。
    # 历史行该列为 NULL；SQLite 唯一索引中 NULL 互不相等，不会误伤老数据。
    if "client_turn_id" not in evidence_columns:
        cursor.execute("ALTER TABLE evidence_turns ADD COLUMN client_turn_id TEXT")

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_evidence_user_node ON evidence_turns(user_id, node_id)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_evidence_user_textbook_created
        ON evidence_turns(user_id, textbook_id, created_at, id)
    """)
    # 同一逻辑 turn（client_turn_id）重试不得重复写同一节点证据（部分唯一索引，
    # 仅约束有 client_turn_id 的新数据，NULL 历史行不参与）。
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_client_turn_node
        ON evidence_turns(user_id, client_turn_id, node_id)
        WHERE client_turn_id IS NOT NULL
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS learning_progress_revisions (
          user_id TEXT NOT NULL,
          textbook_id TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          PRIMARY KEY (user_id, textbook_id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS manim_artifacts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          chat_id TEXT,
          client_turn_id TEXT,
          title TEXT NOT NULL,
          rationale TEXT NOT NULL DEFAULT '',
          source_code TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          rq_job_id TEXT,
          attempt INTEGER NOT NULL DEFAULT 0,
          repair_count INTEGER NOT NULL DEFAULT 0,
          duration_seconds REAL NOT NULL DEFAULT 12,
          quality TEXT NOT NULL DEFAULT 'low',
          video_path TEXT,
          poster_path TEXT,
          error_code TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_manim_artifacts_user ON manim_artifacts(user_id, created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_manim_artifacts_chat ON manim_artifacts(chat_id, created_at)")
    manim_columns = {row[1] for row in cursor.execute("PRAGMA table_info(manim_artifacts)").fetchall()}
    if "rq_job_id" not in manim_columns:
        cursor.execute("ALTER TABLE manim_artifacts ADD COLUMN rq_job_id TEXT")
    if "repair_count" not in manim_columns:
        cursor.execute("ALTER TABLE manim_artifacts ADD COLUMN repair_count INTEGER NOT NULL DEFAULT 0")
    if "duration_seconds" not in manim_columns:
        cursor.execute("ALTER TABLE manim_artifacts ADD COLUMN duration_seconds REAL NOT NULL DEFAULT 12")
    if "quality" not in manim_columns:
        cursor.execute("ALTER TABLE manim_artifacts ADD COLUMN quality TEXT NOT NULL DEFAULT 'low'")

    conn.commit()
    conn.close()
