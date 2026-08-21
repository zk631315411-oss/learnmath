"""Export immutable textbook structure for the learning-map frontend.

The export is the only build-time bridge from Neo4j/PDF structure to the
runtime map.  Runtime map requests must use the generated assets and user
progress only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import fitz


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.kg_v44 import list_kg_chapter_nodes, list_kg_edges, list_kg_nodes  # noqa: E402


REGISTRY_PATH = ROOT / "shared" / "textbooks.json"
SHARED_OUTPUT = ROOT / "shared" / "generated" / "learning_catalog_manifest.json"
FRONTEND_OUTPUT = ROOT / "frontend" / "public" / "map-catalog"
SECTION_PREFIX = re.compile(r"(?:^|[^\d])(\d+(?:\.\d+)*)")
CHAPTER_PREFIX = re.compile(r"^\s*(?:第\s*)?(\d+)\s*章")


def _section_key(value: str) -> str | None:
    match = SECTION_PREFIX.search(str(value or ""))
    return match.group(1) if match else None


def _chapter_number(value: str) -> int | None:
    match = CHAPTER_PREFIX.match(str(value or ""))
    return int(match.group(1)) if match else None


def _toc_pages(pdf_path: Path) -> tuple[dict[str, int], dict[int, int], int]:
    """Build first-match section/chapter page indexes from PDF bookmarks."""
    section_pages: dict[str, int] = {}
    chapter_pages: dict[int, int] = {}
    with fitz.open(pdf_path) as document:
        for _level, title, page in document.get_toc(simple=True):
            title_text = str(title or "").strip()
            chapter = _chapter_number(title_text)
            if chapter is not None:
                chapter_pages.setdefault(chapter, int(page))
            section = _section_key(title_text)
            if section is not None:
                section_pages.setdefault(section, int(page))
        return section_pages, chapter_pages, len(document)


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _load_registry() -> list[dict[str, Any]]:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _retry_kg(function, *args):
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            return function(*args)
        except Exception as exc:  # build output should tolerate transient Aura wakeups
            last_error = exc
            if attempt < 3:
                time.sleep(1.5 * (attempt + 1))
    assert last_error is not None
    raise last_error


def _export_textbook(item: dict[str, Any]) -> dict[str, Any]:
    textbook_id = str(item["id"])
    pdf_path = ROOT / str(item["pdf_path"])
    if not pdf_path.exists():
        raise RuntimeError(f"missing PDF for {textbook_id}: {pdf_path}")
    section_pages, chapter_pages, total_pages = _toc_pages(pdf_path)

    raw_chapters = _retry_kg(list_kg_chapter_nodes, textbook_id)
    book_edges = _retry_kg(list_kg_edges, textbook_id)
    chapters: list[dict[str, Any]] = []
    node_index: list[dict[str, Any]] = []
    seen_nodes: set[str] = set()
    for chapter_order, chapter_row in enumerate(raw_chapters):
        chapter_name = str(chapter_row.get("chapter") or "").strip()
        if not chapter_name:
            raise RuntimeError(f"empty chapter name for {textbook_id}")
        chapter_number = _chapter_number(chapter_name)
        nodes = _retry_kg(list_kg_nodes, textbook_id, chapter_name)
        # 章前「导入」节（如 C02:S00:U00，教材目录中并不存在的引入段）并入本章第一个编号小节，
        # 避免章总览出现与正式小节并列的伪节。节点顺序保持不变（导入节点教材序在最前）。
        intro_merge_target: tuple[str, str] | None = None
        for node in nodes:
            candidate_name = str(node.get("section") or "").strip()
            candidate_key = _section_key(candidate_name)
            if candidate_key and "." in candidate_key:
                intro_merge_target = (candidate_key, candidate_name)
                break
        expected_ids = {str(node_id) for node_id in chapter_row.get("node_ids") or [] if node_id}
        actual_ids = {str(node.get("node_id") or "") for node in nodes}
        if expected_ids != actual_ids:
            raise RuntimeError(
                f"chapter node mismatch for {textbook_id}/{chapter_name}: "
                f"bucket={len(expected_ids)} detail={len(actual_ids)}"
            )

        sections: list[dict[str, Any]] = []
        section_by_key: dict[str, dict[str, Any]] = {}
        for node_order, node in enumerate(nodes):
            node_id = str(node.get("node_id") or "").strip()
            if not node_id or node_id in seen_nodes:
                raise RuntimeError(f"duplicate or empty node id in {textbook_id}: {node_id!r}")
            if not node_id.startswith(f"{textbook_id}:"):
                raise RuntimeError(f"node prefix mismatch in {textbook_id}: {node_id}")
            seen_nodes.add(node_id)
            section_name = str(node.get("section") or "未分节").strip() or "未分节"
            if intro_merge_target and section_name.endswith("导入"):
                section_key, section_name = intro_merge_target
            else:
                section_key = _section_key(section_name) or f"unsectioned-{len(section_by_key)}"
            section = section_by_key.get(section_key)
            if section is None:
                section = {
                    "id": section_key,
                    "name": section_name,
                    "page": section_pages.get(section_key),
                    "nodes": [],
                }
                section_by_key[section_key] = section
                sections.append(section)
            static_node = {
                "node_id": node_id,
                "name": str(node.get("name") or "").strip(),
                "type": node.get("type"),
                "chapter": chapter_name,
                "section": section_name,
                "section_node_id": node.get("section_node_id"),
                "prerequisite_ids": [
                    str(value) for value in (node.get("prerequisite_ids") or []) if value
                ],
                "order": node_order,
            }
            if not static_node["name"]:
                raise RuntimeError(f"empty node name: {node_id}")
            section["nodes"].append(static_node)
            node_index.append({
                "node_id": node_id,
                "chapter": chapter_name,
                "section": section_name,
                "name": static_node["name"],
                "order": len(node_index),
            })

        chapters.append({
            "id": f"{textbook_id}:chapter:{chapter_order + 1}",
            "name": chapter_name,
            "number": chapter_number,
            "order": chapter_order,
            "node_count": len(nodes),
            "first_page": chapter_pages.get(chapter_number) if chapter_number is not None else None,
            "sections": sections,
        })

    if sum(int(chapter["node_count"]) for chapter in chapters) != len(seen_nodes):
        raise RuntimeError(f"node count mismatch for {textbook_id}")
    for page in [*section_pages.values(), *chapter_pages.values()]:
        if page < 1 or page > total_pages:
            raise RuntimeError(f"TOC page out of range for {textbook_id}: {page}/{total_pages}")
    chapter_numbers = [chapter["number"] for chapter in chapters if chapter["number"] is not None]
    if chapter_numbers != sorted(chapter_numbers):
        raise RuntimeError(f"chapter order mismatch for {textbook_id}: {chapter_numbers}")
    return {
        "textbook_id": textbook_id,
        "display_name": str(item["display_name"]),
        "catalog_version": "pending",
        "chapters": chapters,
        "node_index": node_index,
        "edges": book_edges,
    }


def _with_version(catalog: dict[str, Any]) -> dict[str, Any]:
    content = dict(catalog)
    content.pop("catalog_version", None)
    digest = hashlib.sha256(_canonical_json(content)).hexdigest()[:16]
    return {**catalog, "catalog_version": f"{catalog['textbook_id']}-{digest}"}


def export(textbook_ids: list[str] | None = None, preview_dir: Path | None = None) -> dict[str, Any]:
    registry = _load_registry()
    selected = set(textbook_ids or [str(item["id"]) for item in registry])
    unknown = selected - {str(item["id"]) for item in registry}
    if unknown:
        raise ValueError(f"unknown textbook ids: {sorted(unknown)}")

    catalogs = [_with_version(_export_textbook(item)) for item in registry if str(item["id"]) in selected]
    manifest = {
        "schema_version": 1,
        "node_index": {
            catalog["textbook_id"]: catalog["node_index"] for catalog in catalogs
        },
        "catalogs": [
            {
                "textbook_id": catalog["textbook_id"],
                "display_name": catalog["display_name"],
                "catalog_version": catalog["catalog_version"],
                "index_path": f"/map-catalog/{catalog['textbook_id']}.index.json",
                "catalog_path": f"/map-catalog/{catalog['textbook_id']}.json",
                "chapters": [
                    {
                        "id": chapter["id"],
                        "name": chapter["name"],
                        "number": chapter["number"],
                        "order": chapter["order"],
                        "node_count": chapter["node_count"],
                        "first_page": chapter["first_page"],
                    }
                    for chapter in catalog["chapters"]
                ],
            }
            for catalog in catalogs
        ],
    }

    SHARED_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_OUTPUT.mkdir(parents=True, exist_ok=True)
    if preview_dir is not None:
        preview_dir.mkdir(parents=True, exist_ok=True)
    manifest_targets = [SHARED_OUTPUT, FRONTEND_OUTPUT / "manifest.json"]
    book_target_dir = FRONTEND_OUTPUT
    if preview_dir is not None:
        manifest_targets = [preview_dir / "manifest.json"]
        book_target_dir = preview_dir
    encoded_manifest = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    for target in manifest_targets:
        target.write_text(encoded_manifest, encoding="utf-8")
    for catalog in catalogs:
        (book_target_dir / f"{catalog['textbook_id']}.index.json").write_text(
            json.dumps(
                {
                    "textbook_id": catalog["textbook_id"],
                    "catalog_version": catalog["catalog_version"],
                    "node_index": catalog["node_index"],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (book_target_dir / f"{catalog['textbook_id']}.json").write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("textbook_ids", nargs="*", help="optional textbook ids; default exports all")
    parser.add_argument("--preview-dir", type=Path, default=None,
                        help="write all outputs into this directory instead of shared/ and frontend/public/")
    args = parser.parse_args()
    manifest = export(args.textbook_ids or None, preview_dir=args.preview_dir)
    print(f"exported {len(manifest['catalogs'])} textbook catalogs")
    for catalog in manifest["catalogs"]:
        node_count = sum(int(chapter["node_count"]) for chapter in catalog["chapters"])
        print(f"- {catalog['textbook_id']}: {node_count} nodes ({catalog['catalog_version']})")


if __name__ == "__main__":
    main()
