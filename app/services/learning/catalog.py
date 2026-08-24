"""Read the generated learning catalog shared by backend and frontend."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from app.config import config


CATALOG_MANIFEST_PATH = config.BASE_DIR / "shared" / "generated" / "learning_catalog_manifest.json"


def load_catalog_manifest() -> dict[str, Any]:
    if not CATALOG_MANIFEST_PATH.exists():
        raise RuntimeError("learning catalog has not been generated")
    return json.loads(CATALOG_MANIFEST_PATH.read_text(encoding="utf-8"))


def get_catalog_entry(textbook_id: str) -> dict[str, Any] | None:
    clean = str(textbook_id or "").strip()
    return next(
        (item for item in load_catalog_manifest().get("catalogs", []) if item.get("textbook_id") == clean),
        None,
    )


def catalog_version(textbook_id: str) -> str:
    entry = get_catalog_entry(textbook_id)
    if not entry:
        raise ValueError("unknown textbook")
    return str(entry.get("catalog_version") or "")


@lru_cache(maxsize=None)
def catalog_node_ids(textbook_id: str) -> frozenset[str]:
    """Return the generated, version-bound node scope for one textbook."""

    if not get_catalog_entry(textbook_id):
        return frozenset()
    rows = load_catalog_manifest().get("node_index", {}).get(textbook_id, [])
    return frozenset(
        str(row.get("node_id"))
        for row in rows
        if isinstance(row, dict) and row.get("node_id")
    )


def get_catalog_node(textbook_id: str, node_id: str) -> dict[str, Any] | None:
    clean_node = str(node_id or "").strip()
    if clean_node not in catalog_node_ids(textbook_id):
        return None
    return next(
        (
            row
            for row in load_catalog_manifest().get("node_index", {}).get(textbook_id, [])
            if isinstance(row, dict) and row.get("node_id") == clean_node
        ),
        None,
    )
