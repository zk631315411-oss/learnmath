# -*- coding: utf-8 -*-
"""从最终图提取第一章 mockup 数据（nodes/edges/rules），支持 1-hop 外部邻居。
用法: python extract_ch1.py <final_graph_dir> <out_json>
"""
import json
import sys
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])

def load(f):
    p = SRC / f
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []

core_n = load("final_core_nodes.jsonl")
core_e = load("final_core_edges.jsonl")
app_n = load("final_application_nodes.jsonl")
app_e = load("final_application_edges.jsonl")
rules = load("final_rule_cases.jsonl")

CH1_SECS = ("1.1 ", "1.2 ", "1.3 ")

def is_ch1_node(n):
    sec = str(n.get("section") or "")
    sid = str(n.get("section_node_id") or "")
    return sec.startswith(CH1_SECS) or ":C01:" in sid

nodes = {}
for n in core_n + app_n:
    if is_ch1_node(n):
        nodes[n["node_id"]] = n

all_edges = core_e + app_e
def edge_ok(e):
    return e.get("source_node_id") in nodes and e.get("target_node_id") in nodes

in_edges = [e for e in all_edges if edge_ok(e)]

# 1-hop 外部邻居：与 ch1 节点相连但不在集合内的节点
ext_ids = set()
for e in all_edges:
    s, t = e.get("source_node_id"), e.get("target_node_id")
    if s in nodes and t not in nodes: ext_ids.add(t)
    if t in nodes and s not in nodes: ext_ids.add(s)
ext_nodes = {}
for n in core_n + app_n:
    if n["node_id"] in ext_ids:
        ext_nodes[n["node_id"]] = n
ext_edges = [e for e in all_edges if (e.get("source_node_id") in nodes or e.get("source_node_id") in ext_nodes)
                                   and (e.get("target_node_id") in nodes or e.get("target_node_id") in ext_nodes)
                                   and (e.get("source_node_id") in nodes or e.get("target_node_id") in nodes)]
# 只保留至少一端在 ch1 集合的边（避免外部节点之间的边）
ext_edges = [e for e in ext_edges if e.get("source_node_id") in nodes or e.get("target_node_id") in nodes]

def node_json(n, external):
    return {
        "id": n["node_id"],
        "name": n.get("name"),
        "type": n.get("node_type") or n.get("type"),
        "section": n.get("section"),
        "definition": n.get("definition") or "",
        "description": n.get("description") or n.get("reason") or "",
        **({"external": True} if external else {}),
    }

def edge_json(e):
    return {
        "a": e.get("source_node_id"), "b": e.get("target_node_id"),
        "type": e.get("type"), "status": e.get("review_status"),
        "conf": e.get("confidence"),
        "rel_desc": e.get("description") or "",
        "rel_ev": (e.get("evidence_span") or "")[:200],
    }

SEC_ORDER = {"1.1 ": 0, "1.2 ": 1, "1.3 ": 2}
def teach_key(n):
    sec = str(n.get("section") or "")
    si = SEC_ORDER.get(sec[:4], 9)
    return (si, n.get("line_start") or 0, str(n.get("name") or ""))

ch1_sorted = sorted(nodes.values(), key=teach_key)
ext_sorted = sorted(ext_nodes.values(), key=lambda n: (str(n.get("section") or ""), str(n.get("name") or "")))
out_nodes = [node_json(n, False) for n in ch1_sorted] + [node_json(n, True) for n in ext_sorted]
out_edges = [edge_json(e) for e in (in_edges + ext_edges)]
# 去重（同 a,b,type）
seen = set(); ded = []
for e in out_edges:
    k = (e["a"], e["b"], e["type"])
    if k in seen: continue
    seen.add(k); ded.append(e)
out_rules = [r for r in rules if ":C01:" in str(r.get("section_node_id") or "")]

OUT.write_text(json.dumps({"nodes": out_nodes, "edges": ded, "rules": out_rules}, ensure_ascii=False, indent=1), encoding="utf-8")

# 连通分量统计
parent = {n["id"]: n["id"] for n in out_nodes}
def find(x):
    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[ra] = rb
for e in ded:
    if e["a"] in parent and e["b"] in parent: union(e["a"], e["b"])
comp = {}
for n in out_nodes: comp.setdefault(find(n["id"]), []).append(n)
sizes = sorted((len(v) for v in comp.values()), reverse=True)
print(f"{SRC.parent.name}: ch1节点={len(nodes)} 外部邻居={len(ext_nodes)} 边={len(ded)} 规则={len(out_rules)}")
print(f"  岛屿: {len(comp)} 座, 规模={sizes}")
for v in sorted(comp.values(), key=len):
    if len(v) <= 6:
        print(f"   岛({len(v)}): {[n['name'] for n in v]}")
print(f"  外部邻居: {[n['name'] for n in ext_nodes.values()]}")
