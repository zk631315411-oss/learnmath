"""Agent tool that validates and queues an asynchronous Manim artifact."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.db.manim_artifact_db import create_artifact, get_artifact
from app.db.chat_history_db import get_chat_history
from app.services.agents.tool_def import ToolDef
from app.services.manim_queue import artifact_response, enqueue_artifact


class RenderManimInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=160)
    rationale: str = Field(min_length=1, max_length=500)
    scene_code: str = Field(min_length=1, max_length=120_000)
    duration_seconds: float = Field(default=12, ge=1, le=12)
    quality: str = Field(default="low", pattern="^(low|medium)$")


def build_render_manim_tool(*, user_id: str, chat_id: str | None, client_turn_id: str | None) -> ToolDef:
    def execute(title: str, rationale: str, scene_code: str, duration_seconds: float = 12, quality: str = "low") -> dict:
        if chat_id and not get_chat_history(user_id, chat_id=chat_id):
            raise ValueError("动画关联的对话不存在")
        artifact = create_artifact(
            user_id=user_id, chat_id=chat_id, client_turn_id=client_turn_id,
            title=title, rationale=rationale, source_code=scene_code,
            duration_seconds=duration_seconds, quality=quality,
        )
        try:
            enqueue_artifact(artifact["id"])
        except Exception:
            artifact = get_artifact(artifact["id"])
        response = artifact_response(artifact)
        return {
            "model_result": {
                "status": response["status"], "artifact_id": response["id"],
                "title": response["title"],
                "message": "动画已提交后台渲染，回答无需等待视频完成。",
            },
            "artifacts": [response],
        }

    return ToolDef(
        name="render_manim_animation", display_name="生成数学动画",
        description=(
            "当动态变化、空间关系或步骤过程能显著帮助理解时，生成一段教学示意动画。"
            "只有动画有明确教学收益才调用；定义题、简单计算和纯文字证明不要调用。"
            "scene_code 必须是完整 Python Manim 场景，唯一类名为 GeneratedScene，时长最多 12 秒。"
            "动画是教学示意，不等同证明或科学级仿真。"
        ),
        input_model=RenderManimInput, execute=execute, timeout_seconds=10,
        max_calls_per_round=1, max_calls_per_turn=1, kind="artifact",
        present_result=lambda result: result if isinstance(result, dict) else {},
    )
