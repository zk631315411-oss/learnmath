"""Request-local authorization for learning-memory detail references."""

from __future__ import annotations

from copy import deepcopy
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MemoryRequestScope:
    user_id: str
    textbook_id: str
    qa_turn_id: str | None = None
    refs: dict[str, dict[str, Any]] = field(default_factory=dict)
    # A QA turn may read the same bounded index once for server-side
    # injection and once for an explicit Agent call.  Keep the result
    # request-local so the two paths share one logical read without sharing
    # state across concurrent requests.
    index_cache: dict[tuple[str, ...], dict[str, Any]] = field(default_factory=dict)
    closed: bool = False

    @staticmethod
    def _index_key(node_ids: list[str] | tuple[str, ...]) -> tuple[str, ...]:
        return tuple(sorted(dict.fromkeys(str(node_id).strip() for node_id in node_ids if str(node_id).strip())))

    def get_index_cache(self, node_ids: list[str] | tuple[str, ...]) -> dict[str, Any] | None:
        if self.closed:
            return None
        cached = self.index_cache.get(self._index_key(node_ids))
        return deepcopy(cached) if cached is not None else None

    def cache_index(self, node_ids: list[str] | tuple[str, ...], value: dict[str, Any]) -> None:
        if self.closed:
            return
        self.index_cache[self._index_key(node_ids)] = deepcopy(value)

    def register(self, ref: dict[str, Any]) -> None:
        if self.closed:
            return
        evidence_id = str(ref.get("evidence_id") or "").strip()
        node_id = str(ref.get("node_id") or "").strip()
        textbook_id = str(ref.get("textbook_id") or "").strip()
        if evidence_id and node_id and textbook_id:
            self.refs[evidence_id] = {
                "evidence_id": evidence_id,
                "node_id": node_id,
                "textbook_id": textbook_id,
            }

    def accepts(self, ref: dict[str, Any]) -> bool:
        if self.closed:
            return False
        evidence_id = str(ref.get("evidence_id") or "").strip()
        registered = self.refs.get(evidence_id)
        return bool(registered and all(
            str(ref.get(key) or "").strip() == str(registered.get(key) or "")
            for key in ("evidence_id", "node_id", "textbook_id")
        ))

    def close(self) -> None:
        self.closed = True
        self.refs.clear()
        self.index_cache.clear()


_scope: ContextVar[MemoryRequestScope | None] = ContextVar(
    "learnmath_learning_memory_scope", default=None,
)


def get_memory_scope() -> MemoryRequestScope | None:
    return _scope.get()


def begin_memory_scope(
    user_id: str,
    textbook_id: str,
    *,
    qa_turn_id: str | None = None,
) -> tuple[MemoryRequestScope, Token]:
    value = MemoryRequestScope(
        user_id=str(user_id or "").strip(),
        textbook_id=str(textbook_id or "").strip(),
        qa_turn_id=qa_turn_id,
    )
    return value, _scope.set(value)


def reset_memory_scope(token: Token, scope: MemoryRequestScope) -> None:
    scope.close()
    _scope.reset(token)
