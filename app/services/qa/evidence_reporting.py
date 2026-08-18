"""自评证据的收集、校验与落库 — 阶段 2 P0 后端证据回路。

answer_service 在工具执行环节调用本模块：从本轮的 retrieve_kg_context
resolved 结果 + 本线程已存 chat_history.tool_activities 中合并出合法的
node_id 集合，校验 report_turn_outcome 上报的 node_id 后落 evidence_turns。
落库异常只记日志、绝不向上抛（ADR-001：诊断不拖垮问答）。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.db import evidence_db

# 统一 logger：P3 用日志统计上报率/非法丢弃数，三处计数共享同一命名空间
logger = logging.getLogger("learnmath.evidence")


def summarize_turn_metrics(records: list[dict[str, Any]]) -> dict[str, float | int]:
    """Aggregate fork health by distinct eligible QA turn, never by evidence row."""
    turns: dict[str, dict[str, Any]] = {}
    for record in records:
        turn_id = str(record.get("qa_turn_id") or "")
        if not turn_id:
            continue
        current = turns.setdefault(turn_id, {
            "eligible": False,
            "fork_attempted": False,
            "fork_tool_succeeded": False,
            "evidence_persisted": 0,
        })
        current["eligible"] = current["eligible"] or bool(record.get("eligible"))
        current["fork_attempted"] = current["fork_attempted"] or bool(record.get("fork_attempted"))
        current["fork_tool_succeeded"] = (
            current["fork_tool_succeeded"] or bool(record.get("fork_tool_succeeded"))
        )
        current["evidence_persisted"] = max(int(current["evidence_persisted"]), int(record.get("evidence_persisted") or 0))
    eligible = [value for value in turns.values() if value["eligible"]]
    denominator = len(eligible)
    attempted_count = sum(bool(value["fork_attempted"]) for value in eligible)
    tool_success_count = sum(bool(value["fork_tool_succeeded"]) for value in eligible)
    persistence_count = sum(int(value["evidence_persisted"]) > 0 for value in eligible)
    return {
        "eligible_turns": denominator,
        "fork_attempt_rate": attempted_count / denominator if denominator else 0.0,
        "fork_tool_success_rate": tool_success_count / denominator if denominator else 0.0,
        "effective_persistence": persistence_count / denominator if denominator else 0.0,
    }


def extract_resolved_node_ids(activities: list[dict[str, Any]]) -> set[str]:
    """从工具活动列表（已解析的 dict）提取 resolved 结果中的全部 KG node_id。

    resolved 结果里 node_id 出现在选中节点与各关系组的 node 上；这些节点
    都是检索真实返回的 KG 稳定 id，均可作为自报的合法来源。
    """
    resolved: set[str] = set()
    for activity in activities:
        if not isinstance(activity, dict):
            continue
        if activity.get("tool") != "retrieve_kg_context":
            continue
        result = activity.get("result")
        if not isinstance(result, dict):
            continue
        if result.get("status") != "resolved":
            continue
        node = result.get("selected_node")
        if isinstance(node, dict) and node.get("node_id"):
            resolved.add(str(node["node_id"]))
    return resolved


def _parse_activity_json(text: Any) -> list[dict[str, Any]]:
    """把 DB 里的 TEXT 字段解析成活动列表；坏数据返回空列表（不因历史脏数据中断）。"""
    if not text:
        return []
    try:
        value = json.loads(text) if isinstance(text, str) else text
    except (json.JSONDecodeError, TypeError):
        return []
    return value if isinstance(value, list) else []


def load_thread_resolved_node_ids(chat_id: str | None, user_id: str) -> set[str]:
    """从本线程已存的 chat_history 恢复 resolved node_id 集合。

    线程 = 主徽标行 + 其 follow_ups；两者的 tool_activities 都算本线程 resolved。
    chat_id 为空或读取失败时返回空集（只依赖本轮结果，不阻断自评）。
    """
    if not chat_id:
        return set()
    try:
        from app.db.chat_history_db import get_chat_history

        rows = get_chat_history(user_id, chat_id=chat_id)
    except Exception:
        # 历史读取失败不阻断本轮自评：仍可用本轮 resolved 结果校验
        logger.exception("evidence: 读取线程 %s 历史工具活动失败", chat_id)
        return set()
    resolved: set[str] = set()
    for row in rows:
        resolved |= extract_resolved_node_ids(_parse_activity_json(row.get("tool_activities")))
        for follow_up in _parse_activity_json(row.get("follow_ups")):
            if isinstance(follow_up, dict):
                resolved |= extract_resolved_node_ids(
                    _parse_activity_json(follow_up.get("tool_activities"))
                )
    return resolved


def _node_prefix_ok(node_id: str, textbook_id: str | None) -> bool:
    """校验 node_id 前缀与当前问答上下文绑定教材一致。"""
    clean = (textbook_id or "").strip()
    if not clean:
        # 未绑定单一教材时无法做前缀校验，放行（与 retrieve_kg_context 同一既定约定）
        return True
    return node_id.startswith(f"{clean}:")


def validate_and_report(
    *,
    user_id: str,
    chat_id: str | None,
    qa_turn_id: str,
    textbook_id: str | None,
    node_ids: list[str],
    scaffolding_level: int,
    outcome: str,
    turn_resolved_node_ids: set[str],
    thread_resolved_node_ids: set[str],
    report_path: str = "evidence_fork",
) -> int:
    """校验并落库一次 report_turn_outcome 上报，返回实际写入的行数。

    校验规则（任一不满足整体丢弃该 node 并记日志，不落库）：
      1. node_id 必须在「本轮 resolved ∪ 线程历史 resolved」集合中；
      2. node_id 前缀须与绑定教材一致。
    落库异常统一 try/except 记日志，绝不向调用链抛出。
    """
    valid_ids: list[str] = []
    allowed = turn_resolved_node_ids | thread_resolved_node_ids
    for node_id in node_ids:
        if node_id not in allowed:
            logger.info(
                "learnmath.evidence: 非法 node_id 丢弃 user=%s node=%s",
                user_id, node_id,
            )
            continue
        if not _node_prefix_ok(node_id, textbook_id):
            logger.info(
                "learnmath.evidence: 教材前缀不匹配丢弃 user=%s node=%s textbook=%s",
                user_id, node_id, textbook_id,
            )
            continue
        valid_ids.append(node_id)

    if not valid_ids:
        return 0

    rows = [
        {
            "user_id": user_id,
            "chat_id": chat_id,
            "qa_turn_id": qa_turn_id,
            "node_id": node_id,
            "textbook_id": textbook_id,
            "scaffolding_level": scaffolding_level,
            "outcome": outcome,
            "source": "agent_self_report",
            "report_path": report_path,
        }
        for node_id in valid_ids
    ]
    try:
        evidence_db.insert_evidence_rows(rows)
        return len(rows)
    except Exception:
        # 证据丢失不阻断回答：仅记日志，确保 SSE 流照常结束
        logger.exception(
            "learnmath.evidence: 证据落库失败 user=%s nodes=%s", user_id, valid_ids,
        )
        return 0
