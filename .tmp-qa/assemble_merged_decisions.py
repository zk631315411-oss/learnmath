# -*- coding: utf-8 -*-
"""组装合并版 ai_review_decisions.jsonl：
= 原运行 3867 条裁决（剔除 19 条已失效的旧 1.3 条目）
+ 新 1.3 的 12 条真审裁决（其中 4 条 U02 应用节点 defer→accept 人工覆盖，理由附在 reason）
"""
import hashlib
import json
from pathlib import Path

M = Path(r"D:/LearnMath/artifacts/kg-13-merged")
ORIG = Path(r"D:/ai-math/教材提取模块/高代提取/归档/正式_runs/gaodai_v4_4_fullbook_import_ready/step7_review")

items = [json.loads(l) for l in (M / "step7_review/review_items.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
item_ids = {i["review_item_id"] for i in items}
orig = [json.loads(l) for l in (ORIG / "ai_review_decisions.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
fresh = [json.loads(l) for l in (M / "step7_review_fresh/ai_review_decisions.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

kept_orig = [d for d in orig if d["review_item_id"] in item_ids]
print(f"原裁决复用: {len(kept_orig)} / {len(orig)}（剔除失效 {len(orig)-len(kept_orig)}）")

# U02 四节点 defer→accept 覆盖（与原运行对同义旧节点的 accept 裁决保持一致标准）
OVERRIDE = {
    "review-item:e6ed846f5e9440": "数域验证问题",      # ≈ 旧「证明给定集合是数域问题」原审 accept 0.90
    "review-item:0c02c4a34d1a1f": "数域判定问题",      # ≈ 旧「判定给定数集是否为数域问题」原审 accept 0.88
    "review-item:775f48f95e52bb": "定义验证法",        # 与旧「封闭性验证法」同族；且与另一节同名节点合并
    "review-item:1684ce7927f41c": "反例法",            # ≈ 旧「反例判定法」原审 accept 0.87；与「举反例法」合并
}
OVERRIDE_REASON = (
    "【人工覆盖 defer→accept】新鲜审核以 definition 缺失为由建议暂缓；"
    "原全书运行对同义节点给出 accept（conf 0.87-0.94，理由：常见可复用题型/方法）。"
    "为与原库既收标准一致（用户当前库已收同义节点），按原标准收录；definition 缺口记为后续补全事项。"
)

def bump_id(d: dict, action: str) -> None:
    # decision_id 重新生成（stable_id 方案：sha1(prefix|parts)[:14]）
    d["decision_id"] = "step7b:" + hashlib.sha1(f"step7b|{d['review_item_id']}|{action}".encode()).hexdigest()[:14]


fresh_fixed = []
for d in fresh:
    if d["review_item_id"] in OVERRIDE and d["action"] == "defer":
        d["action"] = "accept"
        d["target_layer"] = "example_application"
        d["reason"] = (d.get("reason") or "") + " " + OVERRIDE_REASON
        d["human_override"] = True
        bump_id(d, "accept")
    fresh_fixed.append(d)

merged = kept_orig + fresh_fixed

# 追加裁决修复：xia 定义验证法 节点是 429 限流 defer 的网络牺牲品（原裁决 reason 即为 HTTP 429）。
# 原运行有 6 条 AI 审核 accept 的 USES 边指向它（ dangling 后被 08a 丢弃），且本次新鲜审核的合并候选
# 独立确认 定义验证法 为可复用方法（accept_merge 0.96）。捞回该节点使合并落地、6 条边复活。
XIA_NODE_RID = "review-item:61c388533f382f"
for d in merged:
    if d["review_item_id"] == XIA_NODE_RID and d["action"] == "defer":
        assert "429" in (d.get("reason") or "") or "调用失败" in (d.get("reason") or ""), "该 defer 非网络失败，停止覆盖"
        d["action"] = "accept"
        d["target_layer"] = "example_application"
        d["reason"] = (d.get("reason") or "") + (
            "【人工覆盖 defer→accept】原裁决为 429 限流网络失败的保守暂缓，非语义否定；"
            "原运行已有 6 条审核 accept 的 USES 边指向本节点，且增量审核的合并候选确认其为可复用方法。"
            "按用户「信任管线、清理网络事故假标签」的既有裁决精神捞回。"
        )
        d["human_override"] = True
        bump_id(d, "accept")
        break
else:
    raise AssertionError("未找到 xia 定义验证法 的 defer 裁决")
# 覆盖性断言：合并裁决必须恰好覆盖全部 review_items，且无重复
dec_ids = [d["review_item_id"] for d in merged]
assert len(dec_ids) == len(set(dec_ids)), "存在重复 review_item_id！"
assert set(dec_ids) == item_ids, f"覆盖不完全: 缺 {len(item_ids - set(dec_ids))}, 多 {len(set(dec_ids) - item_ids)}"

out = M / "step7_review/ai_review_decisions.jsonl"
out.write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in merged), encoding="utf-8")
print(f"新鲜裁决: {len(fresh_fixed)}（含覆盖 {sum(1 for d in fresh_fixed if d.get('human_override'))} 条）")
print(f"合并裁决总数: {len(merged)}，完整覆盖 review_items=3860 ✓")

from collections import Counter
c = Counter((d["item_kind"], d["action"]) for d in merged)
for k, v in sorted(c.items()):
    print(f"  {k}: {v}")
