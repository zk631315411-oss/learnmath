"""证据分叉工具 — 上报学生最近一条消息对应的掌握状态。

这是阶段 2 证据回路的唯一自评入口（计划 §1.4 决策 4 已否决 exposure 自动落库）。
工具自身只做入参 schema 校验并返回一个极简确认给模型；
真正的 node_id 合法性校验（是否来自 resolved 结果、前缀是否匹配教材）与落库
由 answer_service 在工具执行环节完成——二者解耦，避免校验逻辑侵入模型侧。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.agents.tool_def import ToolDef

# 闭环四值：independent/assisted/direct_taught 为闭合证据，unresolved 为未闭合的正常状态
StudentOutcome = Literal["independent", "assisted", "direct_taught", "unresolved"]

# 工具唯一名：answer_service 据此识别内部工具并做展示过滤，勿改
REPORT_TURN_OUTCOME_TOOL_NAME = "report_turn_outcome"


class ReportTurnOutcomeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_ids: list[str] = Field(
        min_length=1,
        max_length=3,
        description=(
            "本线程当前教学目标知识点对应的 KG 稳定 node_id（1–3 个）。"
            "必须来自本轮或本线程 retrieve_kg_context 返回 status=resolved 结果中的"
            " selected_node.node_id，不得自行编造。同一 call 内的多个 node_id"
            " 共享同一个 student_outcome 与 scaffolding_level。"
        ),
    )
    scaffolding_level: int = Field(
        ge=0,
        le=4,
        description=(
            "本线程在该知识点用到的最深脚手架级数（0–4）。仅采集，不参与定色，"
            "为后续调参与离线校准预留数据。"
        ),
    )
    student_outcome: StudentOutcome = Field(
        description=(
            "本轮收尾时对线程教学目标的掌握判断："
            "independent=学生独立答出；assisted=提示/脚手架后答出；"
            "direct_taught=老师应学生要求完整讲解过（只表示讲授发生、需要复习，"
            "不要求学生表示理解）；unresolved=连讲授都没发生、本轮无闭合信号"
            "（正常状态，非漏报）。"
        ),
    )


def build_report_turn_outcome_tool() -> ToolDef:
    """构建 report_turn_outcome 内部工具（不进前端 tool_activities 展示流）。"""

    def execute(
        node_ids: list[str],
        scaffolding_level: int,
        student_outcome: str,
    ) -> dict[str, Any]:
        # 工具执行本身只回执给模型；校验与落库在 answer_service 完成，
        # 因此这里返回一个不含内部状态的极简确认，避免向模型泄露系统判定。
        return {
            "status": "recorded",
            "reported_nodes": list(node_ids),
        }

    return ToolDef(
        name=REPORT_TURN_OUTCOME_TOOL_NAME,
        display_name="上报本轮教学结果",
        description=(
            "证据分叉必须调用本工具，上报截至学生最近一条消息时，教学目标知识点的"
            "当前掌握状态。教师针对该消息刚生成的回复不在本次评价范围内。"
            "node_ids 必须是本轮或本线程 retrieve_kg_context 返回"
            " status=resolved 的 selected_node.node_id（不可编造）。"
            "本次只能调用一次；一次可携带 1–3 个共享同一结果的节点，不同结果的节点"
            "不要强行放在同一次上报中。student_outcome 四选一：independent=独立答出、"
            "assisted=提示后答出、direct_taught=老师应学生要求完整讲解过（讲授即需要复习，"
            "无需学生表示理解）、unresolved=连讲授都没发生、本轮无闭合信号"
            "（说懂了/正确复述/提出进阶新问题等闭合信号出现时不要报 unresolved）。"
            "scaffolding_level 填本线程用到的最大脚手架级数（0–4）；level=4 且学生未"
            "独立作答时应对应 direct_taught。"
        ),
        input_model=ReportTurnOutcomeInput,
        execute=execute,
        present_result=None,
        max_calls_per_round=3,
        max_calls_per_turn=3,
        timeout_seconds=10.0,
        kind="read_only",
    )
