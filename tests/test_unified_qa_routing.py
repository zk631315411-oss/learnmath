import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import UploadFile
from starlette.datastructures import Headers

from app.models.schemas import QARequest
from app.auth.jwt_handler import create_access_token
from app.routers.qa import _generate_with_heartbeat, get_user_id_and_profile, solve_question_stream
from fastapi import HTTPException
from app.services.agents.tool_def import ToolDef
from app.services.agents.tool_runtime import RuntimeEvent, ToolRuntime
from app.services.qa.answer_service import answer_turn_with_tools
from app.services.qa.contracts import QATurnInput


def streamed_chunk(*, content="", reasoning=""):
    delta = SimpleNamespace(
        content=content,
        reasoning_content=reasoning,
        tool_calls=[],
    )
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


def kg_tool():
    return ToolDef(
        name="retrieve_kg_context",
        description="查询知识图谱",
        input_schema={"type": "object", "properties": {}},
        execute=lambda: {"found": True},
    )


class _NormalizedImage:
    def data_url(self):
        return "data:image/png;base64,AA=="


async def consume_response(response):
    async for _ in response.body_iterator:
        pass


class UnifiedQARoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_qa_identity_comes_only_from_token(self):
        token = create_access_token({"user_id": "token-user"})
        with patch("app.routers.qa.get_user_profile", return_value=None):
            user_id, _ = get_user_id_and_profile(QARequest(user_id="attacker-choice", token=token, question="q"))
        self.assertEqual(user_id, "token-user")
        with self.assertRaises(HTTPException):
            get_user_id_and_profile(QARequest(user_id="attacker-choice", question="q"))

    async def test_sse_wrapper_does_not_buffer_immediate_events(self):
        produced = 0

        async def immediate_events():
            nonlocal produced
            for index in range(3):
                produced += 1
                yield {"event": "content", "data": json.dumps({"text": str(index)})}

        async for event in _generate_with_heartbeat(immediate_events()):
            self.assertEqual(event["event"], "content")
            self.assertEqual(produced, 1)
            break

    async def test_text_and_image_requests_share_the_same_agent_route(self):
        calls = []

        async def fake_agent(turn_input):
            calls.append(turn_input)
            yield {"event": "done", "data": json.dumps({"full_text": "ok"})}

        text_payload = QARequest(user_id="user", question="解释矩阵乘法").model_dump_json()
        image_payload = QARequest(user_id="user", question="请分析图片").model_dump_json()
        image = UploadFile(
            file=io.BytesIO(b"image"),
            filename="question.png",
            headers=Headers({"content-type": "image/png"}),
        )

        with (
            patch("app.routers.qa.answer_turn_with_tools", fake_agent),
            patch("app.routers.qa.get_user_id_and_profile", return_value=("user", None)),
            patch("app.routers.qa.normalize_image_bytes", return_value=_NormalizedImage()),
        ):
            await consume_response(await solve_question_stream(payload=text_payload, image=None))
            await consume_response(await solve_question_stream(payload=image_payload, image=image))

        self.assertEqual(len(calls), 2)
        self.assertIsNone(calls[0].image_data)
        self.assertEqual(calls[1].image_data, "data:image/png;base64,AA==")

    async def test_both_input_shapes_send_tools_to_the_same_multimodal_model_call(self):
        captured = []

        def fake_chat_with_tools(messages, tools, **kwargs):
            captured.append((messages, tools, kwargs))
            return [streamed_chunk(reasoning="思考"), streamed_chunk(content="回答")]

        common_patches = (
            patch("app.services.qa.answer_service.llm_service.is_available", return_value=True),
            patch("app.services.qa.answer_service.llm_service.chat_with_tools", side_effect=fake_chat_with_tools),
            patch("app.services.agents.tools.get_qa_tool_defs", return_value=[kg_tool()]),
            patch("app.services.qa.answer_service.prepare_screenshot_context", return_value={}),
            patch("app.services.qa.answer_service.update_vision_summary"),
        )
        with common_patches[0], common_patches[1], common_patches[2], common_patches[3], common_patches[4]:
            text_events = [event async for event in answer_turn_with_tools(
                QATurnInput(user_id="user", question="什么是矩阵乘法")
            )]
            image_events = [event async for event in answer_turn_with_tools(
                QATurnInput(
                    user_id="user",
                    question="请分析图片中的题目",
                    image_data="data:image/png;base64,AA==",
                )
            )]

        self.assertEqual(len(captured), 2)
        self.assertTrue(all(call[1] for call in captured))
        self.assertEqual(captured[0][0][0]["role"], "system")
        self.assertEqual(captured[0][0][1]["content"][0]["type"], "text")
        self.assertEqual(captured[1][0][0]["role"], "system")
        self.assertEqual(captured[1][0][1]["content"][0]["type"], "image_url")
        self.assertIn("请分析图片中的题目", captured[1][0][1]["content"][-1]["text"])
        self.assertEqual(captured[1][2]["stream"], True)
        self.assertIn("thinking", [event["event"] for event in text_events])
        self.assertIn("content", [event["event"] for event in image_events])
        self.assertTrue(any(event["event"] == "done" for event in image_events))

    async def test_tool_activity_is_forwarded_as_first_class_sse(self):
        async def fake_run(_self, _messages, _context):
            yield RuntimeEvent("tool_call", {
                "tool_call_id": "call-1",
                "name": "retrieve_kg_context",
                "display_name": "查询知识图谱",
                "arguments": {"query": "矩阵乘法"},
                "round": 1,
            })
            yield RuntimeEvent("tool_result", {
                "tool_call_id": "call-1",
                "name": "retrieve_kg_context",
                "status": "success",
                "result": {"status": "resolved", "selected_node": {"name": "矩阵乘法"}},
                "duration_ms": 12,
                "error_code": None,
                "error_message": None,
            })
            yield RuntimeEvent("content_delta", {"text": "回答"})

        with (
            patch("app.services.qa.answer_service.llm_service.is_available", return_value=True),
            patch("app.services.agents.tools.get_qa_tool_defs", return_value=[kg_tool()]),
            patch("app.services.qa.answer_service.prepare_screenshot_context", return_value={}),
            patch.object(ToolRuntime, "run", fake_run),
        ):
            events = [event async for event in answer_turn_with_tools(
                QATurnInput(user_id="user", question="解释矩阵乘法")
            )]

        event_types = [event["event"] for event in events]
        self.assertIn("tool_call", event_types)
        self.assertIn("tool_result", event_types)
        self.assertNotIn("tool", [
            json.loads(event["data"]).get("stage")
            for event in events if event["event"] == "stage"
        ])
        done = json.loads(next(event["data"] for event in events if event["event"] == "done"))
        self.assertEqual(done["tool_activities"][0]["arguments"]["query"], "矩阵乘法")
        self.assertEqual(done["tool_activities"][0]["status"], "success")

    async def test_turn_scope_and_runtime_budget_are_bound_to_runtime(self):
        captured = {}

        def fake_tools(*, textbook_id, page_number):
            captured["scope"] = (textbook_id, page_number)
            return [kg_tool()]

        async def fake_run(runtime, _messages, _context):
            captured["rounds"] = runtime.config.max_model_rounds
            captured["calls"] = runtime.config.max_total_calls
            yield RuntimeEvent("content_delta", {"text": "回答"})

        with (
            patch("app.services.qa.answer_service.llm_service.is_available", return_value=True),
            patch("app.services.agents.tools.get_qa_tool_defs", side_effect=fake_tools),
            patch.object(ToolRuntime, "run", fake_run),
        ):
            events = [event async for event in answer_turn_with_tools(QATurnInput(
                user_id="user",
                question="解释矩阵的秩",
                textbook_id="gaodai_shang",
                page_number=88,
            ))]

        self.assertEqual(captured["scope"], ("gaodai_shang", 88))
        self.assertEqual((captured["rounds"], captured["calls"]), (7, 3))
        self.assertEqual(events[-1]["event"], "done")

    async def test_multimodal_tool_call_failure_is_an_explicit_error(self):
        def rejected_chat(**_kwargs):
            raise RuntimeError("provider rejected image tools")

        with (
            patch("app.services.qa.answer_service.llm_service.is_available", return_value=True),
            patch("app.services.qa.answer_service.llm_service.chat_with_tools", side_effect=rejected_chat),
            patch("app.services.agents.tools.get_qa_tool_defs", return_value=[kg_tool()]),
            patch("app.services.qa.answer_service.prepare_screenshot_context", return_value={}),
        ):
            events = [event async for event in answer_turn_with_tools(QATurnInput(
                user_id="user",
                question="请分析图片",
                image_data="data:image/png;base64,AA==",
            ))]

        self.assertEqual(events[-1]["event"], "error")
        self.assertIn("图片 + 工具调用", json.loads(events[-1]["data"])["error"])
        self.assertFalse(any(event["event"] == "done" for event in events))

    async def test_missing_tools_does_not_fall_back_to_direct_answer(self):
        with (
            patch("app.services.qa.answer_service.llm_service.is_available", return_value=True),
            patch("app.services.agents.tools.get_qa_tool_defs", return_value=[]),
        ):
            events = [event async for event in answer_turn_with_tools(QATurnInput(
                user_id="user", question="解释极限"
            ))]

        self.assertEqual(events, [{
            "event": "error",
            "data": json.dumps({"error": "KG 工具未配置，无法启动统一教学 Agent；未执行无工具直答"}, ensure_ascii=False),
        }])


if __name__ == "__main__":
    unittest.main()
