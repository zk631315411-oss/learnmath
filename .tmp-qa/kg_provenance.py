"""Q4 probe: are the '1.1' nodes really from section 1.1 body text?
Checks provenance fields, suspicious-node property dumps, same-name
nodes elsewhere, and whether intro/TOC buckets exist. Read-only."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from neo4j import GraphDatabase  # noqa: E402
from app.config import config  # noqa: E402

OUT = Path(__file__).resolve().parent / "kg_provenance.json"


def main() -> None:
    driver = GraphDatabase.driver(
        config.NEO4J_URI,
        auth=(config.NEO4J_USER, config.NEO4J_PASSWORD),
        connection_timeout=10.0,
    )
    db = os.getenv("NEO4J_DATABASE", "neo4j")
    database = None if db in {"", "neo4j", "default"} else db

    def sf():
        return driver.session(database=database)

    def q(cypher, **kw):
        last = None
        for a in range(4):
            try:
                with sf() as s:
                    return [dict(r) for r in s.run(cypher, **kw)]
            except Exception as e:  # Aura cold start
                last = e
                if a < 3:
                    time.sleep(1.5 * (a + 1))
        raise last

    out = {}

    # 1. every property key present on gaodai_shang KGNodes (is there provenance?)
    out["prop_keys"] = q("""
        MATCH (n:KGNode) WHERE coalesce(n.textbook_id, split(n.node_id, ':')[0]) = 'gaodai_shang'
        WITH keys(n) AS ks UNWIND ks AS k
        RETURN k, count(*) AS c ORDER BY c DESC
    """)

    # 2. full property dump of suspicious / representative 1.1 nodes
    out["samples"] = q("""
        MATCH (n:KGNode)
        WHERE coalesce(n.textbook_id, split(n.node_id, ':')[0]) = 'gaodai_shang'
          AND toString(n.section) STARTS WITH '1.1'
          AND n.name IN $names
        RETURN n.name AS name, n.type AS type, properties(n) AS props
    """, names=["矩阵", "方阵", "零矩阵", "主元", "同解方程组", "可行解",
                "增广矩阵", "阶梯形矩阵", "n元线性方程组", "线性方程组"])

    # 3. same-name nodes anywhere else in this textbook (mis-tag / duplicate check)
    out["same_name_elsewhere"] = q("""
        MATCH (n:KGNode)
        WHERE coalesce(n.textbook_id, split(n.node_id, ':')[0]) = 'gaodai_shang'
          AND n.name IN $names
        RETURN n.name AS name,
               collect(DISTINCT toString(n.chapter) + ' / ' + toString(n.section)) AS where_found,
               count(*) AS copies
        ORDER BY copies DESC, name
    """, names=["矩阵", "方阵", "零矩阵", "主元", "同解方程组", "可行解",
                "增广矩阵", "阶梯形矩阵", "n元线性方程组", "线性方程组"])

    # 4. chapter-1 section buckets incl. possible intro/TOC buckets
    out["chapter1_buckets"] = q("""
        MATCH (n:KGNode)
        WHERE coalesce(n.textbook_id, split(n.node_id, ':')[0]) = 'gaodai_shang'
          AND (toString(n.chapter) STARTS WITH '第1章' OR toString(n.section) STARTS WITH '1.')
        RETURN toString(n.chapter) AS chapter, toString(n.section) AS section, count(*) AS c
        ORDER BY section
    """)

    # 5. subsection field usage within 1.1
    out["subsection_11"] = q("""
        MATCH (n:KGNode)
        WHERE coalesce(n.textbook_id, split(n.node_id, ':')[0]) = 'gaodai_shang'
          AND toString(n.section) STARTS WITH '1.1'
        RETURN n.name AS name, n.subsection AS subsection
    """)

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("written", OUT)
    print("prop keys:", [r["k"] for r in out["prop_keys"]])
    print("chapter1 buckets:", out["chapter1_buckets"])
    print("same-name copies:", [(r["name"], r["copies"]) for r in out["same_name_elsewhere"]])
    subs = [r["subsection"] for r in out["subsection_11"]]
    print("subsection filled in 1.1:", sum(1 for x in subs if x), "/", len(subs))


if __name__ == "__main__":
    main()
