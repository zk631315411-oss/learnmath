"""Neo4j KG 查询 — LearnMath 精简版。

只保留 lookup_kg_node 需要的两个函数：find_node 和 related_nodes。
从 ai-math 的 kg_v44.py 精简而来，去掉 import_batch、book_prefix 等复杂逻辑。
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any

from app.config import config

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


@contextmanager
def _session():
    driver = _get_driver()
    database = _database()
    with driver.session(database=database) as session:
        yield session


def _database() -> str | None:
    import os
    database = os.getenv("NEO4J_DATABASE", "neo4j")
    return None if database in {"", "neo4j", "default"} else database


def _node_map(row) -> dict[str, Any]:
    return {
        "node_id": row.get("node_id"),
        "name": row.get("name"),
        "type": row.get("type"),
        "chapter": row.get("chapter"),
        "section": row.get("section"),
        "section_node_id": row.get("section_node_id"),
        "source_code": row.get("source_code"),
        "evidence_span": row.get("evidence_span"),
        "import_batch": row.get("import_batch"),
    }


def find_node(name: str, labels: list[str] | None = None) -> dict[str, Any] | None:
    """按名称查找 KG 节点，返回属性字典或 None。"""
    if not name or not name.strip():
        return None
    name = name.strip()

    label_clause = ""
    if labels:
        label_str = "|".join(f"`{l}`" for l in labels)
        label_clause = f":{label_str}"

    query = f"""
        MATCH (n{label_clause})
        WHERE n.name = $name OR n.node_id = $name
        RETURN properties(n) AS props
        LIMIT 1
    """
    try:
        with _session() as session:
            result = session.run(query, name=name)
            record = result.single()
            if record:
                return _node_map(record["props"])
    except Exception:
        pass
    return None


def related_nodes(name: str, limit: int = 5) -> tuple[list[dict], list[dict]]:
    """查询一个节点的前驱（support）和后继（extension/lookahead）节点。

    Returns:
        (support_nodes, extension_nodes) — 每个节点是 dict，包含 name, type, rel_type。
    """
    if not name or not name.strip():
        return [], []
    name = name.strip()

    # 前驱：指向当前节点的关系（当前节点是目标）
    support_query = """
        MATCH (pre)-[r]->(n)
        WHERE n.name = $name
        RETURN pre.name AS name, pre.type AS type, type(r) AS rel_type
        LIMIT $limit
    """
    # 后继：从当前节点出发的关系
    extension_query = """
        MATCH (n)-[r]->(post)
        WHERE n.name = $name
        RETURN post.name AS name, post.type AS type, type(r) AS rel_type
        LIMIT $limit
    """
    try:
        with _session() as session:
            support = [
                {"name": r["name"], "type": r["type"], "rel_type": r["rel_type"]}
                for r in session.run(support_query, name=name, limit=limit)
                if r["name"]
            ]
            extension = [
                {"name": r["name"], "type": r["type"], "rel_type": r["rel_type"]}
                for r in session.run(extension_query, name=name, limit=limit)
                if r["name"]
            ]
            return support, extension
    except Exception:
        return [], []


def search_nodes(query: str, limit: int = 10) -> list[dict]:
    """模糊搜索节点名称（CONTAINS 匹配）。"""
    if not query or not query.strip():
        return []
    query = query.strip()
    cypher = """
        MATCH (n)
        WHERE n.name CONTAINS $query
        RETURN properties(n) AS props
        LIMIT $limit
    """
    try:
        with _session() as session:
            return [_node_map(r["props"]) for r in session.run(cypher, query=query, limit=limit)]
    except Exception:
        return []
