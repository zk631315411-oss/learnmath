"""Canonical tool definitions and provider-compatible argument validation."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ValidationError


ToolKind = Literal["read_only", "artifact"]


def _default_tool_timeout() -> float:
    return 30.0


class ToolArgumentError(ValueError):
    """Raised before a tool executes when model-supplied arguments are invalid."""


@dataclass(frozen=True)
class ToolDef:
    name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)
    execute: Callable[..., Any] | None = None
    display_name: str = ""
    input_model: type[BaseModel] | None = None
    timeout_seconds: float = field(default_factory=_default_tool_timeout)
    max_calls_per_round: int = 3
    max_calls_per_turn: int = 3
    kind: ToolKind = "read_only"

    def schema(self) -> dict[str, Any]:
        if self.input_model is not None:
            return self.input_model.model_json_schema()
        return self.input_schema

    def to_openai_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.schema(),
            },
        }

    def validate_arguments(self, arguments: dict[str, Any]) -> dict[str, Any]:
        if self.input_model is None:
            return arguments
        normalized = normalize_provider_arguments(arguments, self.schema())
        try:
            validated = self.input_model.model_validate(normalized)
        except ValidationError as exc:
            raise ToolArgumentError(_validation_message(exc)) from exc
        value = validated.model_dump(exclude_none=True)
        if "root" in value and len(value) == 1 and isinstance(value["root"], dict):
            return value["root"]
        return value


def normalize_provider_arguments(arguments: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    """Decode JSON strings only where the declared schema expects structured data."""
    if not isinstance(arguments, dict):
        raise ToolArgumentError("工具参数必须是 JSON 对象")
    normalized = _normalize_value(arguments, schema, schema)
    if not isinstance(normalized, dict):
        raise ToolArgumentError("工具参数必须是 JSON 对象")
    return normalized


def _normalize_value(value: Any, schema: dict[str, Any], root: dict[str, Any]) -> Any:
    schema = _resolve_schema(schema, root, value)
    expected = schema.get("type")
    expected_types = set(expected if isinstance(expected, list) else [expected])

    if isinstance(value, str) and expected_types.intersection({"object", "array", "integer", "number"}):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ToolArgumentError("结构化参数必须是有效 JSON") from exc

    if isinstance(value, dict):
        properties = schema.get("properties") or {}
        return {
            key: _normalize_value(item, properties.get(key, {}), root)
            for key, item in value.items()
        }
    if isinstance(value, list):
        item_schema = schema.get("items") or {}
        return [_normalize_value(item, item_schema, root) for item in value]
    return value


def _resolve_schema(schema: dict[str, Any], root: dict[str, Any], value: Any) -> dict[str, Any]:
    seen: set[str] = set()
    while "$ref" in schema:
        ref = str(schema["$ref"])
        if ref in seen or not ref.startswith("#/$defs/"):
            break
        seen.add(ref)
        schema = (root.get("$defs") or {}).get(ref.rsplit("/", 1)[-1], schema)

    branches = schema.get("oneOf") or schema.get("anyOf")
    if branches:
        selected = _select_branch(branches, root, value)
        if selected is not None:
            return _resolve_schema(selected, root, value)
    return schema


def _select_branch(branches: list[dict[str, Any]], root: dict[str, Any], value: Any) -> dict[str, Any] | None:
    resolved = [_resolve_schema(branch, root, value) for branch in branches]
    if isinstance(value, dict) and "kind" in value:
        for branch in resolved:
            kind = (branch.get("properties") or {}).get("kind", {})
            if kind.get("const") == value["kind"] or value["kind"] in kind.get("enum", []):
                return branch
    type_name = "object" if isinstance(value, dict) else "array" if isinstance(value, list) else None
    for branch in resolved:
        if branch.get("type") == type_name:
            return branch
    return resolved[0] if resolved else None


def _validation_message(exc: ValidationError) -> str:
    first = exc.errors(include_url=False)[0]
    location = ".".join(str(item) for item in first.get("loc", ())) or "arguments"
    return f"参数 {location} 无效: {first.get('msg', '校验失败')}"
