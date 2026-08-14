import json
from typing import List, Optional
from app.db.connection import get_conn


def save_user_profile(user_id: str, grade: str = None, weak_points: List[str] = None,
                      strong_points: List[str] = None, learning_preferences: dict = None) -> bool:
    """创建或更新用户画像"""
    conn = get_conn()
    cursor = conn.cursor()

    weak_str = json.dumps(weak_points, ensure_ascii=False) if weak_points else None
    strong_str = json.dumps(strong_points, ensure_ascii=False) if strong_points else None
    pref_str = json.dumps(learning_preferences, ensure_ascii=False) if learning_preferences else None

    cursor.execute("SELECT user_id FROM user_profiles WHERE user_id = ?", (user_id,))
    exists = cursor.fetchone() is not None

    if not exists:
        cursor.execute("""
            INSERT INTO user_profiles (user_id, grade, weak_points, strong_points, learning_preferences, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (user_id, grade or "", weak_str or "[]", strong_str or "[]", pref_str or "{}"))
    else:
        if grade is not None or weak_points is not None or strong_points is not None or learning_preferences is not None:
            cursor.execute("""
                UPDATE user_profiles
                SET grade = COALESCE(?, grade),
                    weak_points = COALESCE(?, weak_points),
                    strong_points = COALESCE(?, strong_points),
                    learning_preferences = COALESCE(?, learning_preferences),
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            """, (grade, weak_str, strong_str, pref_str, user_id))

    conn.commit()
    conn.close()
    return True


def get_user_profile(user_id: str) -> Optional[dict]:
    """获取用户画像"""
    conn = get_conn()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return {
        "user_id": row["user_id"],
        "grade": row["grade"] or "",
        "weak_points": json.loads(row["weak_points"] or "[]"),
        "strong_points": json.loads(row["strong_points"] or "[]"),
        "learning_preferences": json.loads(row["learning_preferences"] or "{}"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"]
    }
