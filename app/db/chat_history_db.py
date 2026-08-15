"""chat_history 表 CRUD — 阶段 1 精简版：只保留增删改查与匿名→登录迁移。"""
import uuid
from typing import List, Optional

from app.db.connection import get_conn


def _uid():
    return str(uuid.uuid4())


def get_chat_history(user_id: str, limit: int = 50,
                     page_number: Optional[int] = None,
                     chat_id: Optional[str] = None) -> List[dict]:
    """查询聊天历史：按 id 精确查 / 按页码查 / 按用户最近查。"""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        if chat_id:
            cursor.execute("SELECT * FROM chat_history WHERE id=?", (chat_id,))
        elif page_number is not None:
            cursor.execute("""
                SELECT * FROM chat_history
                WHERE user_id=? AND page_number=?
                ORDER BY created_at ASC LIMIT ?
            """, (user_id, page_number, limit))
        else:
            cursor.execute("""
                SELECT * FROM chat_history
                WHERE user_id=?
                ORDER BY created_at DESC LIMIT ?
            """, (user_id, limit))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def save_chat_history(user_id: str, question: str, answer: Optional[str] = None,
                      page_number: Optional[int] = None,
                      marker_y_ratio: Optional[float] = None,
                      marker_type: str = "screenshot",
                      thumbnail: Optional[str] = None,
                      crop_bbox: Optional[str] = None,
                      screenshot_context_id: Optional[str] = None,
                      sources: Optional[str] = None,
                      knowledge_points: Optional[str] = None,
                      thinking: Optional[str] = None,
                      tool_activities: Optional[str] = None,
                      follow_ups: str = "[]") -> str:
    """插入一条问答记录，返回 chat_id；answer 可为空（SSE 完成后再补）。"""
    chat_id = _uid()
    conn = get_conn()
    try:
        conn.execute("""
            INSERT INTO chat_history (id, user_id, question, answer, page_number,
                                      marker_y_ratio, marker_type, thumbnail, sources, knowledge_points,
                                      crop_bbox, screenshot_context_id, thinking, tool_activities,
                                      follow_ups)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (chat_id, user_id, question, answer or '', page_number, marker_y_ratio,
              marker_type, thumbnail, sources, knowledge_points,
              crop_bbox, screenshot_context_id, thinking, tool_activities, follow_ups))
        conn.commit()
    finally:
        conn.close()
    return chat_id


def update_chat_answer(
    chat_id: str,
    answer: Optional[str] = None,
    screenshot_context_id: Optional[str] = None,
    thumbnail: Optional[str] = None,
    crop_bbox: Optional[str] = None,
    thinking: Optional[str] = None,
    tool_activities: Optional[str] = None,
    follow_ups: Optional[str] = None,
):
    """SSE 完成后回填 answer / 截图上下文等字段（只更新显式传入的字段）。"""
    sets = []
    params = []
    if answer is not None:
        sets.append("answer=?")
        params.append(answer)
    if screenshot_context_id is not None:
        sets.append("screenshot_context_id=?")
        params.append(screenshot_context_id)
    if thumbnail is not None:
        sets.append("thumbnail=?")
        params.append(thumbnail)
    if crop_bbox is not None:
        sets.append("crop_bbox=?")
        params.append(crop_bbox)
    if thinking is not None:
        sets.append("thinking=?")
        params.append(thinking)
    if tool_activities is not None:
        sets.append("tool_activities=?")
        params.append(tool_activities)
    if follow_ups is not None:
        sets.append("follow_ups=?")
        params.append(follow_ups)
    if not sets:
        return
    params.append(chat_id)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE chat_history SET {', '.join(sets)} WHERE id=?", params)
        conn.commit()
    finally:
        conn.close()


def delete_chat_history(chat_id: str):
    """删除单条记录；阶段 1 无可视化/工具痕迹联动，只删 chat_history 本身。"""
    conn = get_conn()
    try:
        conn.execute("DELETE FROM chat_history WHERE id=?", (chat_id,))
        conn.commit()
    finally:
        conn.close()


def migrate_user_id(old_user_id: str, new_user_id: str) -> int:
    """匿名→登录后迁移 chat_history 记录到新账号，返回迁移条数。"""
    conn = get_conn()
    try:
        cursor = conn.execute(
            "UPDATE chat_history SET user_id=? WHERE user_id=?",
            (new_user_id, old_user_id)
        )
        count = cursor.rowcount
        conn.commit()
    finally:
        conn.close()
    return count
