"""Trusted API-side one-shot repair for ordinary Manim render failures."""
from __future__ import annotations

import re

from app.config import config
from app.db.manim_artifact_db import claim_artifact_status, get_artifact, update_artifact
from app.services.llm_service import llm_service
from app.services.manim_policy import validate_scene_source
from app.services.manim_queue import clear_artifact_files, enqueue_artifact

_CODE_FENCE = re.compile(r"```(?:python)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)


def repair_artifact_once(artifact_id: str) -> None:
    """Claim a repair-pending artifact, ask the API's LLM once, validate, and requeue."""
    if not claim_artifact_status(artifact_id, "repair_pending", "repairing"):
        return
    artifact = get_artifact(artifact_id)
    repair_count = int(artifact.get("repair_count") or 0)
    if repair_count >= 1:
        update_artifact(artifact_id, status="failed", error_code="repair_exhausted", error_message="自动修复次数已用完")
        return
    try:
        if not llm_service.is_available():
            raise RuntimeError("LLM 服务不可用")
        response = llm_service.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "你只修复 Manim Community Python 场景。返回完整 Python 源码，不要解释。"
                        "只允许导入 manim、math、numpy；必须只定义一个 GeneratedScene(Scene)。"
                        "不得访问网络、文件、环境变量或启动进程，不得使用 3D、外部资源。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "下面场景渲染失败。请最小修改修复它，并保持教学意图和不超过 "
                        f"{float(artifact.get('duration_seconds') or 12):g} 秒的动画。\n"
                        f"错误摘要：{str(artifact.get('error_message') or 'render failed')[-500:]}\n"
                        "原始源码：\n```python\n"
                        f"{artifact['source_code']}\n```"
                    ),
                },
            ],
            stream=False,
            temperature=0.1,
        )
        content = str(response.choices[0].message.content or "")
        source = _extract_source(content)
        policy = validate_scene_source(source, max_bytes=config.MANIM_MAX_SOURCE_BYTES)
        if not policy.ok:
            raise ValueError(f"{policy.code}: {policy.message}")

        clear_artifact_files(artifact_id)
        update_artifact(
            artifact_id,
            status="queued",
            repair_count=repair_count + 1,
            source_code=source,
            error_code="",
            error_message="",
            clear_rq_job_id=True,
        )
        enqueue_artifact(artifact_id)
    except Exception as exc:
        update_artifact(
            artifact_id,
            status="failed",
            repair_count=repair_count + 1,
            error_code="repair_failed",
            error_message=(str(exc).strip() or exc.__class__.__name__)[-500:],
        )


def _extract_source(content: str) -> str:
    matches = _CODE_FENCE.findall(content)
    source = matches[0].strip() if matches else content.strip()
    if not source:
        raise ValueError("自动修复没有返回源码")
    return source
