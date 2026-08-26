import asyncio
import json
import time
import unittest
from types import SimpleNamespace

from app.services.agents.tool_runtime import (
    RoundInjection,
    ToolRuntime,
    ToolRuntimeConfig,
    ToolRuntimeContext,
)
from app.services.agents.tool_def import ToolDef


def chunk(*, content="", reasoning="", tool_calls=None):
    delta = SimpleNamespace(
        content=content,
        reasoning_content=reasoning,
        tool_calls=tool_calls or [],
    )
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


class ToolRuntimeStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_round_injection_emits_running_and_sanitized_completion(self):
        tool_call = SimpleNamespace(
            index=0,
            id="call-kg",
            function=SimpleNamespace(
                name="retrieve_kg_context",
                arguments='{"query":"矩阵乘法"}',
            ),
        )
        responses = iter([
            [chunk(tool_calls=[tool_call])],
            [chunk(content="最终回答")],
        ])

        async def status_hook(_round, completed):
            if any(item.get("name") == "retrieve_kg_context" for item in completed):
                return {"status": "running", "private": "must-not-leak"}
            return None

        async def injector(_round, _completed):
            return RoundInjection(
                message={"role": "system", "content": "private memory summary"},
                status="success",
                duration_ms=7,
            )

        tool = ToolDef(
            name="retrieve_kg_context",
            display_name="查询知识图谱",
            description="查询知识图谱",
            input_schema={"type": "object", "properties": {}},
            execute=lambda query: {"status": "resolved", "query": query},
        )
        calls: list[list[dict]] = []

        async def capturing_model_call(**kwargs):
            calls.append(kwargs["messages"])
            return next(responses)

        runtime = ToolRuntime(
            tools=[tool],
            model_call=capturing_model_call,
            round_injector=injector,
            round_injection_status=status_hook,
        )
        events = [event async for event in runtime.run(
            [{"role": "user", "content": "问题"}],
            ToolRuntimeContext(turn_id="turn", user_id="user"),
        )]

        statuses = [event.data for event in events if event.type == "round_injection_status"]
        self.assertEqual([item["status"] for item in statuses], ["running", "success"])
        self.assertEqual(statuses[-1]["duration_ms"], 7)
        self.assertNotIn("private", json.dumps(statuses, ensure_ascii=False))
        self.assertIn("private memory summary", json.dumps(calls[1], ensure_ascii=False))

    async def test_forwards_reasoning_and_content_deltas_before_done(self):
        async def model_call(**_kwargs):
            return [
                chunk(reasoning="先分析"),
                chunk(reasoning="再计算"),
                chunk(content="答案"),
                chunk(content="是 42"),
            ]

        runtime = ToolRuntime(tools=[], model_call=model_call)
        events = []
        async for event in runtime.run(
            [{"role": "user", "content": "问题"}],
            ToolRuntimeContext(turn_id="turn", user_id="user"),
        ):
            events.append(event)

        self.assertEqual(
            [event.type for event in events],
            ["thinking_delta", "thinking_delta", "content_delta", "content_delta", "final"],
        )
        result = events[-1].data["result"]
        self.assertEqual(result.reasoning, "先分析再计算")
        self.assertEqual(result.content, "答案是 42")
        self.assertFalse(any(
            message.get("role") == "assistant" and message.get("content") == "答案是 42"
            for message in result.messages
        ))

    async def test_budget_final_answer_is_not_appended_to_result_messages(self):
        tool_call = SimpleNamespace(
            index=0,
            id="call-budget",
            function=SimpleNamespace(
                name="retrieve_kg_context",
                arguments='{"query":"矩阵乘法"}',
            ),
        )
        responses = iter([
            [chunk(tool_calls=[tool_call])],
            [chunk(content="预算结束后的最终回答")],
        ])

        async def model_call(**_kwargs):
            return next(responses)

        tool = ToolDef(
            name="retrieve_kg_context",
            display_name="查询知识图谱",
            description="查询知识图谱",
            input_schema={"type": "object", "properties": {}},
            execute=lambda query: {"status": "resolved", "query": query},
        )
        runtime = ToolRuntime(
            tools=[tool],
            model_call=model_call,
            config=ToolRuntimeConfig(max_total_calls=1),
        )
        events = [event async for event in runtime.run(
            [{"role": "user", "content": "问题"}],
            ToolRuntimeContext(turn_id="turn", user_id="user"),
        )]

        result = events[-1].data["result"]
        self.assertEqual(result.content, "预算结束后的最终回答")
        self.assertEqual(result.degradation_code, "tool_budget_exceeded")
        self.assertFalse(any(
            message.get("role") == "assistant"
            and message.get("content") == "预算结束后的最终回答"
            for message in result.messages
        ))

    async def test_sync_provider_stream_does_not_block_event_loop(self):
        class SlowStream:
            def __init__(self):
                self._chunks = iter([
                    chunk(content="第一段"),
                    chunk(content="第二段"),
                ])

            def __iter__(self):
                return self

            def __next__(self):
                time.sleep(0.05)
                return next(self._chunks)

        async def model_call(**_kwargs):
            return SlowStream()

        ticker_ran = asyncio.Event()

        async def ticker():
            await asyncio.sleep(0.01)
            ticker_ran.set()

        ticker_task = asyncio.create_task(ticker())
        runtime = ToolRuntime(tools=[], model_call=model_call)
        events = []
        async for event in runtime.run(
            [{"role": "user", "content": "问题"}],
            ToolRuntimeContext(turn_id="turn", user_id="user"),
        ):
            events.append(event)
            if event.type == "content_delta":
                self.assertTrue(ticker_ran.is_set())
                break

        await ticker_task
        self.assertEqual(events[0].data["text"], "第一段")

    async def test_tool_events_include_public_arguments_and_result(self):
        tool_call = SimpleNamespace(
            index=0,
            id="call-1",
            function=SimpleNamespace(
                name="retrieve_kg_context",
                arguments='{"query":"矩阵乘法"}',
            ),
        )
        responses = iter([
            [chunk(tool_calls=[tool_call])],
            [chunk(content="最终回答")],
        ])

        async def model_call(**_kwargs):
            return next(responses)

        tool = ToolDef(
            name="retrieve_kg_context",
            display_name="查询知识图谱",
            description="查询知识图谱",
            input_schema={"type": "object", "properties": {}},
            execute=lambda query: {
                "status": "resolved",
                "selected_node": {"name": query},
                "internal_debug": "must-not-leak",
            },
            present_result=lambda result: {
                "status": result["status"],
                "selected_node": result["selected_node"],
            },
        )
        runtime = ToolRuntime(tools=[tool], model_call=model_call)
        events = [event async for event in runtime.run(
            [{"role": "user", "content": "问题"}],
            ToolRuntimeContext(turn_id="turn", user_id="user"),
        )]

        call_event = next(event for event in events if event.type == "tool_call")
        result_event = next(event for event in events if event.type == "tool_result")
        self.assertEqual(call_event.data["arguments"], {"query": "矩阵乘法"})
        self.assertEqual(call_event.data["display_name"], "查询知识图谱")
        self.assertEqual(result_event.data["status"], "success")
        self.assertEqual(result_event.data["result"]["selected_node"]["name"], "矩阵乘法")
        self.assertNotIn("internal_debug", result_event.data["result"])

    async def test_total_budget_stops_new_calls_but_answer_still_completes(self):
        executed: list[str] = []

        def make_tool(name):
            # ToolDef defaults (3/round, 3/turn) allow seven distinct calls;
            # only the global budget may stop the eighth.
            return ToolDef(
                name=name,
                display_name=name,
                description=name,
                input_schema={"type": "object", "properties": {}},
                execute=lambda **kwargs: executed.append(name) or {"status": "ok"},
            )

        tools = [make_tool(f"tool_{letter}") for letter in "abcdefg"]

        def call(name, call_id):
            return SimpleNamespace(
                index=0, id=call_id,
                function=SimpleNamespace(name=name, arguments="{}"),
            )

        responses = iter([
            [chunk(tool_calls=[call("tool_a", "c1")])],
            [chunk(tool_calls=[call("tool_b", "c2")])],
            [chunk(tool_calls=[call("tool_c", "c3")])],
            [chunk(tool_calls=[call("tool_d", "c4")])],
            [chunk(tool_calls=[call("tool_e", "c5")])],
            [chunk(tool_calls=[call("tool_f", "c6")])],
            [chunk(tool_calls=[call("tool_g", "c7")])],
            [chunk(content="预算内完成回答")],
        ])

        captured_tool_choices: list = []

        async def model_call(**kwargs):
            captured_tool_choices.append(kwargs.get("tool_choice"))
            return next(responses)

        runtime = ToolRuntime(
            tools=tools,
            model_call=model_call,
            config=ToolRuntimeConfig(
                max_total_calls=7,
                max_model_rounds=10,
                max_consecutive_failure_rounds=99,
            ),
        )
        events = [event async for event in runtime.run(
            [{"role": "user", "content": "问题"}],
            ToolRuntimeContext(turn_id="turn", user_id="user"),
        )]

        # stats["called"] reaches 7 after seven executions; the scripted
        # eighth call is never executed because the runtime degrades at the
        # >= boundary before its model round.
        tool_results = [event for event in events if event.type == "tool_result"]
        self.assertEqual(len(tool_results), 7)
        self.assertTrue(all(event.data["status"] == "success" for event in tool_results))
        self.assertEqual(len(executed), 7)
        self.assertNotIn("tool_a", executed[1:])
        final = events[-1].data["result"]
        self.assertEqual(final.content, "预算内完成回答")
        self.assertEqual(final.degradation_code, "tool_budget_exceeded")
        self.assertEqual(final.stats["called"], 7)
        self.assertEqual(final.stats["succeeded"], 7)
        self.assertEqual(captured_tool_choices[-1], "none")


if __name__ == "__main__":
    unittest.main()
