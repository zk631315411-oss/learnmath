"""Strip stale `review` labels from the step8 final graph package.

Background: in run `gaodai_v4_4_fullbook_import_ready`, every record whose
review_status == "review" actually carries step7_status == "accepted_by_step7"
(the Step 7 AI review accepted it; the label was never written back).
Per owner decision (trust the pipeline), flip those labels to "auto_accept".

Reads from the ai-math run dir (read-only), writes corrected copies into
the workspace. Prints a per-file manifest; any review record WITHOUT a
step7 acceptance is left untouched and reported.
"""
import json
import shutil
from pathlib import Path

SRC = Path(r"D:/ai-math/教材提取模块/高代提取/归档/正式_runs/gaodai_v4_4_fullbook_import_ready/step8_final_graph")
DST = Path(r"D:/LearnMath/artifacts/kg-label-fix/step8_final_graph")

FILES = [
    "final_core_nodes.jsonl",
    "final_application_nodes.jsonl",
    "final_core_edges.jsonl",
    "final_application_edges.jsonl",
    "final_rule_cases.jsonl",
    "final_knowledge_groups.jsonl",
    "final_knowledge_group_edges.jsonl",
    "step8_assembly_hard_warnings.jsonl",
    "step8_assembly_soft_warnings.jsonl",
]

DST.mkdir(parents=True, exist_ok=True)
manifest = []

for name in FILES:
    src = SRC / name
    dst = DST / name
    if not src.exists():
        manifest.append(f"{name}: 源文件不存在，跳过")
        continue
    total = flipped = kept_review = 0
    kept_rows = []
    out_lines = []
    with open(src, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            total += 1
            r = json.loads(line)
            if r.get("review_status") == "review":
                if r.get("step7_status") in ("accepted_by_step7", "rewritten_by_step7"):
                    r["review_status"] = "auto_accept"
                    r["review_status_corrected"] = True   # 留痕：本次订正过
                    flipped += 1
                else:
                    kept_review += 1
                    kept_rows.append(r)
            out_lines.append(json.dumps(r, ensure_ascii=False))
    dst.write_text("\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8")
    manifest.append(f"{name}: 共{total}，订正 {flipped}，仍为 review {kept_review}")

(DST.parent / "label_fix_manifest.md").write_text(
    "# review 标签订正清单\n\n"
    "规则：review_status=='review' 且 step7_status 属于 accepted_by_step7 / rewritten_by_step7 → 改为 auto_accept，"
    "并加 review_status_corrected=true 留痕。\n\n"
    + "\n".join(f"- {m}" for m in manifest) + "\n",
    encoding="utf-8",
)
print("\n".join(manifest))
print(f"\n输出目录: {DST}")
