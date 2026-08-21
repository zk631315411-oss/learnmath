# -*- coding: utf-8 -*-
"""为合并包节点推算 order_hint（小节内部的真实教材顺序）。

依据：leaf_sections.jsonl 中每个叶节的 anchors（定义/定理/例 的精确行范围）与
unit text。节点定位优先级：
  1. source_label 精确匹配 anchor.source_label → anchor.line_start + 锚内偏移
  2. evidence_span / name 在 unit text 中的位置 → 折算行号
  3. 兜底：unit.line_start
order_hint 为 float：整数部分是行号，小数部分是行/锚内相对偏移，仅用于排序。
"""
import json
import sys
from pathlib import Path

BASE = Path("D:/LearnMath/artifacts/kg-13-merged/step8_final_graph")
LEAF = [
    Path("D:/ai-math/教材提取模块/高代提取/归档/正式_runs/gaodai_full_v4_4_20260622_203611/上册/leaf_sections.jsonl"),
    Path("D:/ai-math/教材提取模块/高代提取/归档/正式_runs/gaodai_full_v4_4_20260622_203611/下册/leaf_sections.jsonl"),
]
FILES = ["final_core_nodes.jsonl", "final_application_nodes.jsonl"]


def load(p):
    return [json.loads(l) for l in open(p, encoding="utf-8-sig") if l.strip()]


def squash(s: str) -> str:
    return "".join(str(s or "").split())


units = {}
for p in LEAF:
    for d in load(p):
        units[d["section_node_id"]] = d


def locate_in(text: str, needle: str):
    """在（去空白）文本中找 needle，返回 0..1 的相对位置；找不到返回 None。"""
    hay, ndl = squash(text), squash(needle)
    if not hay or not ndl:
        return None
    pos = hay.find(ndl[:60])
    if pos < 0 and len(ndl) > 24:
        pos = hay.find(ndl[:24])
    if pos < 0:
        return None
    return pos / max(len(hay), 1)


def order_hint(node: dict):
    sid = node.get("section_node_id") or ""
    unit = units.get(sid)
    if not unit:
        return None, "no-unit"
    u_ls = int(unit.get("line_start") or 0)
    u_le = int(unit.get("line_end") or u_ls)
    span = max(u_le - u_ls, 1)

    # 1) source_label → anchor
    label = str(node.get("source_label") or "").strip()
    if label:
        for a in unit.get("anchors") or []:
            if str(a.get("source_label") or "").strip() == label:
                off = locate_in(a.get("text", ""), node.get("name", "")) or 0.0
                return round(float(a.get("line_start") or u_ls) + off * 0.99, 4), "anchor"

    # 2) evidence_span / name → unit text
    for key in ("evidence_span", "name"):
        ratio = locate_in(unit.get("text", ""), node.get(key, ""))
        if ratio is not None:
            return round(u_ls + ratio * span * 0.99, 4), key

    return float(u_ls), "unit-fallback"


stats = {}
for fname in FILES:
    path = BASE / fname
    rows = load(path)
    for row in rows:
        hint, how = order_hint(row)
        if hint is not None:
            row["order_hint"] = hint
        stats[how] = stats.get(how, 0) + 1
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"{fname}: {len(rows)} rows updated")

print("定位方式分布:", stats)

# 同步本地 Neo4j
import os
os.environ.setdefault("NEO4J_URI", "neo4j://127.0.0.1:7687")
os.environ.setdefault("NEO4J_USER", "neo4j")
os.environ.setdefault("NEO4J_PASSWORD", "zhang2004")
from neo4j import GraphDatabase

driver = GraphDatabase.driver(os.environ["NEO4J_URI"], auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"]))
updates = []
for fname in FILES:
    for row in load(BASE / fname):
        if "order_hint" in row:
            updates.append({"node_id": row["node_id"], "order_hint": row["order_hint"]})
with driver.session() as s:
    res = s.run(
        "UNWIND $rows AS row MATCH (n:KGNode {node_id: row.node_id}) SET n.order_hint = row.order_hint RETURN count(n) AS c",
        rows=updates,
    ).single()
print(f"Neo4j 同步 order_hint: {res['c']}/{len(updates)}")
driver.close()
