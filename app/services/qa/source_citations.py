"""Build bounded, user-facing textbook citations from private KG results."""

from __future__ import annotations

import re
from typing import Any, Iterable

from app.textbooks import TEXTBOOK_LABELS


MAX_SOURCES = 5
# Keep the preview to a short proof-of-source excerpt. This is deliberately
# tighter than the original 800-character transport limit.
MAX_SNIPPET_CHARS = 150
_CITATION_RE = re.compile(r"\[\[cite:([A-Za-z0-9_.:-]{1,240})\]\]")
_SENTENCE_END_RE = re.compile(r"[。！？；.!?;](?:[\"'）】》」』])?")


def citation_codes(text: str) -> list[str]:
    """Return citation codes in first-appearance order."""
    seen: set[str] = set()
    result: list[str] = []
    for match in _CITATION_RE.finditer(text or ""):
        code = match.group(1)
        if code not in seen:
            seen.add(code)
            result.append(code)
    return result


def _balanced_latex_prefix(text: str) -> str:
    """Drop a trailing fragment when a length cut lands inside common math delimiters."""
    value = text.rstrip()
    for opener, closer in (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)")):
        if opener == closer:
            if value.count(opener) % 2:
                value = value[: value.rfind(opener)].rstrip()
        elif value.count(opener) > value.count(closer):
            value = value[: value.rfind(opener)].rstrip()
    if value.count("$") % 2:
        value = value[: value.rfind("$")].rstrip()
    return value


def readable_snippet(value: Any, limit: int = MAX_SNIPPET_CHARS) -> str:
    """Select the first readable evidence paragraph without breaking LaTeX."""
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return ""
    paragraphs = [re.sub(r"[ \t]+", " ", item.strip()) for item in re.split(r"\n\s*\n", text)]
    paragraph = next((item for item in paragraphs if item), "")
    if len(paragraph) <= limit:
        return _balanced_latex_prefix(paragraph)

    window = paragraph[:limit]
    endings = [match.end() for match in _SENTENCE_END_RE.finditer(window)]
    cut = endings[-1] if endings and endings[-1] >= min(160, limit // 2) else window.rfind(" ")
    if cut < min(80, limit // 3):
        cut = limit
    return _balanced_latex_prefix(window[:cut])


def _source_from_node(
    node: dict[str, Any],
    *,
    textbook_id: str,
    evidence: Any = None,
) -> dict[str, str] | None:
    source = {
        "textbook_id": textbook_id,
        "textbook_name": TEXTBOOK_LABELS.get(textbook_id, ""),
        "node_id": str(node.get("node_id") or "").strip(),
        "node_name": str(node.get("name") or "").strip(),
        "chapter": str(node.get("chapter") or "").strip(),
        "section": str(node.get("section") or "").strip(),
        "source_code": str(node.get("source_code") or "").strip(),
        "snippet": readable_snippet(evidence if evidence is not None else node.get("evidence_span")),
    }
    # New answers only expose citations that can support a deterministic preview and jump.
    if not all(source.values()):
        return None
    return source


def collect_kg_sources(
    payload: dict[str, Any],
    *,
    bound_textbook_id: str | None = None,
) -> tuple[list[dict[str, str]], str | None]:
    """Collect complete selected/relationship sources from one private KG payload."""
    if payload.get("status") != "resolved" or not payload.get("kg_basis_available", True):
        return [], None
    scope = payload.get("scope") if isinstance(payload.get("scope"), dict) else {}
    textbook_id = str(scope.get("textbook_id") or bound_textbook_id or "").strip()
    if not textbook_id or textbook_id not in TEXTBOOK_LABELS:
        return [], None

    selected = payload.get("selected_node") if isinstance(payload.get("selected_node"), dict) else {}
    selected_source = _source_from_node(selected, textbook_id=textbook_id)
    result: list[dict[str, str]] = []
    selected_code: str | None = None
    if selected_source:
        result.append(selected_source)
        selected_code = selected_source["source_code"]

    relationships = payload.get("relationships")
    if isinstance(relationships, dict):
        for items in relationships.values():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict) or not isinstance(item.get("node"), dict):
                    continue
                source = _source_from_node(
                    item["node"],
                    textbook_id=textbook_id,
                    evidence=item.get("evidence_span"),
                )
                if source:
                    result.append(source)
    return result, selected_code


def finalize_sources(
    answer: str,
    candidates: Iterable[dict[str, str]],
    selected_codes: Iterable[str],
    *,
    limit: int = MAX_SOURCES,
) -> list[dict[str, str]]:
    """Order validated citations first, then direct selected-node fallbacks."""
    by_code: dict[str, dict[str, str]] = {}
    for source in candidates:
        code = str(source.get("source_code") or "")
        if code and code not in by_code:
            by_code[code] = source

    ordered_codes = citation_codes(answer)
    ordered_codes.extend(code for code in selected_codes if code not in ordered_codes)
    result: list[dict[str, str]] = []
    for code in ordered_codes:
        source = by_code.get(code)
        if source is None:
            continue
        result.append(source)
        if len(result) >= max(0, limit):
            break
    return result
