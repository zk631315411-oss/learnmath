"""evidence_turns 表读写层 — 阶段 2 自评证据账本。

请求内 one-shot 证据分叉调用 report_turn_outcome 上报节点掌握状态，
校验通过后由 answer_service 写入这里的 evidence_turns 表。
本模块只负责「写一行 / 读一组行」，不做任何地图投影（投影属 P1）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.db.connection import get_conn


def insert_evidence_rows(rows: list[dict[str, Any]]) -> None:
    """批量插入证据行：每节点一行，同一 qa_turn_id 多行。

    rows 中每项须含 user_id / node_id / outcome / source 等字段；
    id 与 created_at 未提供时由本函数补默认值（保持与建表 DEFAULT 一致）。
    落库失败抛出异常，由调用方（answer_service）捕获并仅记日志，
    不得向工具执行链或 SSE 回答流传播（ADR-001：诊断不拖垮问答）。
    """
    conn = get_conn()
    try:
        for row in rows:
            created_at = row.get("created_at") or datetime.now(timezone.utc).isoformat(timespec="microseconds")
            conn.execute(
                """
                INSERT INTO evidence_turns
                    (id, user_id, chat_id, qa_turn_id, node_id, textbook_id,
                     scaffolding_level, outcome, source, report_path, model_version, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row.get("id") or str(uuid.uuid4()),
                    row["user_id"],
                    row.get("chat_id"),
                    row.get("qa_turn_id"),
                    row["node_id"],
                    row.get("textbook_id"),
                    row.get("scaffolding_level"),
                    row["outcome"],
                    row.get("source") or "agent_self_report",
                    row.get("report_path") or "evidence_fork",
                    row.get("model_version"),
                    created_at,
                ),
            )
        conn.commit()
    finally:
        conn.close()


def list_evidence_for_user_node(user_id: str, node_id: str) -> list[dict[str, Any]]:
    """按 user_id + node_id 查询证据行，按 created_at 时间序（最早在前）。"""
    conn = get_conn()
    try:
        cursor = conn.execute(
            "SELECT * FROM evidence_turns WHERE user_id=? AND node_id=? ORDER BY created_at ASC, id ASC",
            (user_id, node_id),
        )
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def list_evidence_for_user(
    user_id: str, textbook_id: Optional[str] = None
) -> list[dict[str, Any]]:
    """查询某用户全部证据行（供 P1 地图聚合用），可按 textbook_id 过滤。

    textbook_id 为空字符串或 None 时不追加过滤（聚合全部教材）。
    """
    conn = get_conn()
    try:
        sql = "SELECT * FROM evidence_turns WHERE user_id=?"
        params: list[Any] = [user_id]
        clean = (textbook_id or "").strip()
        if clean:
            sql += " AND textbook_id=?"
            params.append(clean)
        sql += " ORDER BY created_at ASC, id ASC"
        cursor = conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()
