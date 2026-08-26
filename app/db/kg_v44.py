"""Bounded, read-only retrieval for the v4.4 teaching knowledge graph."""

from __future__ import annotations

from collections import defaultdict
from contextlib import contextmanager
import re
from typing import Any, Iterable, Literal

from app.config import config


CORE_TYPES = ["Concept", "Theorem", "Formula", "Method", "ProblemClass"]
CANDIDATE_LIMIT = 12
DIRECTIONAL_RESULT_LIMIT = 15
OVERVIEW_RESULT_LIMIT = 5
MAX_FOCUS_FETCH_LIMIT = DIRECTIONAL_RESULT_LIMIT + 1
RULE_DETAIL_LIMIT = 80
EVIDENCE_LIMIT = 1600
_WRITE_CYPHER = re.compile(r"\b(?:CREATE|MERGE|SET|DELETE|DETACH|DROP|REMOVE)\b", re.IGNORECASE)
_CHAPTER_NUMBER = re.compile(r"^\s*(?:第\s*)?(\d+)\s*(?:章|[.．、])")
_INTRO_CHAPTER_PREFIXES = ("前言", "序言", "绪论", "引言", "导论")

RetrievalFocus = Literal[
    "prerequisites",
    "successors",
    "supporting",
    "applications",
    "rules",
    "structure",
    "overview",
]
FOCUS_VALUES = {
    "prerequisites",
    "successors",
    "supporting",
    "applications",
    "rules",
    "structure",
    "overview",
}
OVERVIEW_FOCUS: tuple[str, ...] = (
    "prerequisites",
    "successors",
    "supporting",
    "applications",
    "rules",
    "structure",
)
RELATION_FOCUS_TO_GROUP = {
    "prerequisites": "explicit_prerequisites",
    "successors": "explicit_successors",
    "supporting": "supporting_knowledge",
    "applications": "applications_and_extensions",
    "structure": "structural_context",
}
RELATION_FOCUS_TO_TYPES = {
    "prerequisites": {"PREREQUISITE_OF"},
    "successors": {"PREREQUISITE_OF"},
    "supporting": {"USES", "DERIVES", "GETS", "HAS_PROPERTY"},
    "applications": {"USES", "DERIVES", "GETS", "HAS_PROPERTY"},
    "structure": {"SUPERIOR", "PART_OF", "EQUATIVE"},
}

_DRIVER_INSTANCE = None


def _get_driver():
    global _DRIVER_INSTANCE
    if _DRIVER_INSTANCE is None:
        from neo4j import GraphDatabase

        _DRIVER_INSTANCE = GraphDatabase.driver(
            config.NEO4J_URI,
            auth=(config.NEO4J_USER, config.NEO4J_PASSWORD),
            connection_timeout=5.0,
            max_connection_pool_size=10,
        )
    return _DRIVER_INSTANCE


def _database() -> str | None:
    import os

    database = os.getenv("NEO4J_DATABASE", "neo4j")
    return None if database in {"", "neo4j", "default"} else database


@contextmanager
def _session():
    with _get_driver().session(database=_database()) as session:
        yield session


def _run(cypher: str, **parameters: Any) -> list[dict[str, Any]]:
    """Execute one read query and materialize records before closing the session."""
    if _WRITE_CYPHER.search(cypher):
        raise ValueError("KG retrieval accepts read-only Cypher")
    with _session() as session:
        return [dict(record) for record in session.run(cypher, **parameters)]


def _clean(value: Any, limit: int = EVIDENCE_LIMIT) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def _list_value(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [_clean(item, 240) for item in value if _clean(item, 240)]
    text = _clean(value, 240)
    return [text] if text else []


def _scope_parameters(textbook_id: str | None) -> dict[str, str]:
    clean_id = (textbook_id or "").strip()
    return {"textbook_id": clean_id, "book_prefix": f"{clean_id}:" if clean_id else ""}


def _chapter_sort_key(row: dict[str, Any]) -> tuple[int, int, str]:
    """Sort introductory headings first, then numbered chapters naturally."""
    chapter = str(row.get("chapter") or "").strip()
    if chapter.startswith(_INTRO_CHAPTER_PREFIXES):
        return (0, 0, chapter.casefold())
    match = _CHAPTER_NUMBER.match(chapter)
    if match:
        return (1, int(match.group(1)), chapter.casefold())
    return (2, 0, chapter.casefold())


def list_kg_chapters(textbook_id: str) -> list[dict[str, Any]]:
    """List real chapter buckets and their node counts for a textbook."""
    clean = (textbook_id or "").strip()
    if not clean:
        return []
    rows = _run(
        """
        MATCH (n:KGNode)
        WHERE (n.textbook_id = $textbook_id OR n.node_id STARTS WITH $book_prefix)
          AND n.chapter IS NOT NULL AND trim(toString(n.chapter)) <> ''
        RETURN toString(n.chapter) AS chapter, count(n) AS node_count
        ORDER BY chapter
        """,
        **_scope_parameters(clean),
    )
    result = [
        {"chapter": str(row.get("chapter") or ""), "node_count": int(row.get("node_count") or 0)}
        for row in rows
    ]
    return sorted(result, key=_chapter_sort_key)


def list_kg_chapter_nodes(textbook_id: str) -> list[dict[str, Any]]:
    """List chapter buckets and node ids in one remote query."""
    clean = (textbook_id or "").strip()
    if not clean:
        return []
    rows = _run(
        """
        MATCH (n:KGNode)
        WHERE (n.textbook_id = $textbook_id OR n.node_id STARTS WITH $book_prefix)
          AND n.chapter IS NOT NULL AND trim(toString(n.chapter)) <> ''
          AND n.type IN $types
        RETURN toString(n.chapter) AS chapter,
               collect(n.node_id) AS node_ids,
               count(n) AS node_count
        ORDER BY chapter
        """,
        types=CORE_TYPES,
        **_scope_parameters(clean),
    )
    result = [
        {
            "chapter": str(row.get("chapter") or ""),
            "node_ids": [str(node_id) for node_id in (row.get("node_ids") or []) if node_id],
            "node_count": int(row.get("node_count") or 0),
        }
        for row in rows
    ]
    return sorted(result, key=_chapter_sort_key)


def list_kg_nodes(textbook_id: str, chapter: str) -> list[dict[str, Any]]:
    """List chapter nodes (core teaching types) in textbook appearance order."""
    clean = (textbook_id or "").strip()
    rows = _run(
        """
        MATCH (n:KGNode)
        WHERE (n.textbook_id = $textbook_id OR n.node_id STARTS WITH $book_prefix)
          AND toString(n.chapter) = $chapter
          AND n.type IN $types
        OPTIONAL MATCH (prereq:KGNode)-[:PREREQUISITE_OF]->(n)
        WHERE prereq.type IN $types
        WITH n, collect(DISTINCT prereq.node_id)[0..8] AS prerequisite_ids
        RETURN n.node_id AS node_id, n.name AS name, n.type AS type,
               n.chapter AS chapter, n.section AS section,
               n.section_node_id AS section_node_id,
               n.line_start AS line_start,
               prerequisite_ids
        ORDER BY CASE
                   WHEN n.order_hint IS NOT NULL AND toString(n.order_hint) <> ''
                     THEN toFloat(n.order_hint)
                   WHEN n.line_start IS NULL OR toString(n.line_start) = ''
                     THEN 999999.0
                   ELSE toFloat(n.line_start)
                 END,
                 n.name, n.node_id
        """,
        chapter=chapter,
        types=CORE_TYPES,
        **_scope_parameters(clean),
    )
    return [dict(row) for row in rows]


def list_kg_nodes_by_section(textbook_id: str, section_code: str) -> list[dict[str, Any]]:
    """List core teaching nodes belonging to one section code (e.g. "2.1").

    Node sections look like "2.1 $\\pmb{n}$ 元排列"（编号 + 空格 + 标题）；
    用 "编号 + 空格" 前缀匹配，避免 "2.1" 误中 "2.10"。章导入节
    （如 "第2章 行列式 导入"）编号不规则，不在本函数覆盖范围内。
    """
    clean = (textbook_id or "").strip()
    code = (section_code or "").strip()
    if not clean or not code:
        return []
    rows = _run(
        """
        MATCH (n:KGNode)
        WHERE (n.textbook_id = $textbook_id OR n.node_id STARTS WITH $book_prefix)
          AND n.type IN $types
          AND (n.section = $code OR n.section STARTS WITH $code_prefix)
        RETURN n.node_id AS node_id, n.name AS name, n.type AS type,
               n.chapter AS chapter, n.section AS section,
               n.line_start AS line_start
        ORDER BY CASE
                   WHEN n.order_hint IS NOT NULL AND toString(n.order_hint) <> ''
                     THEN toFloat(n.order_hint)
                   WHEN n.line_start IS NULL OR toString(n.line_start) = ''
                     THEN 999999.0
                   ELSE toFloat(n.line_start)
                 END,
                 n.name, n.node_id
        LIMIT 40
        """,
        code=code,
        code_prefix=f"{code} ",
        types=CORE_TYPES,
        **_scope_parameters(clean),
    )
    return [dict(row) for row in rows]


def list_kg_edges(textbook_id: str) -> list[dict[str, Any]]:
    """List typed edges among core teaching nodes for one textbook."""
    clean = (textbook_id or "").strip()
    if not clean:
        return []
    rows = _run(
        """
        MATCH (s:KGNode)-[r]->(t:KGNode)
        WHERE (s.textbook_id = $textbook_id OR s.node_id STARTS WITH $book_prefix)
          AND (t.textbook_id = $textbook_id OR t.node_id STARTS WITH $book_prefix)
          AND s.type IN $types AND t.type IN $types
          AND type(r) IN $relation_types
          AND s.node_id <> t.node_id
        RETURN DISTINCT r.edge_id AS edge_id, type(r) AS type,
               s.node_id AS source, t.node_id AS target
        ORDER BY source, target, type
        """,
        types=CORE_TYPES,
        relation_types=[
            "PREREQUISITE_OF", "USES", "SUPERIOR", "EQUATIVE",
            "PART_OF", "DERIVES", "GETS", "HAS_PROPERTY",
        ],
        **_scope_parameters(clean),
    )
    seen: set[tuple[str, str, str]] = set()
    result: list[dict[str, Any]] = []
    for row in rows:
        key = (str(row.get("source") or ""), str(row.get("target") or ""), str(row.get("type") or ""))
        if not all(key) or key in seen:
            continue
        seen.add(key)
        result.append({"source": key[0], "target": key[1], "type": key[2]})
    return result


def _node_map(row: dict[str, Any], *, include_evidence: bool = True) -> dict[str, Any]:
    result = {
        "node_id": row.get("node_id"),
        "name": row.get("name"),
        "type": row.get("type"),
        "aliases": _list_value(row.get("aliases")),
        "chapter": row.get("chapter"),
        "section": row.get("section"),
        "section_node_id": row.get("section_node_id"),
        "source_code": row.get("source_code"),
    }
    if include_evidence:
        result.update({
            "description": _clean(row.get("description"), 800),
            "definition": _clean(row.get("definition")),
            "evidence_span": _clean(row.get("evidence_span")),
        })
    return result


def normalize_focus(focus: Iterable[str] | str | None) -> list[str]:
    """Validate the public focus contract for direct query-layer callers."""
    if focus is None:
        values = ["overview"]
    elif isinstance(focus, str):
        values = [focus]
    else:
        values = [str(item) for item in focus]
    if not values:
        raise ValueError("focus must contain at least one retrieval direction")
    if len(values) > 2:
        raise ValueError("focus accepts at most two retrieval directions")
    if len(set(values)) != len(values):
        raise ValueError("focus values must be unique")
    unknown = [value for value in values if value not in FOCUS_VALUES]
    if unknown:
        raise ValueError(f"unsupported focus: {unknown[0]}")
    if "overview" in values and len(values) > 1:
        raise ValueError("overview cannot be combined with another focus")
    return values


def search_kg_candidates(
    query: str,
    *,
    textbook_id: str | None = None,
    limit: int = CANDIDATE_LIMIT,
) -> list[dict[str, Any]]:
    """Find deterministic candidates without numeric relevance scores."""
    query_text = (query or "").strip()
    if not query_text:
        return []
    scope = _scope_parameters(textbook_id)
    rows = _run(
        """
        MATCH (n:KGNode)
        WHERE n.type IN $types
          AND ($textbook_id = '' OR n.textbook_id = $textbook_id OR n.node_id STARTS WITH $book_prefix)
          AND coalesce(n.name, '') <> ''
          AND (
            n.name = $query_text
            OR any(alias IN coalesce(n.aliases, []) WHERE alias = $query_text)
            OR (size(n.name) >= 2 AND $query_text CONTAINS n.name)
            OR any(alias IN coalesce(n.aliases, []) WHERE size(alias) >= 2 AND $query_text CONTAINS alias)
            OR (size($query_text) >= 2 AND n.name CONTAINS $query_text)
            OR any(alias IN coalesce(n.aliases, []) WHERE size($query_text) >= 2 AND alias CONTAINS $query_text)
          )
        WITH n,
             CASE
               WHEN n.name = $query_text THEN 0
               WHEN any(alias IN coalesce(n.aliases, []) WHERE alias = $query_text) THEN 1
               WHEN size(n.name) >= 2 AND $query_text CONTAINS n.name THEN 2
               WHEN any(alias IN coalesce(n.aliases, []) WHERE size(alias) >= 2 AND $query_text CONTAINS alias) THEN 3
               ELSE 4
             END AS match_rank,
             CASE n.type
               WHEN 'Concept' THEN 0
               WHEN 'Theorem' THEN 1
               WHEN 'Formula' THEN 2
               WHEN 'Method' THEN 3
               WHEN 'ProblemClass' THEN 4
               ELSE 9
             END AS type_rank
        RETURN n.node_id AS node_id, n.name AS name, n.type AS type,
               n.aliases AS aliases, n.chapter AS chapter, n.section AS section,
               n.section_node_id AS section_node_id, n.source_code AS source_code,
               CASE match_rank
                 WHEN 0 THEN 'exact_name'
                 WHEN 1 THEN 'exact_alias'
                 WHEN 2 THEN 'name_in_query'
                 WHEN 3 THEN 'alias_in_query'
                 ELSE 'query_in_name_or_alias'
               END AS match_type,
               match_rank, type_rank
        ORDER BY match_rank, type_rank, size(n.name) DESC, n.name, n.node_id
        LIMIT $limit
        """,
        query_text=query_text,
        types=CORE_TYPES,
        limit=max(1, min(limit, CANDIDATE_LIMIT)),
        **scope,
    )
    return [
        _node_map(row, include_evidence=False) | {"match_type": row.get("match_type")}
        for row in rows
    ]


def get_kg_node(node_id: str, *, textbook_id: str | None = None) -> dict[str, Any] | None:
    """Resolve one stable node ID inside the backend-bound textbook scope."""
    clean_id = (node_id or "").strip()
    if not clean_id:
        return None
    rows = _run(
        """
        MATCH (n:KGNode {node_id: $node_id})
        WHERE n.type IN $types
          AND ($textbook_id = '' OR n.textbook_id = $textbook_id OR n.node_id STARTS WITH $book_prefix)
        RETURN n.node_id AS node_id, n.name AS name, n.type AS type,
               n.aliases AS aliases, n.chapter AS chapter, n.section AS section,
               n.section_node_id AS section_node_id, n.source_code AS source_code,
               n.description AS description, n.definition AS definition,
               n.evidence_span AS evidence_span
        LIMIT 1
        """,
        node_id=clean_id,
        types=CORE_TYPES,
        **_scope_parameters(textbook_id),
    )
    return _node_map(rows[0]) if rows else None


def get_kg_relationships(
    node_id: str,
    *,
    focus: Iterable[str],
    textbook_id: str | None = None,
    limit_per_group: int = DIRECTIONAL_RESULT_LIMIT,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    """Return only requested relationship groups with per-group truncation."""
    requested = [value for value in focus if value in RELATION_FOCUS_TO_GROUP]
    if not requested:
        return {}, {}
    relation_types = sorted({
        relation_type
        for focus_key in requested
        for relation_type in RELATION_FOCUS_TO_TYPES[focus_key]
    })
    result_limit = max(1, min(limit_per_group, DIRECTIONAL_RESULT_LIMIT))
    fetch_limit = result_limit + 1
    rows = _run(
        """
        MATCH (selected:KGNode {node_id: $node_id})-[r]-(other:KGNode)
        WHERE type(r) IN $relation_types
          AND other.type IN $types
          AND ($textbook_id = '' OR other.textbook_id = $textbook_id OR other.node_id STARTS WITH $book_prefix)
        WITH selected, r, other,
             CASE WHEN startNode(r) = selected THEN 'outgoing' ELSE 'incoming' END AS direction,
             CASE type(r)
               WHEN 'PREREQUISITE_OF' THEN 0
               WHEN 'USES' THEN 1
               WHEN 'DERIVES' THEN 2
               WHEN 'GETS' THEN 3
               WHEN 'HAS_PROPERTY' THEN 4
               WHEN 'SUPERIOR' THEN 5
               WHEN 'PART_OF' THEN 6
               WHEN 'EQUATIVE' THEN 7
               ELSE 9
             END AS relation_rank
        WITH r, other, direction, relation_rank,
             CASE
               WHEN type(r) = 'PREREQUISITE_OF' AND direction = 'incoming' THEN 'prerequisites'
               WHEN type(r) = 'PREREQUISITE_OF' AND direction = 'outgoing' THEN 'successors'
               WHEN (type(r) = 'USES' AND direction = 'outgoing')
                 OR (type(r) IN ['DERIVES', 'GETS', 'HAS_PROPERTY'] AND direction = 'incoming')
                 THEN 'supporting'
               WHEN (type(r) = 'USES' AND direction = 'incoming')
                 OR (type(r) IN ['DERIVES', 'GETS', 'HAS_PROPERTY'] AND direction = 'outgoing')
                 THEN 'applications'
               WHEN type(r) IN ['SUPERIOR', 'PART_OF', 'EQUATIVE'] THEN 'structure'
               ELSE null
             END AS focus_key
        WHERE focus_key IN $focus_keys
        WITH focus_key, r, other, direction, relation_rank
        ORDER BY focus_key, relation_rank, direction, other.name, other.node_id
        WITH focus_key, collect({
          node_id: other.node_id,
          name: other.name,
          type: other.type,
          aliases: other.aliases,
          chapter: other.chapter,
          section: other.section,
          section_node_id: other.section_node_id,
          source_code: other.source_code,
          node_evidence: other.evidence_span,
          relationship_type: type(r),
          direction: direction,
          relationship_description: r.description,
          relationship_evidence: r.evidence_span,
          confidence: r.confidence
        })[0..$fetch_limit] AS items
        UNWIND items AS item
        RETURN focus_key, item
        ORDER BY focus_key, item.name, item.node_id
        """,
        node_id=node_id,
        relation_types=relation_types,
        types=CORE_TYPES,
        focus_keys=requested,
        fetch_limit=fetch_limit,
        **_scope_parameters(textbook_id),
    )
    rows_by_focus: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        focus_key = str(row.get("focus_key") or "")
        item = row.get("item")
        if focus_key not in requested or not isinstance(item, dict):
            continue
        rows_by_focus[focus_key].append(item)

    groups: dict[str, list[dict[str, Any]]] = {}
    stats: dict[str, dict[str, Any]] = {}
    for focus_key in requested:
        matched = rows_by_focus.get(focus_key, [])
        visible = matched[:result_limit]
        group = RELATION_FOCUS_TO_GROUP[focus_key]
        groups[group] = [{
            "node": _node_map(item, include_evidence=False),
            "relationship_type": str(item.get("relationship_type") or ""),
            "direction": str(item.get("direction") or ""),
            "meaning": _relation_meaning(
                str(item.get("relationship_type") or ""),
                str(item.get("direction") or ""),
            ),
            "description": _clean(item.get("relationship_description"), 500),
            "evidence_span": _clean(
                item.get("relationship_evidence") or item.get("node_evidence"), 800
            ),
            "confidence": item.get("confidence"),
        } for item in visible]
        stats[focus_key] = {
            "returned_count": len(visible),
            "truncated": len(matched) > result_limit,
        }
    return groups, stats


def _relation_meaning(rel_type: str, direction: str) -> str:
    meanings = {
        ("PREREQUISITE_OF", "incoming"): "该节点是当前知识点的明确前置知识",
        ("PREREQUISITE_OF", "outgoing"): "当前知识点是该节点的明确前置知识",
        ("USES", "outgoing"): "当前知识点的理解、计算或证明需要使用该节点",
        ("USES", "incoming"): "该节点的理解、计算或证明会使用当前知识点",
        ("DERIVES", "incoming"): "该节点是推导当前知识点的依据",
        ("DERIVES", "outgoing"): "当前知识点可推导出该节点",
        ("GETS", "incoming"): "该方法、公式或定理可得到当前知识点",
        ("GETS", "outgoing"): "当前方法、公式或定理可得到该节点",
        ("HAS_PROPERTY", "incoming"): "该对象或主题具有当前性质",
        ("HAS_PROPERTY", "outgoing"): "该节点是当前对象或主题的性质",
        ("SUPERIOR", "outgoing"): "该节点是当前知识点的上位类型",
        ("SUPERIOR", "incoming"): "该节点是当前知识点的下位或具体类型",
        ("PART_OF", "outgoing"): "当前知识点是该节点的组成部分",
        ("PART_OF", "incoming"): "该节点是当前知识点的组成部分",
        ("EQUATIVE", "outgoing"): "该节点与当前知识点是同层并列关系，不表示数学等价",
        ("EQUATIVE", "incoming"): "该节点与当前知识点是同层并列关系，不表示数学等价",
    }
    return meanings.get((rel_type, direction), "保留原始关系方向")


def get_kg_rule_cases(
    node_id: str,
    *,
    textbook_id: str | None = None,
    limit: int = MAX_FOCUS_FETCH_LIMIT,
) -> list[dict[str, Any]]:
    """Expand direct and HAS_PROPERTY-owned RuleCases with bounded condition refs."""
    scope = _scope_parameters(textbook_id)
    rule_rows = _run(
        """
        MATCH (selected:KGNode {node_id: $node_id})
        CALL (selected) {
          WITH selected
          RETURN selected AS owner, 'direct' AS owner_path
          UNION
          WITH selected
          MATCH (selected)-[:HAS_PROPERTY]->(property_owner:KGNode)
          RETURN property_owner AS owner, 'via_has_property' AS owner_path
        }
        MATCH (owner)-[:HAS_RULE_CASE]->(rule:RuleCase)
        WHERE ($textbook_id = '' OR rule.textbook_id = $textbook_id OR rule.node_id STARTS WITH $book_prefix)
        RETURN DISTINCT rule.node_id AS rule_id, rule.name AS name,
               rule.applies_to AS applies_to, rule.condition_logic AS condition_logic,
               rule.conditions AS property_conditions, rule.outcomes AS property_outcomes,
               rule.source_code AS source_code, rule.evidence_span AS evidence_span,
               owner.node_id AS owner_node_id, owner.name AS owner_name,
               owner.type AS owner_type, owner_path
        ORDER BY CASE owner_path WHEN 'direct' THEN 0 ELSE 1 END,
                 owner.name, rule.name, rule.node_id
        LIMIT $limit
        """,
        node_id=node_id,
        limit=max(1, min(limit, MAX_FOCUS_FETCH_LIMIT)),
        **scope,
    )
    if not rule_rows:
        return []

    rule_ids = [str(row["rule_id"]) for row in rule_rows if row.get("rule_id")]
    condition_rows = _run(
        """
        MATCH (rule:RuleCase)-[condition_rel]->(condition:ConditionExpression)
        WHERE rule.node_id IN $rule_ids
          AND type(condition_rel) IN ['HAS_CONDITION', 'HAS_CONDITION_AND', 'HAS_CONDITION_OR']
        OPTIONAL MATCH (condition)-[:REFERS_TO]->(required:KGNode)
        RETURN rule.node_id AS rule_id, condition.node_id AS condition_id,
               condition.name AS condition, type(condition_rel) AS condition_relation,
               required.node_id AS required_node_id, required.name AS required_name,
               required.type AS required_type
        ORDER BY rule_id, condition_id, required.name, required.node_id
        LIMIT $detail_limit
        """,
        rule_ids=rule_ids,
        detail_limit=RULE_DETAIL_LIMIT,
    )
    outcome_rows = _run(
        """
        MATCH (rule:RuleCase)-[outcome_rel]->(outcome:Outcome)
        WHERE rule.node_id IN $rule_ids
          AND type(outcome_rel) IN ['HAS_OUTCOME', 'HAS_OUTCOME_AND', 'HAS_OUTCOME_OR']
        RETURN rule.node_id AS rule_id, outcome.node_id AS outcome_id,
               outcome.name AS outcome, type(outcome_rel) AS outcome_relation
        ORDER BY rule_id, outcome_id
        LIMIT $detail_limit
        """,
        rule_ids=rule_ids,
        detail_limit=RULE_DETAIL_LIMIT,
    )
    conditions = _group_conditions(condition_rows)
    outcomes: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in outcome_rows:
        rule_id = str(row.get("rule_id") or "")
        item = {
            "text": _clean(row.get("outcome"), 500),
            "relationship_type": str(row.get("outcome_relation") or ""),
        }
        if item not in outcomes[rule_id]:
            outcomes[rule_id].append(item)

    result = []
    for row in rule_rows:
        rule_id = str(row.get("rule_id") or "")
        rule_conditions = conditions.get(rule_id) or [
            {"text": item, "relationship_type": "property", "required_knowledge": []}
            for item in _list_value(row.get("property_conditions"))
        ]
        rule_outcomes = outcomes.get(rule_id) or [
            {"text": item, "relationship_type": "property"}
            for item in _list_value(row.get("property_outcomes"))
        ]
        result.append({
            "rule_id": rule_id,
            "name": row.get("name"),
            "owner": {
                "node_id": row.get("owner_node_id"),
                "name": row.get("owner_name"),
                "type": row.get("owner_type"),
                "path": row.get("owner_path"),
            },
            "applies_to": _clean(row.get("applies_to"), 600),
            "condition_logic": row.get("condition_logic"),
            "conditions": rule_conditions,
            "outcomes": rule_outcomes,
            "source_code": row.get("source_code"),
            "evidence_span": _clean(row.get("evidence_span")),
        })
    return result


def _group_conditions(rows: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in rows:
        rule_id = str(row.get("rule_id") or "")
        condition_id = str(row.get("condition_id") or row.get("condition") or "")
        item = grouped[rule_id].setdefault(condition_id, {
            "text": _clean(row.get("condition"), 500),
            "relationship_type": str(row.get("condition_relation") or ""),
            "required_knowledge": [],
        })
        if row.get("required_node_id"):
            required = {
                "node_id": row.get("required_node_id"),
                "name": row.get("required_name"),
                "type": row.get("required_type"),
            }
            if required not in item["required_knowledge"]:
                item["required_knowledge"].append(required)
    return {rule_id: list(items.values()) for rule_id, items in grouped.items()}


def retrieve_kg_context(
    query: str,
    *,
    node_id: str | None = None,
    focus: Iterable[str] | str | None = None,
    textbook_id: str | None = None,
    page_number: int | None = None,
) -> dict[str, Any]:
    """Resolve a query or stable node ID, then return bounded teaching context."""
    query_text = (query or "").strip()
    scope = {"textbook_id": textbook_id, "page_number": page_number}
    requested_focus = normalize_focus(focus)
    retrieved_focus = (
        list(OVERVIEW_FOCUS) if requested_focus == ["overview"] else list(requested_focus)
    )
    result_limit = (
        OVERVIEW_RESULT_LIMIT
        if requested_focus == ["overview"]
        else DIRECTIONAL_RESULT_LIMIT
    )

    match_type = "selected_node_id" if node_id else ""
    selected = get_kg_node(node_id or "", textbook_id=textbook_id) if node_id else None
    candidates: list[dict[str, Any]] = []
    retry_stats: dict[str, Any] | None = None

    if node_id and not selected:
        return {
            "status": "not_found",
            "query": query_text,
            "scope": scope,
            "kg_basis_available": False,
            "requested_focus": requested_focus,
            "retrieved_focus": [],
            "empty_focus": [],
            "focus_stats": {},
            "message": "指定的知识点不在当前教材范围内，或该节点不存在。",
        }

    if not selected:
        candidates = search_kg_candidates(query_text, textbook_id=textbook_id)
        exact = [item for item in candidates if item.get("match_type") in {"exact_name", "exact_alias"}]
        if len(exact) == 1:
            chosen = exact[0]
        elif len(exact) > 1:
            return _ambiguous_result(query_text, scope, exact, requested_focus)
        elif len(candidates) == 1:
            chosen = candidates[0]
        elif len(candidates) > 1:
            return _ambiguous_result(query_text, scope, candidates, requested_focus)
        else:
            # 句子式 query 一个候选都没有时，用页上下文节点名做包含/相似
            # 匹配纠正后自动重试一次；重试仍无唯一候选则维持原 not_found。
            corrected = _correct_query_with_page_names(
                query_text, textbook_id=textbook_id, page_number=page_number,
            )
            if corrected is not None:
                corrected_query, matched_names = corrected
                retry_candidates = search_kg_candidates(corrected_query, textbook_id=textbook_id)
                retry_exact = [
                    item for item in retry_candidates
                    if item.get("match_type") in {"exact_name", "exact_alias"}
                ]
                retry_stats = {
                    "original_query": query_text,
                    "corrected_query": corrected_query,
                    "matched_page_names": matched_names,
                }
                if len(retry_exact) == 1:
                    chosen = retry_exact[0]
                elif len(retry_candidates) == 1:
                    chosen = retry_candidates[0]
                else:
                    chosen = None
                if chosen is not None:
                    retry_stats["outcome"] = "resolved"
                else:
                    retry_stats["outcome"] = "no_unique_match"
            if not retry_stats or "outcome" not in retry_stats:
                not_found = {
                    "status": "not_found",
                    "query": query_text,
                    "scope": scope,
                    "kg_basis_available": False,
                    "requested_focus": requested_focus,
                    "retrieved_focus": [],
                    "empty_focus": [],
                    "focus_stats": {},
                    "message": "当前教材知识图谱中没有找到可定位的知识点；可以继续一般数学回答，但必须说明本轮没有 KG 依据。",
                }
                if retry_stats is not None:
                    not_found["focus_stats"] = {"query_retry": retry_stats}
                    not_found["message"] += "（已用本页知识点名称自动重试一次，仍未定位。）"
                return not_found
        match_type = str(chosen.get("match_type") or "")
        selected = get_kg_node(str(chosen.get("node_id") or ""), textbook_id=textbook_id)

    if not selected:
        raise RuntimeError("KG candidate disappeared during deterministic resolution")

    selected["match_type"] = match_type
    relation_focus = [
        value for value in retrieved_focus if value in RELATION_FOCUS_TO_GROUP
    ]
    relationships, focus_stats = get_kg_relationships(
        str(selected["node_id"]),
        focus=relation_focus,
        textbook_id=textbook_id,
        limit_per_group=result_limit,
    )
    rule_cases: list[dict[str, Any]] | None = None
    if "rules" in retrieved_focus:
        fetched_rules = get_kg_rule_cases(
            str(selected["node_id"]),
            textbook_id=textbook_id,
            limit=result_limit + 1,
        )
        rule_cases = fetched_rules[:result_limit]
        focus_stats["rules"] = {
            "returned_count": len(rule_cases),
            "truncated": len(fetched_rules) > result_limit,
        }

    result = {
        "status": "resolved",
        "query": query_text,
        "scope": scope,
        "kg_basis_available": True,
        "requested_focus": requested_focus,
        "retrieved_focus": retrieved_focus,
        "empty_focus": [
            value
            for value in retrieved_focus
            if (focus_stats.get(value) or {}).get("returned_count") == 0
        ],
        "focus_stats": focus_stats,
        "selected_node": selected,
        "limits": {
            "candidate_count": CANDIDATE_LIMIT,
            "directional_per_focus": DIRECTIONAL_RESULT_LIMIT,
            "overview_per_focus": OVERVIEW_RESULT_LIMIT,
            "evidence_characters": EVIDENCE_LIMIT,
        },
    }
    if relation_focus:
        result["relationships"] = relationships
    if rule_cases is not None:
        result["rule_cases"] = rule_cases
    if retry_stats is not None:
        # 可观测地标注发生了 not_found 自动重试（focus_stats 内为诊断键，
        # 不与 retrieval focus 同名），对外返回契约保持不变。
        result["focus_stats"]["query_retry"] = retry_stats
    return result


_PAGE_NAME_RETRY_MIN_SCORE = 0.34


def _char_bigrams(text: str) -> set[str]:
    compact = re.sub(r"\s+", "", text or "")
    if len(compact) < 2:
        return {compact} if compact else set()
    return {compact[index:index + 2] for index in range(len(compact) - 1)}


def _correct_query_with_page_names(
    query: str,
    *,
    textbook_id: str | None,
    page_number: int | None,
) -> tuple[str, list[str]] | None:
    """用页上下文节点名纠正句子式 query，供 not_found 后重试一次。

    页码 →（PDF 书签）→ 小节 → 本节核心节点名；先按「节点名被 query 包含」
    匹配（句子式问法常把节点名拆在其中），再按字符 bigram Dice 相似度匹配
    （覆盖换字/语序不同的问法，如 "交换行列式两行行列式变号" 对
    "两行互换行列式反号"）。有唯一最佳候选时返回 (纠正后 query, 命中节点名)，
    否则返回 None；任何一步失败（无页码、无小节、KG 不可达）也返回 None。
    """
    clean_book = (textbook_id or "").strip()
    query_text = (query or "").strip()
    if not clean_book or not query_text or not page_number:
        return None
    try:
        from app.services.learning.section_page import page_sections

        section_code = page_sections(clean_book).get(int(page_number))
    except Exception:
        return None
    if not section_code:
        return None
    try:
        nodes = list_kg_nodes_by_section(clean_book, section_code)
    except Exception:
        return None
    names: list[str] = []
    for node in nodes:
        name = str(node.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
    if not names:
        return None

    contained = [name for name in names if len(name) >= 2 and name in query_text]
    if contained:
        best = max(contained, key=len)
        return best, sorted(contained, key=len, reverse=True)

    query_bigrams = _char_bigrams(query_text)
    if not query_bigrams:
        return None
    scored: list[tuple[float, str]] = []
    for name in names:
        name_bigrams = _char_bigrams(name)
        if not name_bigrams:
            continue
        overlap = len(query_bigrams & name_bigrams)
        score = 2 * overlap / (len(query_bigrams) + len(name_bigrams))
        scored.append((score, name))
    if not scored:
        return None
    scored.sort(key=lambda item: (-item[0], item[1]))
    best_score, best_name = scored[0]
    if best_score < _PAGE_NAME_RETRY_MIN_SCORE:
        return None
    # 并列最佳时不猜测，维持原样 not_found。
    if len(scored) > 1 and scored[1][0] == best_score:
        return None
    return best_name, [best_name]


def _ambiguous_result(
    query: str,
    scope: dict[str, Any],
    candidates: list[dict[str, Any]],
    requested_focus: list[str],
) -> dict[str, Any]:
    return {
        "status": "ambiguous",
        "query": query,
        "scope": scope,
        "kg_basis_available": False,
        "requested_focus": requested_focus,
        "retrieved_focus": [],
        "empty_focus": [],
        "focus_stats": {},
        "message": "存在多个真实候选。请结合题目选择 node_id 后再次调用；无法判断时询问学生。",
        "candidates": candidates,
    }
