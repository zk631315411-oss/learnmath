"""LearnMath KG (Aura) read-only audit.

Answers the three open data questions from the KG map plan review:
  1. per-section edge density (is a graph view viable per section?)
  2. RuleCase coverage (is the rule-expansion panel mostly empty?)
  3. PREREQUISITE_OF / implicit edge facts (what can drive learning logic?)

Strictly read-only: only MATCH/RETURN aggregate or small-detail queries.
Usage: python .tmp-qa/kg_audit.py
Writes .tmp-qa/kg_audit.json and prints a summary.
"""

from __future__ import annotations

import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from neo4j import GraphDatabase  # noqa: E402

from app.config import config  # noqa: E402  (loads .env)

CORE_TYPES = ["Concept", "Theorem", "Formula", "Method", "ProblemClass"]
OUT_PATH = Path(__file__).resolve().parent / "kg_audit.json"


def run(session, cypher: str, **params):
    return [dict(record) for record in session.run(cypher, **params)]


def run_with_retry(session_factory, cypher: str, **params):
    last = None
    for attempt in range(4):
        try:
            with session_factory() as session:
                return run(session, cypher, **params)
        except Exception as exc:  # Aura free tier cold start
            last = exc
            if attempt < 3:
                time.sleep(1.5 * (attempt + 1))
    raise last


def main() -> None:
    driver = GraphDatabase.driver(
        config.NEO4J_URI,
        auth=(config.NEO4J_USER, config.NEO4J_PASSWORD),
        connection_timeout=10.0,
    )
    import os
    db = os.getenv("NEO4J_DATABASE", "neo4j")
    database = None if db in {"", "neo4j", "default"} else db

    def session_factory():
        return driver.session(database=database)

    audit: dict = {}

    # --- 1. label & relationship-type inventories -----------------------------
    audit["labels"] = run_with_retry(session_factory, """
        MATCH (n) UNWIND labels(n) AS label
        RETURN label, count(*) AS count ORDER BY count DESC
    """)
    audit["rel_types"] = run_with_retry(session_factory, """
        MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC
    """)
    audit["node_property_keys"] = run_with_retry(session_factory, """
        MATCH (n:KGNode) WITH keys(n) AS ks UNWIND ks AS key
        RETURN key, count(*) AS count ORDER BY count DESC
    """)
    audit["edge_property_keys"] = run_with_retry(session_factory, """
        MATCH ()-[r]->() WITH keys(r) AS ks UNWIND ks AS key
        RETURN key, count(*) AS count ORDER BY count DESC
    """)

    # --- 2. core node dump (id/textbook/chapter/section/type/name) ------------
    nodes = run_with_retry(session_factory, """
        MATCH (n:KGNode) WHERE n.type IN $types
        RETURN n.node_id AS node_id,
               coalesce(n.textbook_id, split(n.node_id, ':')[0]) AS tb,
               toString(n.chapter) AS chapter, toString(n.section) AS section,
               n.type AS type, n.name AS name,
               n.subsection AS subsection
    """, types=CORE_TYPES)
    audit["core_node_count"] = len(nodes)

    # --- 3. ALL edges between KGNodes (endpoint scope + type + review meta) ---
    edges = run_with_retry(session_factory, """
        MATCH (a:KGNode)-[r]->(b:KGNode)
        RETURN type(r) AS type,
               a.node_id AS a_id, b.node_id AS b_id,
               coalesce(a.textbook_id, split(a.node_id, ':')[0]) AS a_tb,
               coalesce(b.textbook_id, split(b.node_id, ':')[0]) AS b_tb,
               toString(a.chapter) AS a_ch, toString(b.chapter) AS b_ch,
               toString(a.section) AS a_sec, toString(b.section) AS b_sec,
               a.type AS a_type, b.type AS b_type,
               r.source AS source, r.confidence AS confidence,
               r.review_status AS review_status
    """)
    audit["kgedge_count"] = len(edges)

    # --- 4. rule system --------------------------------------------------------
    audit["rulecase_total"] = run_with_retry(session_factory, """
        MATCH (rc:RuleCase) RETURN count(rc) AS count
    """)[0]["count"]
    audit["rule_direct_owners"] = run_with_retry(session_factory, """
        MATCH (n:KGNode)-[:HAS_RULE_CASE]->(:RuleCase)
        WHERE n.type IN $types
        RETURN count(DISTINCT n) AS count
    """, types=CORE_TYPES)[0]["count"]
    audit["rule_viaproperty_owners"] = run_with_retry(session_factory, """
        MATCH (n:KGNode)-[:HAS_PROPERTY]->(owner:KGNode)-[:HAS_RULE_CASE]->(:RuleCase)
        WHERE n.type IN $types
        RETURN count(DISTINCT n) AS count
    """, types=CORE_TYPES)[0]["count"]
    audit["condition_outcome_counts"] = run_with_retry(session_factory, """
        OPTIONAL MATCH (:RuleCase)-[c]->(:ConditionExpression)
        WITH count(c) AS cond_edges
        OPTIONAL MATCH (:RuleCase)-[o]->(:Outcome)
        RETURN cond_edges, count(o) AS outcome_edges
    """)

    # --- 5. PREREQUISITE_OF detail --------------------------------------------
    audit["prerequisite_edges"] = run_with_retry(session_factory, """
        MATCH (a:KGNode)-[r:PREREQUISITE_OF]->(b:KGNode)
        RETURN a.node_id AS a_id, a.name AS a_name, a.type AS a_type,
               b.node_id AS b_id, b.name AS b_name, b.type AS b_type,
               r.source AS source, r.confidence AS confidence,
               r.review_status AS review_status
    """)

    # --- 6. implicit edge breakdown -------------------------------------------
    audit["implicit_by_type"] = run_with_retry(session_factory, """
        MATCH (:KGNode)-[r]->(:KGNode)
        WHERE r.source = 'implicit' OR r.review_status IS NOT NULL OR r.confidence IS NOT NULL
        RETURN type(r) AS type,
               count(*) AS count,
               min(r.confidence) AS min_conf, max(r.confidence) AS max_conf,
               collect(DISTINCT coalesce(r.review_status, '<none>')) AS review_states
        ORDER BY count DESC
    """)

    # --- 7. sample sections for naming/LaTeX noise -----------------------------
    audit["section_samples"] = run_with_retry(session_factory, """
        MATCH (n:KGNode) WHERE n.type IN $types AND n.section IS NOT NULL
        RETURN DISTINCT toString(n.section) AS section
        ORDER BY section LIMIT 30
    """, types=CORE_TYPES)

    driver.close()

    # ================= local aggregation ======================================
    node_scope = {}
    for n in nodes:
        node_scope[n["node_id"]] = (n["tb"], n["chapter"], n["section"])

    sec_nodes: Counter = Counter()          # (tb, chapter, section) -> node count
    tb_nodes: Counter = Counter()
    type_by_tb: dict = defaultdict(Counter)
    name_lengths = []
    subsection_present = 0
    for n in nodes:
        key = (n["tb"], n["chapter"], n["section"])
        sec_nodes[key] += 1
        tb_nodes[n["tb"]] += 1
        type_by_tb[n["tb"]][n["type"]] += 1
        name_lengths.append(len(n["name"] or ""))
        if n.get("subsection"):
            subsection_present += 1

    intra_sec: Counter = Counter()          # same-section edges
    intra_ch: Counter = Counter()           # same-chapter cross-section edges
    cross_chapter = 0
    cross_textbook = 0
    edge_types: Counter = Counter()
    implicit_total = 0
    for e in edges:
        edge_types[e["type"]] += 1
        if e.get("source") == "implicit":
            implicit_total += 1
        a = node_scope.get(e["a_id"])
        b = node_scope.get(e["b_id"])
        if not a or not b:
            continue  # endpoint is a non-core KGNode
        if a[0] != b[0]:
            cross_textbook += 1
        elif a[1] != b[1]:
            cross_chapter += 1
        elif a[2] != b[2]:
            intra_ch[(a[0], a[1])] += 1
        else:
            intra_sec[(a[0], a[1], a[2])] += 1

    # per-section density table: every section with its node count and intra edges
    sec_table = []
    for key, ncount in sec_nodes.items():
        ecount = intra_sec.get(key, 0)
        sec_table.append({"tb": key[0], "chapter": key[1], "section": key[2],
                          "nodes": ncount, "intra_edges": ecount})
    sec_table.sort(key=lambda r: (r["tb"], r["chapter"] or "", r["section"] or ""))

    buckets = Counter()
    for row in sec_table:
        e = row["intra_edges"]
        buckets["0" if e == 0 else "1-2" if e <= 2 else "3-5" if e <= 5
                else "6-10" if e <= 10 else ">10"] += 1

    def percentile(values, p):
        if not values:
            return None
        s = sorted(values)
        idx = min(len(s) - 1, max(0, round(p * (len(s) - 1))))
        return s[idx]

    edge_counts = [r["intra_edges"] for r in sec_table]
    node_counts = [r["nodes"] for r in sec_table]

    audit["summary"] = {
        "core_nodes_by_textbook": dict(tb_nodes),
        "core_types_by_textbook": {k: dict(v) for k, v in type_by_tb.items()},
        "section_count": len(sec_table),
        "sections_with_subsection_field": subsection_present,
        "edge_type_counts": dict(edge_types),
        "implicit_edges_total": implicit_total,
        "edges_cross_textbook": cross_textbook,
        "edges_cross_chapter_same_book": cross_chapter,
        "edges_intra_chapter_cross_section": sum(intra_ch.values()),
        "edges_intra_section": sum(intra_sec.values()),
        "section_edge_buckets": dict(buckets),
        "section_nodes_median": percentile(node_counts, 0.5),
        "section_nodes_p90": percentile(node_counts, 0.9),
        "section_intra_edges_median": percentile(edge_counts, 0.5),
        "section_intra_edges_p90": percentile(edge_counts, 0.9),
        "section_intra_edges_max": max(edge_counts) if edge_counts else 0,
        "name_len_median": percentile(name_lengths, 0.5),
        "name_len_p95": percentile(name_lengths, 0.95),
        "name_len_max": max(name_lengths) if name_lengths else 0,
    }
    audit["section_table"] = sec_table

    OUT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")

    # ================= print summary ==========================================
    s = audit["summary"]
    print("=== labels ===")
    for r in audit["labels"]:
        print(f"  {r['label']:<22} {r['count']}")
    print("=== relationship types ===")
    for r in audit["rel_types"]:
        print(f"  {r['type']:<22} {r['count']}")
    print("=== core nodes by textbook ===")
    for tb, c in s["core_nodes_by_textbook"].items():
        print(f"  {tb:<16} {c}  {s['core_types_by_textbook'][tb]}")
    print(f"=== sections: {s['section_count']}  (nodes/section median {s['section_nodes_median']}, p90 {s['section_nodes_p90']}) ===")
    print(f"  subsection field present on {s['sections_with_subsection_field']} nodes")
    print("=== edge scope ===")
    print(f"  intra-section            {s['edges_intra_section']}")
    print(f"  cross-section same ch.   {s['edges_intra_chapter_cross_section']}")
    print(f"  cross-chapter same book  {s['edges_cross_chapter_same_book']}")
    print(f"  cross-textbook           {s['edges_cross_textbook']}")
    print(f"  implicit total           {s['implicit_edges_total']}")
    print("=== section intra-edge buckets (sections count) ===")
    for b in ["0", "1-2", "3-5", "6-10", ">10"]:
        print(f"  {b:<5} {s['section_edge_buckets'].get(b, 0)}")
    print(f"  median {s['section_intra_edges_median']}  p90 {s['section_intra_edges_p90']}  max {s['section_intra_edges_max']}")
    print("=== rules ===")
    print(f"  RuleCase total {audit['rulecase_total']}, direct owners {audit['rule_direct_owners']}, via HAS_PROPERTY {audit['rule_viaproperty_owners']}")
    print(f"  condition/outcome edges: {audit['condition_outcome_counts']}")
    print("=== prerequisites ===")
    for p in audit["prerequisite_edges"]:
        print(f"  {p['a_name']} ({p['a_type']}) -> {p['b_name']} ({p['b_type']})  src={p['source']} conf={p['confidence']} review={p['review_status']}")
    print("=== implicit/meta edges by type ===")
    for r in audit["implicit_by_type"]:
        print(f"  {r['type']:<18} n={r['count']} conf[{r['min_conf']}..{r['max_conf']}] states={r['review_states']}")
    print(f"=== name length: median {s['name_len_median']}, p95 {s['name_len_p95']}, max {s['name_len_max']} ===")
    print(f"\nfull audit written to {OUT_PATH}")


if __name__ == "__main__":
    main()
