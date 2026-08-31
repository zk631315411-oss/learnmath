import unittest

from app.services.qa.prompt_builder import (
    build_qa_prompt,
    build_system_prompt,
    build_user_message,
    build_user_message_with_image,
)


class PromptBuilderTests(unittest.TestCase):
    def test_current_question_and_history_are_not_dropped(self):
        messages = build_user_message(
            "为什么？",
            history=[{"user": "什么是特征值？", "assistant": "先回忆矩阵作用。"}],
        )
        text = "\n".join(part["text"] for part in messages[0]["content"])
        self.assertIn("什么是特征值", text)
        self.assertIn("为什么？", text)
        self.assertIn("只提出一个澄清问题", text)

    def test_image_turn_keeps_image_and_user_text(self):
        messages = build_user_message_with_image(
            "为什么？", "data:image/png;base64,AA=="
        )
        content = messages[0]["content"]
        self.assertEqual(content[0]["type"], "image_url")
        self.assertIn("为什么？", content[-1]["text"])
        self.assertTrue(any("首轮执行检查" in part.get("text", "") for part in content))

    def test_system_prompt_contains_soft_teaching_contract(self):
        prompt = build_system_prompt()
        self.assertIn("retrieve_kg_context", prompt)
        self.assertIn("四级脚手架", prompt)
        self.assertIn("\\lambda$ 可以为零", prompt)
        self.assertIn("什么是 X", prompt)
        self.assertIn("最多提出一个", prompt)
        self.assertIn("[[cite:<source_code>]]", prompt)
        self.assertIn("不要自己编造 URL、章节号", prompt)
        self.assertIn("没有真实 KG 命中就不要输出引用标记", prompt)

    def test_explain_phrasing_still_requires_first_turn_probe(self):
        prompt = build_system_prompt()
        message = build_user_message("讲一下什么是线性无关")
        text = "\n".join(part["text"] for part in message[0]["content"])
        for phrase in ("讲一下 X", "讲讲 X", "解释一下 X"):
            self.assertIn(phrase, prompt)
            self.assertIn(phrase, text)
        self.assertIn("仍须先探测", text)

    def test_compatibility_prompt_includes_real_input(self):
        prompt = build_qa_prompt("为什么？", history=[{"user": "特征值", "assistant": ""}])
        self.assertIn("特征值", prompt)
        self.assertIn("为什么？", prompt)


if __name__ == "__main__":
    unittest.main()
