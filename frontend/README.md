# LearnMath 前端

## 这个目录为什么存在

前端是 LearnMath 的学生端交互层，把 PDF 教材变成"可提问的数学学习台"：选教材、翻页阅读，框选或输入题目后，AI 通过 SSE 流式返回解答；提问会以徽标形式钉在教材页面上，形成按页组织的提问记录，点击徽标可回看该题对话。

为什么是当前形态：数学题大多以图片/公式形态存在于 PDF，无法直接复制文本提问，因此核心交互是"截图框选 → 看图问答"；公式渲染（KaTeX）与富文本编辑（TipTap/mathlive）是数学问答的刚需，故一并内嵌。

## 技术栈

- React 18 + TypeScript，Vite 5 构建
- Tailwind CSS（样式）
- react-pdf + pdfjs-dist（PDF 渲染）
- KaTeX / rehype-katex（公式渲染）
- SSE 流式问答（直连后端 `/solve-stream`，非轮询）

## 常用命令

- `npm run build`：类型检查（tsc -b）+ 产物构建，构建前必须零错误
- `npm run dev`：本地开发（默认 5173）
- `npx playwright test`：端到端测试；webServer 自动起 127.0.0.1:4173，桌面/移动两个 project 各跑一遍

## 目录组织（一句话版）

- `src/`：全部源码 —— components（组件）、hooks（状态逻辑）、services（API 调用）、types（类型）、utils（工具）
- `tests/specs/`：Playwright e2e 规格；`test-results/` 为运行产物（不入库）
- `public/`：静态资源（含本地 PDF 教材副本）
