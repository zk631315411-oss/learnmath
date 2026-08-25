"""页内提问的 KG 页上下文 — 把「学生当前页」翻译成模型可定位的知识点清单。

ai-math 旧项目用 textbook_sections 表注入整节原文；LearnMath 走 KG 路线：
页码 →（PDF 书签）→ 小节号 →（Neo4j 节点 section 前缀）→ 本页知识点列表。
注入后模型面对「这页哪里没看懂」等笼统页内提问时，能用具体节点名调用
retrieve_kg_context，从而让证据回路（learning map）正常运转。

任何一步失败（PDF 缺失、KG 不可达、小节无节点）都返回空串，
调用方原样继续问答，不得因页上下文缺失阻断教学。
"""
from __future__ import annotations

from app.db import kg_v44
from app.services.learning.section_page import page_sections

MAX_NODES_IN_CONTEXT = 15


def build_page_kg_context(textbook_id: str | None, page_number: int | None) -> str:
    """构造注入用户消息的页上下文块；无可用信息时返回空串。"""
    clean_book = (textbook_id or "").strip()
    if not clean_book or not page_number:
        return ""
    section_code = page_sections(clean_book).get(int(page_number))
    if not section_code:
        return ""
    nodes = kg_v44.list_kg_nodes_by_section(clean_book, section_code)
    if not nodes:
        return f"【学生当前位置】教材第 {page_number} 页（小节 {section_code}）"

    section_title = str(nodes[0].get("section") or section_code).strip()
    names: list[str] = []
    for node in nodes:
        name = str(node.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
    shown = names[:MAX_NODES_IN_CONTEXT]
    suffix = f" 等 {len(names)} 个" if len(names) > len(shown) else ""
    return (
        f"【学生当前位置】教材第 {page_number} 页（{section_title}）\n"
        f"【本页知识点】{'、'.join(shown)}{suffix}\n"
        "若学生的问题与本页内容相关（包括「这页」「本页」等指代），优先用上述具体名称"
        "调用 retrieve_kg_context 定位；问题明显超出本页范围时按原规则自行检索。"
    )
