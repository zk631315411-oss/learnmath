"""report_turn_outcome 证据落库全链路集成测试（mock LLM，不烧真实 API）。

用 mock 的 llm_service 走通「retrieve resolved → report_turn_outcome → evidence 落库」
完整闭环，同时验证内部工具不进前端 tool_activities 展示流。
"""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.config import config
from app.db.connection import init_db
from app.db.evidence_db import list_evidence_for_user
from app.services.qa.answer_service import answer_turn_with_tools
from app.services.qa.contracts import QATurnInput


def _chunk(*, content="", reasoning="", tool_calls=None):
    delta = SimpleNamespace(content=content, reasoning_content=reasoning, tool_calls=tool_calls or [])
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


def _call(name, args):
    return SimpleNamespace(
        index=0, id=f"call-{name}",
        function=SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False)),
    )


def _completion_tool_call(name, args):
    call = SimpleNamespace(
        id=f"call-{name}",
        function=SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False)),
    )
    message = SimpleNamespace(content=None, reasoning_content=None, tool_calls=[call])
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class _FakeLLM:
    """按调用轮次返回预设工具调用序列的假 LLM。"""

    def __init__(self):
        self.calls = []
        self.fork_calls = 0
        self.fork_messages = []
        self.main_tool_names = []

    def is_available(self):
        return True

    def chat_with_tools(self, messages, tools, tool_choice="auto", **kwargs):
        if kwargs.get("stream") is False:
            self.fork_calls += 1
            self.fork_messages = messages
            return _completion_tool_call("report_turn_outcome", {
                "node_ids": ["gaodai_shang:线性无关"],
                "scaffolding_level": 3,
                "student_outcome": "assisted",
            })
        self.main_tool_names = [tool["function"]["name"] for tool in tools]
        n = len(self.calls)
        self.calls.append(n)
        if n == 0:
            return [_chunk(tool_calls=[_call("retrieve_kg_context", {"query": "线性无关", "focus": ["overview"]})])]
        return [_chunk(content="最终回答")]


class _ThreeKGCallsLLM:
    def __init__(self):
        self.calls = 0
        self.fork_calls = 0

    def is_available(self):
        return True

    def chat_with_tools(self, messages, tools, tool_choice="auto", **kwargs):
        if kwargs.get("stream") is False:
            self.fork_calls += 1
            return _completion_tool_call("report_turn_outcome", {
                "node_ids": ["gaodai_shang:目标"],
                "scaffolding_level": 1,
                "student_outcome": "assisted",
            })
        call = self.calls
        self.calls += 1
        if call < 3:
            return [_chunk(tool_calls=[_call("retrieve_kg_context", {"query": f"节点{call}", "focus": ["overview"]})])]
        return [_chunk(content="最终回答")]


class _EvidenceForkLLM:
    def __init__(self):
        self.normal_calls = 0
        self.fork_calls = 0
        self.fork_messages = []

    def is_available(self):
        return True

    def chat_with_tools(self, messages, tools, tool_choice="auto", **kwargs):
        if kwargs.get("stream") is False:
            self.fork_calls += 1
            self.fork_messages = messages
            return _completion_tool_call("report_turn_outcome", {
                "node_ids": ["gaodai_shang:目标"],
                "scaffolding_level": 0,
                "student_outcome": "unresolved",
            })
        self.normal_calls += 1
        if self.normal_calls == 1:
            return [_chunk(tool_calls=[_call("retrieve_kg_context", {"query": "目标", "focus": ["overview"]})])]
        return [_chunk(content="可见回答")]


class EvidencePipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_report_flow_persists_rows_and_hides_internal_tool(self):
        resolved = {
            "status": "resolved", "kg_basis_available": True,
            "selected_node": {"node_id": "gaodai_shang:线性无关", "name": "线性无关", "type": "Concept"},
            "relationships": {}, "requested_focus": ["overview"],
            "retrieved_focus": [], "empty_focus": [], "focus_stats": {},
        }
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(config, "DB_PATH", str(Path(tmp) / "learning.db")):
                init_db()
                fake = _FakeLLM()
                with patch("app.services.qa.answer_service.llm_service", fake):
                    with patch("app.services.agents.tools.retrieve_kg_context.retrieve_kg_context", return_value=resolved):
                        events = []
                        async for event in answer_turn_with_tools(
                            QATurnInput(user_id="u1", question="什么是线性无关？", textbook_id="gaodai_shang")
                        ):
                            events.append(event)

                # 校验 1：done 事件的 tool_activities 不含内部工具
                done = [e for e in events if e["event"] == "done"]
                self.assertTrue(done, "缺少 done 事件")
                activities = json.loads(done[0]["data"])["tool_activities"]
                self.assertNotIn(
                    "report_turn_outcome", [a["tool"] for a in activities],
                    "内部工具不应出现在展示流",
                )
                self.assertEqual(fake.main_tool_names, ["retrieve_kg_context", "render_manim_animation"])
                self.assertEqual(fake.fork_calls, 1)
                self.assertNotIn("最终回答", json.dumps(fake.fork_messages, ensure_ascii=False))
                stages = [json.loads(event["data"]).get("stage") for event in events if event["event"] == "stage"]
                self.assertIn("evidence_report", stages)

                # 校验 2：evidence 落库一行且字段齐全、每节点一行
                rows = list_evidence_for_user("u1")
                self.assertEqual(len(rows), 1)
                row = rows[0]
                self.assertEqual(row["node_id"], "gaodai_shang:线性无关")
                self.assertEqual(row["outcome"], "assisted")
                self.assertEqual(row["scaffolding_level"], 3)
                self.assertEqual(row["source"], "agent_self_report")
                self.assertEqual(row["report_path"], "evidence_fork")
                self.assertEqual(row["user_id"], "u1")
                self.assertEqual(row["textbook_id"], "gaodai_shang")

    async def test_three_kg_calls_still_leave_budget_for_report(self):
        resolved = {"status": "resolved", "selected_node": {"node_id": "gaodai_shang:目标", "name": "目标"}, "relationships": {}}
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(config, "DB_PATH", str(Path(tmp) / "learning.db")):
                init_db()
                with patch("app.services.qa.answer_service.llm_service", _ThreeKGCallsLLM()), patch("app.services.agents.tools.retrieve_kg_context.retrieve_kg_context", return_value=resolved):
                    events = [event async for event in answer_turn_with_tools(QATurnInput(user_id="u1", question="q", textbook_id="gaodai_shang", chat_id="thread-id"))]
                rows = list_evidence_for_user("u1")
        self.assertEqual(len(rows), 1)
        done = json.loads(next(event["data"] for event in events if event["event"] == "done"))
        self.assertNotEqual(done["qa_turn_id"], "thread-id")

    async def test_follow_up_turns_in_same_thread_get_distinct_turn_ids(self):
        resolved = {"status": "resolved", "selected_node": {"node_id": "gaodai_shang:线性无关", "name": "线性无关"}, "relationships": {}}
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(config, "DB_PATH", str(Path(tmp) / "learning.db")):
                init_db()
                for question in ("q1", "q2"):
                    with patch("app.services.qa.answer_service.llm_service", _FakeLLM()), patch("app.services.agents.tools.retrieve_kg_context.retrieve_kg_context", return_value=resolved):
                        _ = [event async for event in answer_turn_with_tools(QATurnInput(user_id="u1", question=question, textbook_id="gaodai_shang", chat_id="same-thread"))]
                rows = list_evidence_for_user("u1")
        self.assertEqual(len({row["qa_turn_id"] for row in rows}), 2)
        self.assertTrue(all(row["qa_turn_id"] != "same-thread" for row in rows))

    async def test_eligible_turn_gets_one_shot_evidence_fork(self):
        resolved = {"status": "resolved", "selected_node": {"node_id": "gaodai_shang:目标", "name": "目标"}, "relationships": {}}
        fake = _EvidenceForkLLM()
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(config, "DB_PATH", str(Path(tmp) / "learning.db")):
                init_db()
                with patch("app.services.qa.answer_service.llm_service", fake), patch("app.services.agents.tools.retrieve_kg_context.retrieve_kg_context", return_value=resolved):
                    events = [event async for event in answer_turn_with_tools(QATurnInput(user_id="u1", question="q", textbook_id="gaodai_shang"))]
                rows = list_evidence_for_user("u1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome"], "unresolved")
        self.assertEqual(rows[0]["report_path"], "evidence_fork")
        self.assertEqual(fake.fork_calls, 1)
        self.assertNotIn("可见回答", json.dumps(fake.fork_messages, ensure_ascii=False))
        self.assertEqual(sum(event["event"] == "content" for event in events), 1)


if __name__ == "__main__":
    unittest.main()
