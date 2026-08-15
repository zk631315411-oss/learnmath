# types/ 类型目录

跨层共享的 TypeScript 类型：Message（聊天消息）、Marker（页面徽标/对话线程）、PendingImage（待发截图，含各自 cropBBox）、CropBBox（选区 page_ratio 坐标）、ToolActivity（KG 工具活动）、User（认证态）等。

约定：类型只放定义，不放逻辑；后端 JSON 字段名与前端类型字段的映射集中在 services 层做。
