# -*- coding: utf-8 -*-
"""构建合并 combined 包：原全书 combined 去掉 C01:S03 旧条目 + 新 1.3 重抽条目。

输入（只读）：
  原运行 combined: D:/ai-math/教材提取模块/高代提取/归档/正式_runs/gaodai_v4_4_fullbook_import_ready/combined
  新 1.3 产物:     D:/LearnMath/artifacts/kg-13-reextract/上册
输出：
  D:/LearnMath/artifacts/kg-13-merged/combined/*.jsonl
"""
import hashlib
import json
from pathlib import Path

ORIG = Path(r"D:/ai-math/教材提取模块/高代提取/归档/正式_runs/gaodai_v4_4_fullbook_import_ready/combined")
NEW = Path(r"D:/LearnMath/artifacts/kg-13-reextract/上册")
OUT = Path(r"D:/LearnMath/artifacts/kg-13-merged/combined")
OUT.mkdir(parents=True, exist_ok=True)

SEC = "C01:S03"
STAMP = "kg-13-reextract-2026-08-20"
DELETED_NODE_IDS = {"gaodai_shang:node:0e0db5c0cdcd", "gaodai_shang:node:aab57efe90d4"}


def load(p: Path):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def save(p: Path, rows):
    p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def is_s13(row: dict) -> bool:
    return SEC in str(row.get("section_node_id") or "") or SEC in str(row.get("parent_section_node_id") or "")


def stamp(row: dict) -> dict:
    row["incremental_provenance"] = STAMP
    return row


# ---------- 新 1.3 条目 ----------
new_nodes = [stamp(r) for r in load(NEW / "_chunks_step3a_node_audit/S03/nodes.jsonl")]
new_edges = [stamp(r) for r in load(NEW / "_chunks_step4c_edge_rule_case_audit/S03/edges.jsonl")]
new_rule_cases = [stamp(r) for r in load(NEW / "_chunks_step4c_edge_rule_case_audit/S03/rule_cases.jsonl")]
new_app_nodes = [stamp(r) for r in load(NEW / "example_app_nodes.jsonl")]
new_app_edges = [stamp(r) for r in load(NEW / "example_app_edges.jsonl")]

# DERIVES -> HAS_PROPERTY 人工裁决改写（用户 22:11 批准）
queue = load(NEW / "_chunks_step4c_edge_rule_case_audit/S03/edge_review_queue.jsonl")
assert len(queue) == 1, f"edge_review_queue 应为 1 条，实际 {len(queue)}"
rw = queue[0]
old_edge_id = rw["edge_id"]
raw = "|".join([rw["source_node_id"], rw["target_node_id"], "HAS_PROPERTY", rw["section_node_id"]])
rw["edge_id"] = f"{rw.get('textbook_id','gaodai_shang')}:edge:{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:14]}"
rw["type"] = "HAS_PROPERTY"
rw["review_status"] = "auto_accept"
rw["review_recommended"] = False
rw["review_reason"] = ""
rw["validation_warnings"] = []
rw["description"] = "由定义1可知复数域是最大的数域，数域具有“复数域是最大的数域”这一性质。"
rw["human_override"] = {
    "original_edge_id": old_edge_id,
    "original_type": "DERIVES",
    "decided_by": "user_approved_assistant_proposal",
    "decided_at": "2026-08-20",
    "reason": "step4c 裁决：DERIVES 的 source 应为推导依据（定义1），source 为 Concept 数域 类型不当；按其建议改为 HAS_PROPERTY，与同节 数域-HAS_PROPERTY->任一数域都包含有理数域 同构。",
}
stamp(rw)
new_edges.append(rw)

# ---------- 合并 ----------
specs = {
    "nodes.jsonl": (new_nodes, "node_id"),
    "node_review_queue.jsonl": ([], "node_id"),
    "edges.jsonl": (new_edges, "edge_id"),
    "edge_review_queue.jsonl": ([], "edge_id"),
    "rule_cases.jsonl": (new_rule_cases, "rule_case_id"),
    "rule_case_review_queue.jsonl": ([], "rule_case_id"),
    "example_app_nodes.jsonl": (new_app_nodes, "app_node_id"),
    "example_app_edges.jsonl": (new_app_edges, "app_edge_id"),
}

print(f"{'file':38s} {'orig':>6s} {'drop':>6s} {'add':>4s} {'final':>6s}")
for fname, (adds, idkey) in specs.items():
    orig = load(ORIG / fname)
    kept = [r for r in orig if not is_s13(r)]
    merged = kept + adds
    # 去重检查
    ids = [str(r.get(idkey) or "") for r in merged]
    dupes = {i for i in ids if i and ids.count(i) > 1}
    if dupes:
        # app 文件的 id 字段名可能不同，先报告
        print(f"  [warn] {fname} id 字段 {idkey} 重复: {list(dupes)[:3]} (可能 idkey 不对)")
    save(OUT / fname, merged)
    print(f"{fname:38s} {len(orig):6d} {len(orig)-len(kept):6d} {len(adds):4d} {len(merged):6d}")

# ---------- 安全断言：merged 全文中不得再引用被删除的两个旧节点 id ----------
bad = []
for f in OUT.glob("*.jsonl"):
    text = f.read_text(encoding="utf-8")
    for oid in DELETED_NODE_IDS:
        if oid in text:
            bad.append((f.name, oid))
print("\n被删旧节点 id 残留引用:", bad if bad else "0（安全）")

# 新边 id 唯一性
all_eids = [json.loads(l)["edge_id"] for l in (OUT / "edges.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
print("edges.jsonl id 唯一:", len(all_eids) == len(set(all_eids)), f"({len(all_eids)} 条)")
print("改写边新 id:", rw["edge_id"], "在库中唯一:", all_eids.count(rw["edge_id"]) == 1)
