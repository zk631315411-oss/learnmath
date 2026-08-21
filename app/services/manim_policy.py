"""Static policy checks for untrusted Manim source code."""
from __future__ import annotations

import ast
from dataclasses import dataclass

ALLOWED_IMPORT_ROOTS = {"manim", "math", "numpy"}
FORBIDDEN_CALLS = {
    "eval", "exec", "compile", "open", "input", "__import__", "breakpoint",
    "getattr", "setattr", "delattr", "globals", "locals", "vars", "dir",
    "help", "exit", "quit",
}
FORBIDDEN_IMPORT_ROOTS = {
    "os", "sys", "subprocess", "socket", "pathlib", "shutil", "requests", "urllib",
    "http", "importlib", "builtins", "pickle", "ctypes",
}
FORBIDDEN_IO_CALL_NAMES = {
    "load", "save", "loadtxt", "savetxt", "genfromtxt", "fromfile", "tofile",
    "memmap", "savez", "savez_compressed", "load_library", "add_sound",
    "SVGMobject", "ImageMobject", "OpenGLImageMobject", "TexTemplateFromFile",
    "register_font", "open_media_file", "get_full_raster_image_path",
    "get_full_sound_file_path", "get_full_vector_image_path",
}
FORBIDDEN_TEX_TOKENS = (
    "\\input", "\\include", "\\write18", "\\openout", "\\openin",
    "\\usepackage", "\\lstinputlisting", "\\verbatiminput", "\\href{http",
    "\\url{http", "http://", "https://",
)


@dataclass(frozen=True)
class PolicyResult:
    ok: bool
    code: str = ""
    message: str = ""


def validate_scene_source(source: str, *, max_bytes: int = 120_000) -> PolicyResult:
    if not isinstance(source, str) or not source.strip():
        return PolicyResult(False, "empty_source", "动画源码不能为空")
    if len(source.encode("utf-8")) > max_bytes:
        return PolicyResult(False, "source_too_large", "动画源码超过大小限制")
    lowered_source = source.lower()
    if any(token in lowered_source for token in FORBIDDEN_TEX_TOKENS):
        return PolicyResult(False, "forbidden_tex", "源码包含不允许的外部文件、网络或 TeX 操作")
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        return PolicyResult(False, "syntax_error", f"源码语法错误: {exc.msg}")
    if sum(1 for _ in ast.walk(tree)) > 20_000:
        return PolicyResult(False, "ast_too_large", "动画源码结构过大")
    scenes = [node for node in tree.body if isinstance(node, ast.ClassDef) and any(
        isinstance(base, ast.Name) and base.id == "Scene" for base in node.bases
    )]
    if len(scenes) != 1 or scenes[0].name != "GeneratedScene":
        return PolicyResult(False, "invalid_scene", "必须定义唯一的 GeneratedScene(Scene)")
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and (
            node.id.startswith("__") or node.id in FORBIDDEN_CALLS
        ):
            return PolicyResult(False, "forbidden_name", f"源码包含不允许的名称: {node.id}")
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            roots = [alias.name.split(".", 1)[0] for alias in node.names] if isinstance(node, ast.Import) else [str(node.module or "").split(".", 1)[0]]
            if any(root in FORBIDDEN_IMPORT_ROOTS or root not in ALLOWED_IMPORT_ROOTS for root in roots):
                return PolicyResult(False, "forbidden_import", "源码包含不允许的 import")
        if isinstance(node, ast.Call):
            name = _call_name(node.func)
            if (
                name in FORBIDDEN_CALLS
                or name.rsplit(".", 1)[-1] in FORBIDDEN_IO_CALL_NAMES
                or name.startswith(("os.", "sys.", "subprocess.", "socket."))
                or name.startswith(("numpy.load", "numpy.save", "numpy.fromfile", "numpy.memmap", "np.load", "np.save", "np.fromfile", "np.memmap"))
            ):
                return PolicyResult(False, "forbidden_call", f"源码包含不允许的调用: {name}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            return PolicyResult(False, "dunder_attribute", "源码包含不允许的特殊属性")
    return PolicyResult(True)


def _call_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _call_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""
