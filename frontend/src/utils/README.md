# utils/ 工具目录

无状态纯函数与通用小工具。storage（localStorage JSON/字符串安全读写，全库 key 读写统一入口）、chatHistory（chat_history 记录 JSON 字段归一化，useMarkers 与 useQuestionList 共用，防止两处解析逻辑漂移）、imageProcessing（截图上传预处理）、pagePosition（教材页码恢复键读写收敛，PDFViewer 与 App 跨教材跳转共用同一 key 与格式，防止写读不一致）。
