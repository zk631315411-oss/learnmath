# services/ 后端交互目录

对后端 HTTP API 的封装：request（统一 fetch：token/超时/重试/错误转换）、api（各端点函数，含 SSE 流式 fetchWithStage({ request, callbacks })）、error（错误类型）。

约定：组件不直接 fetch，一律经 services；SSE 解析只存在于 api.ts。
