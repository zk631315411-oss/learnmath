"""chat_history 表 CRUD — 阶段 1 精简版：只保留增删改查与匿名→登录迁移。"""
import json
import logging
import uuid
from typing import List, Optional

from app.db.connection import get_conn


logger = logging.getLogger("learnmath.migration")


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
    "title",
}


def _parse_follow_ups(value) -> list[dict]:
    """Decode the legacy JSON column into the one shape mutation code needs."""
    try:
        parsed = json.loads(value or "[]")
    except (json.JSONDecodeError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _mutate_follow_ups(chat_id: str, mutator) -> Optional[dict]:
    """Atomically load, mutate, and persist a chat's follow-up list.

    ``mutator`` returns ``None`` for a missing turn, or ``(value, changed)``
    for a successful operation.  A false ``changed`` result rolls back while
    still returning the existing value (used by idempotent appends).
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
        follow_ups = _parse_follow_ups(row["follow_ups"])
        mutation = mutator(follow_ups)
        if mutation is None:
            conn.rollback()
            return None
        result, changed = mutation
        if changed:
            conn.execute(
                "UPDATE chat_history SET follow_ups=? WHERE id=?",
                (json.dumps(follow_ups, ensure_ascii=False), chat_id),
            )
            conn.commit()
        else:
            conn.rollback()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


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

    def mutate(follow_ups: list[dict]):
        if turn_id:
            for existing in follow_ups:
                if isinstance(existing, dict) and existing.get("turn_id") == turn_id:
                    return existing, False
        follow_ups.append(turn)
        return turn, True

    return _mutate_follow_ups(chat_id, mutate)


def update_follow_up(chat_id: str, turn_id: str, fields: dict) -> Optional[dict]:
    """按 chat_id + turn_id 更新单条追问的字段（None → JSON null），返回更新后的 turn。

    chat_id 或 turn_id 未命中返回 None（路由层转 404）。BEGIN IMMEDIATE 串行化并发写。
    """
    def mutate(follow_ups: list[dict]):
        target = next(
            (item for item in follow_ups
             if isinstance(item, dict) and item.get("turn_id") == turn_id),
            None,
        )
        if target is None:
            return None
        target.update(fields)
        return target, True

    return _mutate_follow_ups(chat_id, mutate)


def delete_chat_history(chat_id: str, user_id: str | None = None) -> bool:
    """Delete a chat and its persisted animation artifacts."""
    artifact_ids: list[str] = []
    conn = get_conn()
    try:
        where = "chat_id=?" + (" AND user_id=?" if user_id is not None else "")
        params = (chat_id, user_id) if user_id is not None else (chat_id,)
        artifact_ids = [str(row[0]) for row in conn.execute(
            f"SELECT id FROM manim_artifacts WHERE {where}", params,
        ).fetchall()]
        conn.execute(f"DELETE FROM manim_artifacts WHERE {where}", params)
        chat_where = "id=?" + (" AND user_id=?" if user_id is not None else "")
        cursor = conn.execute(f"DELETE FROM chat_history WHERE {chat_where}", params)
        conn.commit()
    finally:
        conn.close()
    if artifact_ids:
        from app.services.manim_queue import clear_artifact_files
        for artifact_id in artifact_ids:
            clear_artifact_files(artifact_id, permanent=True)
    return cursor.rowcount == 1


def migrate_user_id(old_user_id: str, new_user_id: str) -> int:
    """在同一事务中迁移聊天记录和可安全迁入的 evidence。

    ``evidence_turns`` has a partial unique key on
    ``(user_id, client_turn_id, node_id)``.  Anonymous and registered users
    can therefore contain the same logical turn.  We explicitly retain the
    registered row, leave the conflicting source row intact, and record an
    audit row instead of relying on SQLite's ``UPDATE`` error/ignore behavior.
    The return value remains the historical chat-row count for API
    compatibility.
    """
    conn = get_conn()
    try:
        try:
            if old_user_id == new_user_id:
                return 0
            old_rows = conn.execute(
                "SELECT * FROM evidence_turns WHERE user_id=? ORDER BY created_at ASC, id ASC",
                (old_user_id,),
            ).fetchall()
            target_keys = {
                (str(row["client_turn_id"]), str(row["node_id"]))
                for row in conn.execute(
                    "SELECT client_turn_id,node_id FROM evidence_turns WHERE user_id=? AND client_turn_id IS NOT NULL",
                    (new_user_id,),
                ).fetchall()
            }
            affected_textbooks: set[str] = set()
            migrated_evidence = 0
            skipped_evidence = 0
            for row in old_rows:
                client_turn_id = row["client_turn_id"]
                node_id = str(row["node_id"] or "")
                key = (str(client_turn_id), node_id) if client_turn_id is not None else None
                if key is not None and key in target_keys:
                    skipped_evidence += 1
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO evidence_migration_skips
                          (id,old_user_id,new_user_id,evidence_id,client_turn_id,node_id,reason)
                        VALUES (?,?,?,?,?,?,?)
                        """,
                        (
                            f"{old_user_id}:{new_user_id}:{row['id']}",
                            old_user_id, new_user_id, str(row["id"]),
                            str(client_turn_id), node_id, "target_unique_key_exists",
                        ),
                    )
                    continue
                conn.execute(
                    "UPDATE evidence_turns SET user_id=? WHERE id=? AND user_id=?",
                    (new_user_id, row["id"], old_user_id),
                )
                migrated_evidence += 1
                if key is not None:
                    target_keys.add(key)
                textbook_id = str(row["textbook_id"] or "").strip()
                if textbook_id:
                    affected_textbooks.add(textbook_id)

            cursor = conn.execute(
                "UPDATE chat_history SET user_id=? WHERE user_id=?",
                (new_user_id, old_user_id)
            )
            count = cursor.rowcount
            conn.execute(
                "UPDATE manim_artifacts SET user_id=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?",
                (new_user_id, old_user_id),
            )
            # Keep historical learner-model runs attached to the anonymous
            # identity as migration audit evidence.  The registered identity
            # receives a new run after its merged evidence is replayed.
            if migrated_evidence or skipped_evidence:
                conn.execute(
                    "UPDATE learner_node_estimates SET stale=1 WHERE user_id IN (?, ?)",
                    (old_user_id, new_user_id),
                )
            for textbook_id in sorted(affected_textbooks):
                if migrated_evidence:
                    target_revision_row = conn.execute(
                        "SELECT revision FROM learning_progress_revisions WHERE user_id=? AND textbook_id=?",
                        (new_user_id, textbook_id),
                    ).fetchone()
                    next_revision = int(target_revision_row[0]) + 1 if target_revision_row else 1
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
            if skipped_evidence:
                logger.warning(
                    "learner migration retained %d conflicting evidence rows old=%s new=%s",
                    skipped_evidence, old_user_id, new_user_id,
                )
        except Exception:
            conn.rollback()
            raise
    finally:
        conn.close()
    # The evidence merge is the source-of-truth transaction.  Rebuild derived
    # snapshots only after it commits, and never make account migration fail
    # because a model/catalog replay is unavailable.
    if (migrated_evidence or skipped_evidence) and affected_textbooks:
        from app.config import config

        if config.LEARNER_MODEL_ENABLED:
            from app.db.learner_model_db import replay_user_textbook

            for textbook_id in sorted(affected_textbooks):
                try:
                    replay_user_textbook(new_user_id, textbook_id)
                except Exception:
                    logger.exception(
                        "learner migration replay failed old=%s new=%s textbook=%s",
                        old_user_id, new_user_id, textbook_id,
                    )
    return count
