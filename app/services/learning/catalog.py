"""Read the generated learning catalog shared by backend and frontend."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from threading import RLock
from typing import Any

from app.config import config


CATALOG_MANIFEST_PATH = config.BASE_DIR / "shared" / "generated" / "learning_catalog_manifest.json"

_CatalogSignature = tuple[str, int, int, int]
_manifest_lock = RLock()
_manifest_cache: tuple[_CatalogSignature, dict[str, Any]] | None = None


def load_catalog_manifest() -> dict[str, Any]:
    """Load the generated catalog once per file version.

    Catalog reads sit on several hot paths (model validation, KG scoping and
    progress responses).  Parsing the manifest for each node used to turn a
    bounded request into repeated disk/JSON work.  The signature keeps local
    development safe: replacing the generated manifest automatically causes
    the next call to reload it without requiring a process restart.
    """

    global _manifest_cache
    path: Path = CATALOG_MANIFEST_PATH
    try:
        stat = path.stat()
    except FileNotFoundError as exc:
        raise RuntimeError("learning catalog has not been generated") from exc
    signature: _CatalogSignature = (
        str(path),
        int(stat.st_mtime_ns),
        int(stat.st_size),
        int(getattr(stat, "st_ctime_ns", 0)),
    )
    with _manifest_lock:
        if _manifest_cache is not None and _manifest_cache[0] == signature:
            return _manifest_cache[1]
        parsed = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            raise RuntimeError("learning catalog manifest must be an object")
        _manifest_cache = (signature, parsed)
        # The node-id cache is keyed by textbook only for historical callers;
        # clear it whenever the source manifest changes so a hot reload cannot
        # leave an old catalog scope in memory.
        catalog_node_ids.cache_clear()
        return parsed


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
