"""Q1 connectivity (union-find over local ch1 json) + Q4 ProblemClass provenance (Aura)."""

from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

d = json.loads((ROOT / ".tmp-qa" / "gaodai_ch1.json").read_text(encoding="utf-8"))
nodes, edges = d["nodes"], d["edges"]
secof = {n["id"]: n["section"] for n in nodes}


def components(ids, edge_list):
    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in edge_list:
        if e["a"] in parent and e["b"] in parent:
            ra, rb = find(e["a"]), find(e["b"])
            if ra != rb:
                parent[rb] = ra
    comp = defaultdict(list)
    for i in ids:
        comp[find(i)].append(i)
    return list(comp.values())


# --- Q1: chapter-level connectivity (all edges, incl. review) ---------------
comps = components([n["id"] for n in nodes], edges)
comps.sort(key=len, reverse=True)
print("== chapter 1 connectivity (solid+review edges) ==")
print("component sizes:", [len(c) for c in comps])
byid = {n["id"]: n for n in nodes}
for c in comps:
    secs = Counter(byid[i]["section"][:3] for i in c)
    types = Counter(byid[i]["type"] for i in c)
    names = "、".join(byid[i]["name"] for i in c[:16])
    print(f"  size={len(c)} sections={dict(secs)} types={dict(types)}")
    print(f"    {names}")

solid = [e for e in edges if e.get("status") != "review"]
comps2 = components([n["id"] for n in nodes], solid)
comps2.sort(key=len, reverse=True)
print("== chapter 1 connectivity (solid only) ==")
print("component sizes:", [len(c) for c in comps2])

for sec in ["1.1", "1.2", "1.3"]:
    sn = [n for n in nodes if n["section"].startswith(sec)]
    cc = components([n["id"] for n in sn], edges)
    sizes = sorted((len(v) for v in cc), reverse=True)
    singles = sum(1 for v in cc if len(v) == 1)
    print(f"{sec}: components={sizes} isolated_singles={singles}")

intra = sum(1 for e in edges if secof.get(e["a"]) == secof.get(e["b"]))
print("edges total", len(edges), "| intra-section", intra, "| cross-section", len(edges) - intra)

# --- Q4: ProblemClass provenance from Aura -----------------------------------
from neo4j import GraphDatabase  # noqa: E402
from app.config import config  # noqa: E402

driver = GraphDatabase.driver(
    config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD), connection_timeout=10.0)
db = os.getenv("NEO4J_DATABASE", "neo4j")
database = None if db in {"", "neo4j", "default"} else db


def q(cypher, **kw):
    last = None
    for a in range(4):
        try:
            with driver.session(database=database) as s:
                return [dict(r) for r in s.run(cypher, **kw)]
        except Exception as e:  # Aura cold start
            last = e
            time.sleep(1.5 * (a + 1))
    raise last


pcs = q("""
  MATCH (n:KGNode)
  WHERE coalesce(n.textbook_id, split(n.node_id,':')[0]) = 'gaodai_shang'
    AND toString(n.section) STARTS WITH '1.1' AND n.type = 'ProblemClass'
  RETURN n.name AS name, n.source_label AS src, n.source_scope AS scope,
         n.subsection AS sub, n.description AS descr, n.evidence_span AS ev
""")
out = {"pc": pcs}
(ROOT / ".tmp-qa" / "kg_pc_provenance.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("== ProblemClass provenance (1.1) ==")
for r in pcs:
    print(f"PC: {r['name']} | {r['sub']} | scope={r['scope']} | label={r['src']}")
    print(f"    evidence: {(r['ev'] or '')[:180]}")
