# -*- coding: utf-8 -*-
"""
知识点级 PDF 页码落点 —— 可行性验证脚本（PoC，不改正式代码）

思路：
  1) 基准 md = 高等代数上册_full_clean.md（正文从第 1 行开始，无目录区）。
     KG 节点的 line_start/line_end 是该节点所属"小节"(U01=内容精华/U02=典型例题)
     在基准 md 中的行区间（节级区间，多数节点共享）。
  2) 页码映射：基准 md 无目录页码，故用 _structured.md 的目录区
     （含书页码，如 "3.2 ………… (87)"）建立 标题文本→书页码，
     再用书签/标题文本匹配把基准 md 的行区间接到书页码上。
  3) 书页码→PDF 物理页偏移：用 PDF 书签（toc）中多个章/节的
     (书页码, 物理页) 对做线性校准（取中位数偏移并检验一致性）。
  4) 节点→页：line_start 落在哪个小节区间 → 小节书页码 + 节内位置插值
     → 书页码 → +偏移 → PDF 物理页；再用 fitz 抽该页文本，检查
     evidence_span 关键词是否真在该页。
"""
import re
import sys
import fitz
from neo4j import GraphDatabase

BASE_MD = "D:/ai-math/教材提取模块/高代提取/归档/中间产物/高等代数上册_full_clean.md"
TOC_MD = "D:/ai-math/比赛相关文件与文件夹/揭榜挂帅/教材库/高等代数/高等代数上册_structured.md"
PDF = "D:/LearnMath/data/textbooks/gaodai_vol1.pdf"

NEO4J_URI = "neo4j+s://c60acc31.databases.neo4j.io"
NEO4J_AUTH = ("c60acc31", "9Yz9wnh0mPXeuXmFm4heu8-0hoj92h9aNDMh_-o3-aA")


def norm(s: str) -> str:
    """归一化：去空白、去 markdown 强调/数学符号差异"""
    s = re.sub(r"\s+", "", s)
    s = s.replace("$", "").replace("\\pmb{", "").replace("\\mathbf{", "")
    s = s.replace("{", "").replace("}", "").replace("\\", "")
    s = s.replace("：", "").replace(":", "")
    s = re.sub(r"[…\.]+$", "", s)
    return s.strip("*").strip()


# ---------- 1. 解析目录区：标题 -> 书页码 ----------
def parse_toc():
    toc = {}  # 归一化标题 -> 书页码
    for line in open(TOC_MD, encoding="utf-8"):
        m = re.match(r"^\s*(?:#+\s*)?(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*[…\.\s]*\((\d+)\)\s*\*?\*?\s*$", line)
        if m:
            title, page = m.group(1), int(m.group(2))
            if re.match(r"^(第\d+章|\d+\.\d+|引言|习题|补充题|应用小天地)", title):
                toc.setdefault(norm(title), page)
    return toc


# ---------- 2. 解析基准 md 标题行 ----------
def parse_base_headings():
    heads = []  # (line_no, level, raw_title, norm_title)
    for i, line in enumerate(open(BASE_MD, encoding="utf-8"), 1):
        m = re.match(r"^(#{1,4})\s+(.+?)\s*$", line)
        if m:
            heads.append((i, len(m.group(1)), m.group(2), norm(m.group(2))))
    return heads


# ---------- 3. PDF 偏移校准 ----------
def calibrate_offset(doc, toc):
    pairs = []
    pdf_toc = doc.get_toc()
    for lvl, title, phys in pdf_toc:
        nt = norm(title)
        # 只用 x.y / x.y.z 节级书签校准：章名会命中书末习题答案页
        if nt in toc and re.match(r"^\d+\.\d+", nt):
            pairs.append((toc[nt], phys, title))
    offsets = [phys - book for book, phys, _ in pairs]
    offsets_sorted = sorted(offsets)
    med = offsets_sorted[len(offsets) // 2] if offsets else None
    return med, pairs


def main():
    toc = parse_toc()
    heads = parse_base_headings()
    doc = fitz.open(PDF)

    # --- 基准 md 标题 -> 书页码 ---
    sec_marks = []  # (line_no, book_page, title)
    unmatched = []
    for ln, lvl, raw, nt in heads:
        if nt in toc:
            sec_marks.append((ln, toc[nt], raw))
        elif lvl <= 3:
            unmatched.append((ln, raw))
    sec_marks.sort()

    print(f"[目录条目] {len(toc)} 个; [基准md标题] {len(heads)} 个; [对上页码] {len(sec_marks)} 个")
    if unmatched:
        print(f"[未对上页码的标题] {len(unmatched)} 个, 例:", [u[1][:30] for u in unmatched[:5]])

    # --- 偏移校准 ---
    med_off, pairs = calibrate_offset(doc, toc)
    print(f"\n[偏移校准] 书签对 {len(pairs)} 个, 偏移中位数 = {med_off}")
    bad = [(t, b, p, p - b) for b, p, t in pairs if p - b != med_off]
    if bad:
        print("  偏移不一致的书签:", [(t[:20], f"off={o}") for t, _, _, o in bad[:6]])
    else:
        print("  所有书签偏移一致")

    def line_to_bookpage(line_no):
        """行号 -> (书页码, 所属小节起止)"""
        prev = None
        nxt = None
        for ln, pg, t in sec_marks:
            if ln <= line_no:
                prev = (ln, pg, t)
            else:
                nxt = (ln, pg, t)
                break
        return prev, nxt

    # --- 抽样节点 ---
    driver = GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)
    samples = []
    with driver.session() as s:
        for sec, unit, label in [
            ("gaodai_shang:C01:S01:U01", "1.1 内容精华", "1.1"),
            ("gaodai_shang:C01:S01:U02", "1.1 典型例题", "1.1"),
            ("gaodai_shang:C03:S02:U01", "3.2 内容精华", "3.2"),
            ("gaodai_shang:C03:S02:U02", "3.2 典型例题", "3.2"),
        ]:
            r = s.run(
                """MATCH (n:KGNode) WHERE n.section_node_id=$sec AND n.line_start>0
                   AND ANY(l IN labels(n) WHERE l IN ['Concept','Theorem','Formula','Method','ProblemClass'])
                   RETURN n.node_id AS id, n.name AS name, labels(n) AS lb,
                          n.line_start AS ls, n.line_end AS le, n.evidence_span AS ev
                   ORDER BY n.line_start LIMIT 2""",
                sec=sec,
            )
            samples.extend([(label, rec) for rec in r])
    driver.close()

    print("\n===== 节点 → PDF 页 验证 =====")
    n_ok = n_tot = 0
    for sec_label, rec in samples:
        ls, le, ev = rec["ls"], rec["le"], rec["ev"] or ""
        prev, nxt = line_to_bookpage(ls)
        if not prev:
            print(f"[{sec_label}] {rec['name'][:24]:26s} line={ls}: 无前置标题锚点")
            continue
        start_ln, start_pg, start_t = prev
        end_ln = nxt[0] if nxt else 10**9
        end_pg = nxt[1] if nxt else start_pg + 6  # 末尾外推
        span_ln = max(end_ln - start_ln, 1)
        span_pg = max(end_pg - start_pg, 1)
        frac = min(max((ls - start_ln) / span_ln, 0), 1)
        book_pg = start_pg + round(frac * span_pg)
        phys_pg = book_pg + med_off

        # 验证：PDF 为扫描版无文本层，渲染推断页 ±1 页为 PNG 供人工核对
        n_tot += 1
        typ = [l for l in rec["lb"] if l != "KGNode"][0]
        out = f"D:/LearnMath/scripts/poc_pages/node_{n_tot:02d}_pdf{phys_pg}.png"
        import os
        os.makedirs(os.path.dirname(out), exist_ok=True)
        for p in range(max(phys_pg - 1, 1), min(phys_pg + 1, doc.page_count) + 1):
            png = out.replace(f"_pdf{phys_pg}.png", f"_pdf{p}.png")
            doc[p - 1].get_pixmap(dpi=100).save(png)
        print(
            f"[{sec_label}] {rec['name'][:24]:26s} {typ:13s} line {ls:5d} -> 书页 {book_pg:3d} -> PDF {phys_pg:3d}"
            f" | evidence: {norm(ev)[:30]}"
        )
    print(f"\n截图输出到 D:/LearnMath/scripts/poc_pages/ （每个节点渲染 推断页±1 共3张）")
    print(f"PDF 总页数: {doc.page_count}")


if __name__ == "__main__":
    main()
