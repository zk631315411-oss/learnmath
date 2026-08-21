import sqlite3
from typing import Optional
from app.db.connection import get_conn


def save_user(user_id: str, username: str, password_hash: str, device_id: str, is_anonymous: bool = False) -> bool:
    """创建新用户，返回是否成功（用户名已存在返回False）"""
    conn = get_conn()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO users (id, username, password_hash, device_id, is_anonymous)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, username, password_hash, device_id, int(is_anonymous)))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def get_user_by_username(username: str) -> Optional[dict]:
    """根据用户名查找用户"""
    conn = get_conn()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return dict(row)


def get_user_by_id(user_id: str) -> Optional[dict]:
    """根据用户ID查找用户"""
    conn = get_conn()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return dict(row)


def get_user_by_device_id(device_id: str) -> Optional[dict]:
    """根据设备 ID 查找匿名用户（正式账号不参与匿名恢复）。"""
    conn = get_conn()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT * FROM users WHERE device_id = ? AND is_anonymous = 1 "
        "ORDER BY created_at DESC LIMIT 1",
        (device_id,),
    )
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return dict(row)
