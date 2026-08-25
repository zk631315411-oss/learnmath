# 内测欢迎与反馈 Feature 验收记录

> 验收日期：2026-08-26
> 分支：`feature/internal-test-welcome`
> 工作树：`D:\LearnMath-internal-test-welcome`
> 结论：欢迎弹窗、反馈问卷、反馈接口及本轮响应式阅读工具调整通过技术验收

## 1. 本次验收范围

- 首次访问自动展示欢迎弹窗；普通关闭不写入永久标记。
- “不再显示”写入 `learnmath.welcome.dismissed=1`，刷新后不再自动出现。
- 顶栏保留“内测反馈”入口；匿名用户和登录用户均可提交反馈。
- 问卷校验 1–5 分必填，其他字段按计划选填；成功、失败和提交中状态可见。
- `/api/feedback` 校验长度并按 UTC 日期原子追加到 `data/feedback/*.json`。
- 桌面端问题输入区与工具栏维持当前定稿布局。
- 手机端阅读工具支持自由拖动、四边吸附、长按解吸附、位置持久化、向内展开、徽标避让和半屏面板避让。
- 手机端 PDF 改为连续上下滚动阅读，按可见面积同步当前页，并通过渲染窗口将 Canvas 数量限制在当前页前后各 2 页。
- 手机端支持双指缩放 PDF：以手势中心为锚点，范围为适宽基准的 75%–300%，松手后重绘并按教材持久化；浏览器视口本身不缩放。
- 桌面端不渲染手机悬浮工具，原阅读器与聊天链路保持兼容。

## 2. 明确不在本次代码交付范围

- PV 视频文件：素材尚未提供，欢迎弹窗保留明确占位。
- `test_001` 至 `test_010` 的模拟数据生成、复制和跨账号隔离验收：由独立工作线执行。
- 反馈截图上传、统计面板和 CSV 导出：按计划留在 V2。

## 3. 自动化证据

| 检查 | 结果 |
|---|---|
| `python -m pytest tests/test_feedback.py -q` | 2 passed |
| `python -m pytest -q` | 213 passed，3 skipped，32 个子测试通过 |
| `npm run test:unit -- --run` | 8 files，44 tests passed |
| `npm run build` | TypeScript 与 Vite 生产构建通过 |
| `npx playwright test frontend-redesign.spec.ts` | 52 passed，54 条按项目/视觉开关预期 skipped，0 failed |
| `git diff --check` | 通过；仅有 Windows 行尾提示，无空白错误 |

E2E 明确覆盖：欢迎弹窗普通关闭与永久关闭、问卷必填和成功提交、桌面截图提问、历史对话、地图内联梯子、进度增量、重复 done 幂等，以及手机端连续上下翻页、远距离页码跳转、单指惯性滚动、双指焦点缩放、75%/300% 边界、缩放持久化、四边吸附、350ms 长按、刷新持久化、上下边徽标和半屏避让。

## 4. 视觉检查

在 `390x844`、`512x560`、`844x390` 和桌面视口完成截图检查。四边停靠和展开截图保存在工作树 `artifacts/`，未作为产品运行时资源提交：

- `artifacts/mobile-dock-top.png`
- `artifacts/mobile-dock-top-open.png`
- `artifacts/mobile-dock-bottom.png`
- `artifacts/mobile-dock-bottom-open.png`
- `artifacts/mobile-continuous-first.png`
- `artifacts/mobile-pinch.png`
- `artifacts/mobile-reader-tools-final/`

检查结论：顶部停靠不侵入应用页眉，底部停靠不遮挡教材正文；工具栏始终向可用内容区展开，待处理徽标在四边均不被裁切。连续页面之间没有空白 Canvas，双指缩放只改变 PDF 内容，缩放后仍可横向、纵向平移，页码与工具控件没有遮挡。另在 `320x568` 极窄视口复核，反馈入口会按低优先级隐藏，登录入口和阅读控件保持可见且不发生横向溢出。

## 5. 遗留协同项

本记录只证明本 feature 的 UI、反馈持久化与响应式阅读交互完成。测试账号数据和 PV 素材完成后，应分别新增验收记录；不得回写本记录来替代跨账号隔离或真实数据验收。
