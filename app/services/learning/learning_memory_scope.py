"""Request-local authorization for learning-memory detail references."""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MemoryRequestScope:
    user_id: str
    textbook_id: str
    qa_turn_id: str | None = None
    refs: dict[str, dict[str, Any]] = field(default_factory=dict)
    closed: bool = False

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
