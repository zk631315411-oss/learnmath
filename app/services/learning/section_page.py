"""Resolve a textbook section prefix to its first PDF page."""
from __future__ import annotations

import json
import re
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from threading import Lock
from typing import Any

from app.config import config

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - the runtime image includes PyMuPDF
    fitz = None


_SECTION_RE = re.compile(r"^\d+(?:\.\d+)*$")
_CACHE_LIMIT = 128
_cache: OrderedDict[tuple[str, str], dict[str, Any]] = OrderedDict()
_cache_lock = Lock()
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="section-page")


def _registry() -> dict[str, dict[str, Any]]:
    path = config.BASE_DIR / "shared" / "textbooks.json"
    return {str(item["id"]): item for item in json.loads(path.read_text(encoding="utf-8"))}


def textbook_pdf_path(textbook_id: str) -> Path:
    item = _registry().get(textbook_id)
    if not item:
        raise ValueError("unknown textbook")
    relative = Path(str(item["pdf_path"]))
    return config.BASE_DIR / relative


def _normalize_text(value: str) -> str:
    # PDF extraction often inserts spaces around punctuation and LaTeX escapes.
    return re.sub(r"\s+", "", value).replace("\\", "")


def _scan(textbook_id: str, section: str) -> dict[str, Any]:
    if fitz is None:
        return {"page": None, "confidence": 0, "matched_text": None}
    path = textbook_pdf_path(textbook_id)
    if not path.exists():
        return {"page": None, "confidence": 0, "matched_text": None}
    needle = _normalize_text(section)
    document = fitz.open(path)
    try:
        # Scanned textbooks often have no extractable page text but still ship
        # with reliable PDF bookmarks. Prefer those when present.
        for _level, title, page_number in document.get_toc(simple=True):
            clean_title = str(title).strip()
            if re.match(rf"^{re.escape(section)}(?:[^\d.]|$)", clean_title):
                return {
                    "page": int(page_number),
                    "confidence": 1.0,
                    "matched_text": clean_title,
                }
        for index, page in enumerate(document):
            text = page.get_text("text") or ""
            # Keep an unmodified pass separate from the tolerant pass below:
            # callers can distinguish a literal section heading from one that
            # was recovered after PDF extraction introduced whitespace or
            # escaped-LaTeX noise.
            if re.search(rf"(?:^|[^\d]){re.escape(section)}(?:[^\d]|$)", text):
                matched = next((line.strip() for line in text.splitlines() if section in line), None)
                return {"page": index + 1, "confidence": 1.0, "matched_text": matched}
            normalized = _normalize_text(text)
            if re.search(rf"(?:^|[^\d]){re.escape(needle)}(?:[^\d]|$)", normalized):
                matched = next((line.strip() for line in text.splitlines() if needle in _normalize_text(line)), None)
                return {"page": index + 1, "confidence": 0.85, "matched_text": matched}
        return {"page": None, "confidence": 0, "matched_text": None}
    finally:
        document.close()


def resolve_section_page(textbook_id: str, section: str, timeout_seconds: float = 3.0) -> dict[str, Any]:
    key = (textbook_id, section)
    with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return dict(cached)
    future = _executor.submit(_scan, textbook_id, section)
    timed_out = False
    try:
        result = future.result(timeout=timeout_seconds)
    except FutureTimeoutError:
        future.cancel()
        timed_out = True
        result = {"page": None, "confidence": 0, "matched_text": None}
    if not timed_out:
        with _cache_lock:
            _cache[key] = result
            _cache.move_to_end(key)
            while len(_cache) > _CACHE_LIMIT:
                _cache.popitem(last=False)
    return dict(result)


def clear_section_page_cache() -> None:
    with _cache_lock:
        _cache.clear()


# 仅匹配顶级小节号（如 "1.2"、"10.3"），章标题（"第1章"）和三级小节（"1.1.1"）不算
_SECTION_HEADING_RE = re.compile(r"^(\d+\.\d+)(?:[^\d.]|$)")

_page_section_cache: dict[str, dict[int, str]] = {}
_page_section_lock = Lock()


def _build_page_sections(textbook_id: str) -> dict[int, str]:
    """Build page_number -> "1.2" mapping from PDF bookmarks.

    Scanned textbooks have no text layer, so bookmarks (get_toc) are the only
    reliable section source. Each section heading owns pages from its start page
    up to (but excluding) the next section heading's start page.
    """
    if fitz is None:
        return {}
    path = textbook_pdf_path(textbook_id)
    if not path.exists():
        return {}
    try:
        document = fitz.open(path)
    except Exception:
        return {}
    try:
        # Collect (start_page, section) for top-level section bookmarks only.
        starts: list[tuple[int, str]] = []
        for _level, title, page_number in document.get_toc(simple=True):
            match = _SECTION_HEADING_RE.match(str(title).strip())
            if match:
                starts.append((int(page_number), match.group(1)))
        starts.sort()
        mapping: dict[int, str] = {}
        for index, (start_page, section) in enumerate(starts):
            end_page = starts[index + 1][0] if index + 1 < len(starts) else document.page_count + 1
            for page in range(start_page, min(end_page, document.page_count + 1)):
                mapping[page] = section
        return mapping
    finally:
        document.close()


def page_sections(textbook_id: str) -> dict[int, str]:
    """Return cached page_number -> section mapping for a textbook."""
    with _page_section_lock:
        cached = _page_section_cache.get(textbook_id)
        if cached is not None:
            return cached
    mapping = _build_page_sections(textbook_id)
    with _page_section_lock:
        _page_section_cache[textbook_id] = mapping
    return mapping
