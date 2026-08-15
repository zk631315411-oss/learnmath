import asyncio
import time
import unittest
from types import SimpleNamespace

from app.services.agents.tool_runtime import (
    ToolRuntime,
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


if __name__ == "__main__":
    unittest.main()
