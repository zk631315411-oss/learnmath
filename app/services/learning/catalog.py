"""Read the generated learning catalog shared by backend and frontend."""

from __future__ import annotations

import json
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
