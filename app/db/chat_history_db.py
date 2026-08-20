"""chat_history 表 CRUD — 阶段 1 精简版：只保留增删改查与匿名→登录迁移。"""
import json
import uuid
from typing import List, Optional

from app.db.connection import get_conn


def _uid():
    return str(uuid.uuid4())


def get_chat_history(user_id: str, limit: int = 50,
                     page_number: Optional[int] = None,
                     chat_id: Optional[str] = None,
                     textbook_id: Optional[str] = None) -> List[dict]:
    """查询聊天历史：按 id 精确查 / 按页码查 / 按用户最近查。

    textbook_id 传入时追加教材过滤：新数据按教材精确归属，老数据
    （textbook_id IS NULL）保持所有教材可见（不回填策略的兼容行为）。
    """
    conn = get_conn()
    try:
        cursor = conn.cursor()
        if chat_id:
            # 精确恢复不受教材过滤影响，但记录必须属于当前用户。
            cursor.execute(
                "SELECT * FROM chat_history WHERE id=? AND user_id=?",
                (chat_id, user_id),
            )
        elif page_number is not None:
            sql = """
                SELECT * FROM chat_history
                WHERE user_id=? AND page_number=?
            """
            params = [user_id, page_number]
            if textbook_id is not None:
                sql += " AND (textbook_id = ? OR textbook_id IS NULL)"
                params.append(textbook_id)
            sql += " ORDER BY created_at ASC LIMIT ?"
            params.append(limit)
            cursor.execute(sql, params)
        else:
            sql = "SELECT * FROM chat_history WHERE user_id=?"
            params = [user_id]
            if textbook_id is not None:
                sql += " AND (textbook_id = ? OR textbook_id IS NULL)"
                params.append(textbook_id)
            sql += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)
            cursor.execute(sql, params)
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
                      follow_ups: str = "[]",
                      textbook_id: Optional[str] = None,
                      client_turn_id: Optional[str] = None,
                      generation_status: Optional[str] = None) -> str:
    """插入一条问答记录，返回 chat_id；answer 可为空（SSE 完成后再补）。

    textbook_id 为空时落 NULL（老数据语义：所有教材可见）。
    generation_status 缺省按 answer 推导：有正文为 completed，否则为 pending
    （新根问题先落 pending，SSE 收尾再 PATCH 终态）。
    """
    chat_id = _uid()
    status = generation_status or ("completed" if answer else "pending")
    conn = get_conn()
    try:
        # client_turn_id 是前端重试幂等键。写锁内先查再插，避免同一用户同一逻辑
        # turn 在双击/网络重试时产生两条根记录；老调用不带该字段，保持原行为。
        if client_turn_id:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(
                "SELECT id FROM chat_history WHERE user_id=? AND client_turn_id=? LIMIT 1",
                (user_id, client_turn_id),
            ).fetchone()
            if existing is not None:
                conn.rollback()
                return str(existing[0])
        conn.execute("""
            INSERT INTO chat_history (id, user_id, question, answer, page_number,
                                      marker_y_ratio, marker_type, thumbnail, sources, knowledge_points,
                                      crop_bbox, screenshot_context_id, thinking, tool_activities,
                                      follow_ups, textbook_id,
                                      client_turn_id, generation_status, generation_updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (chat_id, user_id, question, answer or '', page_number, marker_y_ratio,
              marker_type, thumbnail, sources, knowledge_points,
              crop_bbox, screenshot_context_id, thinking, tool_activities, follow_ups,
              textbook_id, client_turn_id, status))
        conn.commit()
    finally:
        conn.close()
    return chat_id


# update_chat_record 允许更新的列白名单（防 SQL 注入与误写字段）
_UPDATABLE_COLUMNS = {
    "answer", "screenshot_context_id", "thumbnail", "crop_bbox",
    "thinking", "tool_activities", "follow_ups",
    "generation_status", "generation_error", "client_turn_id",
}


def update_chat_record(chat_id: str, fields: dict) -> None:
    """按显式字段集合更新：字段在 fields 中即写入（None → 显式置 NULL），未出现的不动。

    与旧的 update_chat_answer 的「None 等于未传」语义不同，本函数支持明确清空字段
    （如重试成功后清除 generation_error）。涉及生成状态字段时自动刷新
    generation_updated_at。
    """
    unknown = set(fields) - _UPDATABLE_COLUMNS
    if unknown:
        raise ValueError(f"chat_history 不允许更新的字段: {sorted(unknown)}")
    if not fields:
        return
    sets = [f"{name}=?" for name in fields]
    params = list(fields.values())
    if "generation_status" in fields or "generation_error" in fields:
        sets.append("generation_updated_at=CURRENT_TIMESTAMP")
    params.append(chat_id)
    conn = get_conn()
    try:
        conn.execute(f"UPDATE chat_history SET {', '.join(sets)} WHERE id=?", params)
        conn.commit()
    finally:
        conn.close()


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
    """兼容包装：保持旧的「None 等于未传」语义（只更新显式传入的非 None 字段）。

    新代码请用 update_chat_record（支持显式置 NULL）。
    """
    fields = {
        "answer": answer,
        "screenshot_context_id": screenshot_context_id,
        "thumbnail": thumbnail,
        "crop_bbox": crop_bbox,
        "thinking": thinking,
        "tool_activities": tool_activities,
        "follow_ups": follow_ups,
    }
    update_chat_record(chat_id, {k: v for k, v in fields.items() if v is not None})


def append_follow_up(chat_id: str, turn: dict) -> Optional[dict]:
    """按 turn_id 幂等追加一条追问到 follow_ups JSON，返回最终存储的 turn。

    - chat_id 不存在返回 None（路由层转 404）；
    - turn_id 已存在时不重复追加，直接返回既有项（重试/双击安全）；
    - BEGIN IMMEDIATE 先取写锁再读改写，串行化并发追加，避免整体 JSON 覆盖丢数据。
    """
    turn_id = turn.get("turn_id")
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT follow_ups FROM chat_history WHERE id=?", (chat_id,),
        ).fetchone()
        if row is None:
            conn.rollback()
            return None
        try:
            follow_ups = json.loads(row["follow_ups"] or "[]")
        except (json.JSONDecodeError, TypeError):
            follow_ups = []
        if not isinstance(follow_ups, list):
            follow_ups = []
        if turn_id:
            for existing in follow_ups:
                if isinstance(existing, dict) and existing.get("turn_id") == turn_id:
                    conn.rollback()
                    return existing
        follow_ups.append(turn)
        conn.execute(
            "UPDATE chat_history SET follow_ups=? WHERE id=?",
            (json.dumps(follow_ups, ensure_ascii=False), chat_id),
        )
        conn.commit()
        return turn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_follow_up(chat_id: str, turn_id: str, fields: dict) -> Optional[dict]:
    """按 chat_id + turn_id 更新单条追问的字段（None → JSON null），返回更新后的 turn。

    chat_id 或 turn_id 未命中返回 None（路由层转 404）。BEGIN IMMEDIATE 串行化并发写。
    """
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT follow_ups FROM chat_history WHERE id=?", (chat_id,),
        ).fetchone()
        if row is None:
            conn.rollback()
            return None
        try:
            follow_ups = json.loads(row["follow_ups"] or "[]")
        except (json.JSONDecodeError, TypeError):
            follow_ups = []
        if not isinstance(follow_ups, list):
            follow_ups = []
        target = None
        for item in follow_ups:
            if isinstance(item, dict) and item.get("turn_id") == turn_id:
                target = item
                break
        if target is None:
            conn.rollback()
            return None
        target.update(fields)
        conn.execute(
            "UPDATE chat_history SET follow_ups=? WHERE id=?",
            (json.dumps(follow_ups, ensure_ascii=False), chat_id),
        )
        conn.commit()
        return target
    except Exception:
        conn.rollback()
        raise
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
    """在同一事务中迁移聊天记录和 evidence，返回聊天记录迁移条数。"""
    conn = get_conn()
    try:
        try:
            affected_textbooks = [
                str(row[0])
                for row in conn.execute(
                    "SELECT DISTINCT textbook_id FROM evidence_turns WHERE user_id=? AND textbook_id IS NOT NULL AND textbook_id<>''",
                    (old_user_id,),
                ).fetchall()
            ]
            cursor = conn.execute(
                "UPDATE chat_history SET user_id=? WHERE user_id=?",
                (new_user_id, old_user_id)
            )
            count = cursor.rowcount
            conn.execute(
                "UPDATE evidence_turns SET user_id=? WHERE user_id=?",
                (new_user_id, old_user_id)
            )
            for textbook_id in affected_textbooks:
                revisions = [
                    int(row[0])
                    for row in conn.execute(
                        "SELECT revision FROM learning_progress_revisions WHERE textbook_id=? AND user_id IN (?, ?)",
                        (textbook_id, old_user_id, new_user_id),
                    ).fetchall()
                ]
                next_revision = max(revisions, default=0) + 1
                conn.execute(
                    """
                    INSERT INTO learning_progress_revisions (user_id, textbook_id, revision, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(user_id, textbook_id) DO UPDATE SET
                        revision=excluded.revision,
                        updated_at=CURRENT_TIMESTAMP
                    """,
                    (new_user_id, textbook_id, next_revision),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    finally:
        conn.close()
    return count
