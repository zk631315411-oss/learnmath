"""QA 回答模块的 Prompt 构造器 — 阶段 1 精简版。

只保留基础角色段 + 历史对话，KG/诊断/可视化相关的模板一律不引入。
"""

from __future__ import annotations

# Socratic 子模式对应的角色段
SUBMODE_ROLE = {
    "preview": "你是一位数学导学教练。学生还没学过这个概念，你需要用生活中的例子和直观类比引入，通过一系列引导性问题让学生自己发现规律。不要直接给出定义和结论，要让学生从具体现象中归纳。",
    "exam_review": "你是一位数学备考教练。学生正在准备考试，你需要快速扫描学生的知识盲区，用典型考题的反例和常见陷阱来检验理解。重点放在审题技巧、易错点、时间分配上。",
    "connected_review": "你是一位数学知识架构师。学生已经分散地学过了各个章节，你需要用引导性问题帮助学生发现跨章节的联系。",
    "unclassified": "你是一位博学的数学家，擅长用苏格拉底式提问法引导用户思考。",
}

DIRECT_ROLE = "你是一位博学的数学家。请对题目进行详细讲解，包括完整解题步骤，最终给出正确答案。数学公式必须用 LaTeX 格式。"


def build_qa_prompt(
    question: str,
    *,
    history: list[dict] | None = None,
    teaching_mode: str = "socratic",
    socratic_submode: str = "unclassified",
    screenshot_note: str = "",
) -> str:
    """构造基础问答 Prompt：角色段 + 截图说明 + 历史 + 学生问题。

    screenshot_note 在有截图时提示模型结合图片作答，否则为空字符串。
    """
    if teaching_mode == "direct":
        role = DIRECT_ROLE
    else:
        role = SUBMODE_ROLE.get(socratic_submode, SUBMODE_ROLE["unclassified"])

    history_text = _format_history(history)
    return f"""{role}

{screenshot_note}

【最近相关历史】
{history_text}

【学生问题】
{question}

请用中文回答，数学公式用 LaTeX。"""


def _format_history(history: list[dict] | None) -> str:
    """把最近几轮问答对渲染成给模型的对话记录（只保留最后 3 轮控制上下文长度）。"""
    if not history:
        return "（无）"
    lines: list[str] = []
    for item in history[-3:]:
        user = item.get("user") or item.get("question") or ""
        assistant = item.get("assistant") or item.get("answer") or ""
        if user:
            lines.append(f"- 学生：{user[:180]}")
        if assistant:
            lines.append(f"  老师：{assistant[:260]}")
    return "\n".join(lines) if lines else "（无）"
