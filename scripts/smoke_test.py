"""LearnMath 部署冒烟测试：docker 构建/部署后一键核验核心功能。

用法（仓库根目录）：
    venv\\Scripts\\python scripts\\smoke_test.py --password <测试账号密码>
    或先设置环境变量 SMOKE_PASSWORD。

覆盖：就绪探针、认证、教材 PDF、学习地图、学习进度、学生模型、聊天记录、
公式转写/识别、问答主链路（SSE）、manim 产物端点。

退出码：0 = 全部通过；1 = 有失败项；2 = 参数/环境错误。
设计原则：只读为主，写入仅产生测试聊天记录；跑完不污染环境。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import uuid

import requests

OK, FAIL = "✅", "❌"
TEXTBOOK = "gaodai_shang"

results: list[tuple[str, bool, str]] = []


def check(name: str, cond: bool, detail: str = "", hint: str = "") -> bool:
    results.append((name, bool(cond), detail))
    line = f"  {OK if cond else FAIL} {name}" + (f" — {detail}" if detail else "")
    if not cond and hint:
        line += f"\n      排查提示: {hint}"
    print(line, flush=True)
    return bool(cond)


def sse_ask(base: str, headers: dict, question: str, page: int, user_id: str,
            chat_id: str | None = None, history: list | None = None,
            read_timeout: int = 240) -> tuple[dict | None, float]:
    payload = {
        "question": question,
        "textbook_id": TEXTBOOK,
        "page_number": page,
        "teaching_mode": "socratic",
        "token": headers["Authorization"].split(" ", 1)[1],
        "client_turn_id": f"smoke-{uuid.uuid4().hex[:12]}",
    }
    if chat_id:
        payload["chat_id"] = chat_id
        payload["marker_id"] = chat_id
    if history:
        payload["history"] = history
    t0 = time.time()
    done = None
    with requests.post(f"{base}/api/qa/solve-stream", data={"payload": json.dumps(payload)},
                       headers=headers, stream=True, timeout=(10, read_timeout)) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            try:
                parsed = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if parsed.get("qa_turn_id") and "latency_ms" in parsed:
                done = parsed
                break
    return done, time.time() - t0


def main() -> int:
    parser = argparse.ArgumentParser(description="LearnMath 部署冒烟测试")
    parser.add_argument("--base-url", default=os.environ.get("SMOKE_BASE_URL", "http://localhost:8090"))
    parser.add_argument("--username", default=os.environ.get("SMOKE_USERNAME", "kz"))
    parser.add_argument("--password", default=os.environ.get("SMOKE_PASSWORD", ""))
    parser.add_argument("--skip-qa", action="store_true", help="跳过最耗时的问答主链路（约 20~100 秒）")
    parser.add_argument("--qa-timeout", type=int, default=240)
    args = parser.parse_args()
    if not args.password:
        print("错误: 缺少测试账号密码（--password 或环境变量 SMOKE_PASSWORD）", file=sys.stderr)
        return 2
    base = args.base_url.rstrip("/")

    # [0] 就绪探针：nginx /health → api /ready（含 LLM 配置 + KG 连通检查）
    print("[0] 服务就绪")
    try:
        r = requests.get(f"{base}/health", timeout=15)
        check("就绪探针 /health", r.status_code == 200, f"HTTP {r.status_code} {r.text[:60]}",
              hint="api 未就绪：docker compose ps 看容器健康；503 看响应 detail（LLM 未配置/KG 不可达）")
    except requests.RequestException as exc:
        check("就绪探针 /health", False, str(exc), hint="栈未启动：先 docker compose up -d")
        return _summary()

    # [1] 认证
    print("[1] 认证")
    r = requests.post(f"{base}/api/auth/login",
                      json={"username": args.username, "password": args.password}, timeout=10)
    token = (r.json().get("access_token") or r.json().get("token")) if r.status_code == 200 else None
    if not check("登录", r.status_code == 200 and bool(token), f"HTTP {r.status_code}",
                 hint="账号/密码错误或 auth 服务异常"):
        return _summary()
    H = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{base}/api/auth/me", headers=H, timeout=10)
    me = r.json() if r.status_code == 200 else {}
    user_id = me.get("id") or me.get("user_id")
    check("用户信息 /me", r.status_code == 200 and bool(user_id),
          me.get("username", f"HTTP {r.status_code}"))
    if not user_id:
        return _summary()

    # [2] 教材
    print("[2] 教材")
    r = requests.get(f"{base}/gaodai_vol1.pdf", headers={"Range": "bytes=0-1023"}, timeout=15)
    check("PDF 加载（web 层 Range）", r.status_code in (200, 206), f"HTTP {r.status_code}",
          hint="教材目录未挂载进 web/api 容器：检查 LEARNMATH_TEXTBOOKS_DIR 与 compose volumes")
    r = requests.get(f"{base}/api/textbook/section-page",
                     params={"textbook_id": TEXTBOOK, "section": "2.4"}, headers=H, timeout=15)
    page_info = r.json() if r.status_code == 200 else {}
    check("小节→页码定位", r.status_code == 200 and bool(page_info.get("page")),
          f"2.4 → 第 {page_info.get('page')} 页" if page_info else f"HTTP {r.status_code}",
          hint="api 容器缺 PyMuPDF 或教材挂载：page-sections 依赖 PDF 反查")

    # [3] 学习地图
    print("[3] 学习地图")
    r = requests.get(f"{base}/api/learning-map/chapters", params={"textbook_id": TEXTBOOK}, headers=H, timeout=15)
    chs = r.json().get("chapters", []) if r.status_code == 200 else []
    check("地图章节", r.status_code == 200 and len(chs) == 6, f"{len(chs)} 章")
    r = requests.get(f"{base}/api/learning-map/page-sections", params={"textbook_id": TEXTBOOK}, headers=H, timeout=30)
    ps = r.json().get("page_sections", {}) if r.status_code == 200 else {}
    check("页码→小节映射", len(ps) > 300, f"{len(ps)} 页",
          hint="教材 PDF 未进 api 容器（挂载或 PyMuPDF 缺失）")
    r = requests.get(f"{base}/api/learning-map/nodes",
                     params={"textbook_id": TEXTBOOK, "chapter": "第2章 行列式"}, headers=H, timeout=20)
    secs = r.json().get("sections", []) if r.status_code == 200 else []
    n_nodes = sum(len(s.get("nodes", [])) for s in secs)
    check("章节节点（含状态）", r.status_code == 200 and n_nodes > 100, f"{len(secs)} 节 {n_nodes} 节点",
          hint="KG(Neo4j) 不可达或无数据：检查 NEO4J_URI/凭据与启动配置审计日志")

    # [4] 学习进度 / 学生模型
    print("[4] 学习进度/学生模型")
    r = requests.get(f"{base}/api/learning-progress", params={"textbook_id": TEXTBOOK}, headers=H, timeout=15)
    prog = r.json() if r.status_code == 200 else {}
    check("学习进度", r.status_code == 200 and "nodes" in prog,
          f"revision={prog.get('revision')}, {len(prog.get('nodes', {}))} 节点")
    r = requests.get(f"{base}/api/learner-model", params={"textbook_id": TEXTBOOK}, headers=H, timeout=15)
    check("学生模型", r.status_code == 200, f"HTTP {r.status_code}")

    # [5] 聊天记录
    print("[5] 聊天记录")
    turn = f"smoke-{uuid.uuid4().hex[:12]}"
    r = requests.post(f"{base}/api/chat/history", json={
        "user_id": user_id, "question": "冒烟测试：什么是行列式？", "answer": None,
        "page_number": 65, "marker_y_ratio": 0, "marker_type": "text",
        "textbook_id": TEXTBOOK, "client_turn_id": turn,
    }, headers=H, timeout=10)
    chat_id = r.json().get("id") if r.status_code == 200 else None
    check("创建提问记录", r.status_code == 200 and bool(chat_id), f"HTTP {r.status_code}")
    if chat_id:
        r = requests.get(f"{base}/api/chat/history/{user_id}",
                         params={"page": 65, "limit": 50, "textbook_id": TEXTBOOK}, headers=H, timeout=10)
        data = r.json() if r.status_code == 200 else {}
        records = data if isinstance(data, list) else data.get("records") or data.get("items") or []
        check("按页读取记录", r.status_code == 200 and any(rec.get("id") == chat_id for rec in records),
              f"第65页 {len(records)} 条")
        r = requests.post(f"{base}/api/chat/history/{chat_id}/follow-ups",
                          json={"turn_id": f"{turn}-fu", "question": "能举个二阶的例子吗", "status": "pending"},
                          headers=H, timeout=10)
        check("追问落库", r.status_code == 200, f"HTTP {r.status_code}")

    # [6] 公式
    print("[6] 公式")
    r = requests.post(f"{base}/api/formula/convert", json={"description": "x的平方加y的平方等于1"},
                      headers=H, timeout=40)
    latex = r.json().get("latex") if r.status_code == 200 else None
    check("公式转写（文字→LaTeX）", r.status_code == 200 and bool(latex),
          latex or f"HTTP {r.status_code} {r.text[:80]}")
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (640, 200), "white")
        ImageDraw.Draw(img).text((60, 80), "x^2 + y^2 = 1", fill="black")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        r = requests.post(f"{base}/api/formula/recognize",
                          files={"image": ("f.png", buf, "image/png")}, headers=H, timeout=60)
        latex2 = r.json().get("latex") if r.status_code == 200 else None
        check("公式识别（图片→LaTeX）", r.status_code == 200 and bool(latex2),
              latex2 or f"HTTP {r.status_code} {r.text[:80]}",
              hint="503/not_configured = FORMULA_VISION_API_KEY 未进容器（.env 与 runtime.env 不同步）；"
                   "启动日志 startup config audit 可确认")
    except ImportError:
        check("公式识别（图片→LaTeX）", False, "本机缺 Pillow", hint="用项目 venv 运行本脚本")
    except requests.RequestException as exc:
        check("公式识别（图片→LaTeX）", False, f"请求异常: {exc}")

    # [7] 问答主链路（SSE，最耗时）
    if args.skip_qa:
        print("[7] 问答主链路（--skip-qa 跳过）")
    else:
        print("[7] 问答主链路（SSE）")
        try:
            done, elapsed = sse_ask(base, H, "什么是矩阵的秩？一句话说明。", 90, user_id,
                                    read_timeout=args.qa_timeout)
        except requests.RequestException as exc:
            done, elapsed = None, 0.0
            check("问答主链路", False, f"请求异常: {exc}",
                  hint="LLM 未配置或超时：看启动配置审计与 QA_LLM_* 环境变量")
        if done is not None:
            answer = done.get("full_text") or ""
            tools = [a.get("tool") for a in done.get("tool_activities") or []]
            check("提问→回答完成", bool(answer), f"{elapsed:.1f}s, {len(answer)}字, 工具={tools}")
            check("证据管道（progress_delta）", bool(done.get("progress_delta")),
                  hint="证据未落库：学习地图状态不会推进；查 learnmath.evidence 日志")

    # [8] manim 产物端点（渲染全链路的端到端探针见 output/manim_e2e_probe.py，需容器内执行）
    print("[8] 数学动画")
    if chat_id:
        r = requests.get(f"{base}/api/manim/artifacts", params={"chat_id": chat_id}, headers=H, timeout=10)
        check("manim 产物列表（按线程）", r.status_code == 200,
              f"HTTP {r.status_code}" + (f", {len(r.json())} 个产物" if r.status_code == 200 else ""),
              hint="422 = 缺 chat_id 查询参数（端点契约）")

    # [9] 收尾：删除本次冒烟产生的测试记录，保证脚本可反复运行且不留垃圾数据
    print("[9] 清理")
    if chat_id:
        r = requests.delete(f"{base}/api/chat/history/{chat_id}", headers=H, timeout=10)
        check("清理测试记录", r.status_code == 200, f"HTTP {r.status_code}")

    return _summary()


def _summary() -> int:
    print()
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"===== 冒烟结果: {passed}/{len(results)} 通过 =====")
    for name, ok, detail in results:
        if not ok:
            print(f"  未通过: {name} — {detail}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
