# -*- coding: utf-8 -*-
"""
把每个 KG 节点的 evidence_span 对齐到 OCR 行的精确位置（PDF 物理页 + bbox），产出静态 JSON。

用法：
  python build_node_highlights.py --textbook gaodai_shang   # 跑一本
  python build_node_highlights.py --all                     # 4 本全跑
  python build_node_highlights.py --check                   # 抽查渲染（高代上 1.1×3 + 3.2×2）

产物：D:/LearnMath/shared/ocr/<textbook_id>.node_highlights.json
      { node_id: {"page": N, "bbox": [x0,y0,x1,y1], "sim": 0.9, "low_confidence": false}, ... }
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

OCR_DIR = "D:/LearnMath/shared/ocr"
CATALOG_DIR = "D:/LearnMath/frontend/public/map-catalog"
CHECK_DIR = "D:/LearnMath/scripts/highlight_check"

NEO4J_URI = "neo4j+s://c60acc31.databases.neo4j.io"
NEO4J_AUTH = ("c60acc31", "9Yz9wnh0mPXeuXmFm4heu8-0hoj92h9aNDMh_-o3-aA")

TEXTBOOKS = ["gaodai_shang", "gaodai_xia", "gaoshu_shang", "gaoshu_xia"]
PDF_MAP = {
    "gaodai_shang": "D:/LearnMath/data/textbooks/gaodai_vol1.pdf",
    "gaodai_xia": "D:/LearnMath/data/textbooks/高等代数下册_丘维声.pdf",
    "gaoshu_shang": "D:/LearnMath/data/textbooks/高等数学第二版上册黄立宏主编.pdf",
    "gaoshu_xia": "D:/LearnMath/data/textbooks/高等数学第二版下册黄立宏主编.pdf",
}

SIM_OK = 0.5          # >= 0.5 视为成功匹配
FALLBACK_SIM = 0.35   # 候选窗口最佳低于此值时回退全书搜索
PAGE_WINDOW = 2       # catalog page ±2 候选页
MAX_SPAN = 4          # 滑窗 1~4 行
MIN_EV_LEN = 6        # 归一化后证据太短则不匹配


def normalize(s: str) -> str:
    """去 LaTeX/空白/标点的归一化，专用于证据句模糊匹配"""
    s = re.sub(r"\$+([^$]*)\$+", r"\1", s)          # 去 $...$ 包裹
    s = re.sub(r"\\[a-zA-Z]+", "", s)               # 去 \frac \mathbb 等命令名
    s = re.sub(r"[{}^_~]", "", s)                    # 去结构符
    s = re.sub(r"\s+", "", s)                        # 去全部空白
    for ch in "：，。、；：！？（）()【】《》\"'“”‘’·—-":
        s = s.replace(ch, "")
    return s


def char_sim(a: str, b: str) -> float:
    """a 在 b 上的字符覆盖率：|交集|/|a|（无序，够用且稳健）"""
    if not a:
        return 0.0
    ca, cb = Counter(a), Counter(b)
    return sum((ca & cb).values()) / len(a)


def load_catalog_nodes(textbook_id):
    """从 catalog 展平节点：node_id/name/type/page/section_node_id/section_id/section_name。
    page 取 node.page，缺失回退 section.page，再缺失为 None（由锚定估算）。"""
    path = os.path.join(CATALOG_DIR, f"{textbook_id}.json")
    with open(path, encoding="utf-8") as f:
        cat = json.load(f)
    nodes = []
    for ch in cat["chapters"]:
        for sec in ch["sections"]:
            for nd in sec["nodes"]:
                page = nd.get("page") if nd.get("page") is not None else sec.get("page")
                nodes.append({
                    "node_id": nd["node_id"],
                    "name": nd["name"],
                    "type": nd.get("type", ""),
                    "page": page,
                    "page_exact": page is not None,  # catalog 原生页码才算精确
                    "section_node_id": nd.get("section_node_id", ""),
                    "section_id": sec["id"],
                    "section_name": sec.get("name", ""),
                })
    return nodes


def find_heading_page(heading, seq_by_page, max_page, min_len=6):
    """全书搜章节/节标题首次出现的页（标题通常独占一行或行首）"""
    h = normalize(heading)
    if len(h) < 4:
        return None
    for p in sorted(seq_by_page):
        for _, bbox, txt in seq_by_page[p]:
            if h in txt or txt in h and len(txt) >= 4:
                return p
    return None


def estimate_section_pages(nodes, seq_by_page, max_page):
    """
    对 page 缺失的书：用各节标题在 OCR 中的命中页做锚点，
    节内/节间按节点顺序线性插值估算每个节点的候选中心页。
    """
    # 每节首节点顺序与节名
    secs = []
    seen = set()
    for nd in nodes:
        sid = nd["section_node_id"]
        if sid not in seen:
            seen.add(sid)
            secs.append((sid, nd["section_name"]))
    anchors = []  # (sec_idx, page)
    for i, (sid, sname) in enumerate(secs):
        p = find_heading_page(sname, seq_by_page, max_page)
        if p:
            anchors.append((i, p))
    if len(anchors) < 2:
        return
    # 相邻锚点间插值；首锚前/末锚后按最近锚点延伸
    def interp(idx):
        if idx <= anchors[0][0]:
            return anchors[0][1]
        if idx >= anchors[-1][0]:
            return anchors[-1][1]
        for (i0, p0), (i1, p1) in zip(anchors, anchors[1:]):
            if i0 <= idx <= i1:
                t = (idx - i0) / max(i1 - i0, 1)
                return round(p0 + t * (p1 - p0))
        return anchors[-1][1]
    sec_page = {sid: interp(i) for i, (sid, _) in enumerate(secs)}
    for nd in nodes:
        if nd["page"] is None:
            nd["page"] = sec_page.get(nd["section_node_id"])


def fetch_evidence(node_ids):
    """批量从 KG 取 evidence_span，返回 {node_id: ev}"""
    from neo4j import GraphDatabase
    driver = GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)
    ev_map = {}
    with driver.session() as s:
        for i in range(0, len(node_ids), 500):
            batch = node_ids[i:i + 500]
            r = s.run(
                "UNWIND $ids AS nid MATCH (n:KGNode {node_id: nid}) "
                "RETURN nid AS id, n.evidence_span AS ev",
                ids=batch,
            )
            for rec in r:
                ev_map[rec["id"]] = rec["ev"] or ""
    driver.close()
    return ev_map


def load_ocr_pages(textbook_id):
    """返回 {page: [(bbox, norm_text)], ...}，行按 (y0, x0) 排序；max_page"""
    path = os.path.join(OCR_DIR, f"{textbook_id}.ocr_lines.jsonl")
    pages = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            pages.setdefault(d["page"], []).append((d["bbox"], normalize(d["text"])))
    for p in pages:
        pages[p].sort(key=lambda t: (t[0][1], t[0][0]))
    return pages, max(pages)


def best_window_in_seq(seq, ev_norm):
    """
    seq: [(page, bbox, norm_text), ...] 相邻候选页拼成的序列（跨页窗口允许）。
    滑窗 1~MAX_SPAN 行，返回 (sim, page, bbox)。page 取窗口中行数最多的页，
    bbox 只合并该页的行（输出格式要求单页单框）。
    """
    best = (0.0, None, None)
    n = len(seq)
    for i in range(n):
        txt = ""
        for span in range(1, MAX_SPAN + 1):
            if i + span > n:
                break
            txt += seq[i + span - 1][2]
            sim = char_sim(ev_norm, txt)
            if sim > best[0]:
                win = seq[i:i + span]
                cnt = Counter(w[0] for w in win)
                main_page = cnt.most_common(1)[0][0]
                boxes = [w[1] for w in win if w[0] == main_page]
                bbox = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                        max(b[2] for b in boxes), max(b[3] for b in boxes)]
                best = (sim, main_page, bbox)
    return best


def match_node(ev_norm, cand_pages, all_seq_by_page):
    """在候选页序列中匹配；seq 为 [(page, bbox, norm)]"""
    seq = []
    for p in cand_pages:
        seq.extend(all_seq_by_page.get(p, []))
    if not seq:
        return 0.0, None, None
    return best_window_in_seq(seq, ev_norm)


def run_textbook(textbook_id):
    print(f"\n===== {textbook_id} =====")
    nodes = load_catalog_nodes(textbook_id)
    print(f"[catalog] {len(nodes)} 个节点")
    ev_map = fetch_evidence([n["node_id"] for n in nodes])
    pages, max_page = load_ocr_pages(textbook_id)
    # 预构建 {page: [(page, bbox, norm)]}
    seq_by_page = {p: [(p, b, t) for b, t in lines] for p, lines in pages.items()}
    if any(nd["page"] is None for nd in nodes):
        estimate_section_pages(nodes, seq_by_page, max_page)
        missing = sum(1 for nd in nodes if nd["page"] is None)
        print(f"[锚定] 估算节页码完成，仍缺页节点 {missing}")

    result = {}
    stat = {"total": len(nodes), "ok": 0, "low": 0, "no_ev": 0, "fallback_hit": 0}
    for idx, nd in enumerate(nodes):
        ev = (ev_map.get(nd["node_id"]) or "").strip()
        if not ev:
            stat["no_ev"] += 1
            continue
        ev_norm = normalize(ev)
        if len(ev_norm) < MIN_EV_LEN:
            stat["no_ev"] += 1
            continue
        cp = nd["page"] or 1
        # 锚定估算页误差更大，窗口放宽到 ±4
        win = PAGE_WINDOW if nd.get("page_exact") else 4
        cand = [p for p in range(cp - win, cp + win + 1)
                if 1 <= p <= max_page]
        sim, page, bbox = match_node(ev_norm, cand, seq_by_page)
        if sim < FALLBACK_SIM:
            # 候选页没匹配好，回退全书
            sim2, page2, bbox2 = match_node(ev_norm, sorted(pages), seq_by_page)
            if sim2 > sim:
                sim, page, bbox = sim2, page2, bbox2
                stat["fallback_hit"] += 1
        if page is None:
            stat["low"] += 1
            continue
        low = sim < SIM_OK
        stat["low" if low else "ok"] += 1
        result[nd["node_id"]] = {
            "page": page,
            "bbox": [round(v, 2) for v in bbox],
            "sim": round(float(sim), 3),
            "low_confidence": low,
        }
        if (idx + 1) % 200 == 0:
            print(f"  进度 {idx+1}/{len(nodes)}")

    out_path = os.path.join(OCR_DIR, f"{textbook_id}.node_highlights.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    matched = stat["ok"] + stat["low"]
    rate = stat["ok"] / matched * 100 if matched else 0
    print(f"[统计] 节点 {stat['total']} | 匹配 {matched} (高置信 {stat['ok']}, "
          f"{rate:.1f}%) | 低置信 {stat['low']} | 无evidence {stat['no_ev']} | "
          f"全书回退命中 {stat['fallback_hit']}")
    print(f"[产物] {out_path}")
    return stat


def render_check():
    """高代上 1.1 节 3 节点 + 3.2 节 2 节点，画框渲染 PNG 人工核对"""
    import fitz
    os.makedirs(CHECK_DIR, exist_ok=True)
    hl_path = os.path.join(OCR_DIR, "gaodai_shang.node_highlights.json")
    with open(hl_path, encoding="utf-8") as f:
        hl = json.load(f)
    nodes = load_catalog_nodes("gaodai_shang")
    picks = ([n for n in nodes if n["section_id"] == "1.1"][:3]
             + [n for n in nodes if n["section_id"] == "3.2"][:2])
    doc = fitz.open(PDF_MAP["gaodai_shang"])
    for nd in picks:
        h = hl.get(nd["node_id"])
        if not h:
            print(f"[check] {nd['name']} 无匹配，跳过")
            continue
        page = doc[h["page"] - 1]
        pix = page.get_pixmap(dpi=150)
        page.draw_rect(fitz.Rect(h["bbox"]), color=(1, 0, 0), width=3)
        page.draw_rect(fitz.Rect(h["bbox"]), color=(1, 0.6, 0), width=1)
        out = os.path.join(
            CHECK_DIR,
            f"{nd['section_id']}_{nd['name'].replace('/', '_')}_p{h['page']}_sim{h['sim']}.png")
        page.get_pixmap(dpi=150).save(out)
        print(f"[check] {nd['section_id']} {nd['name']}: p{h['page']} "
              f"sim={h['sim']} low={h['low_confidence']} -> {out}")
    doc.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--textbook", choices=TEXTBOOKS)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--check", action="store_true", help="抽查渲染（需先跑 gaodai_shang）")
    args = ap.parse_args()
    if args.check:
        render_check()
        return
    targets = TEXTBOOKS if args.all else [args.textbook] if args.textbook else []
    if not targets:
        ap.error("请指定 --textbook 或 --all 或 --check")
    for tb in targets:
        run_textbook(tb)


if __name__ == "__main__":
    main()
