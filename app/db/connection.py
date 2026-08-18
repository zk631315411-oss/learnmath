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
    ]:
        try:
            cursor.execute(f"ALTER TABLE chat_history ADD COLUMN {col} {col_type}")
        except Exception:
            # 列已存在时 ALTER 必然失败，这是预期的幂等分支而非异常
            pass

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

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_evidence_user_node ON evidence_turns(user_id, node_id)
    """)

    conn.commit()
    conn.close()
