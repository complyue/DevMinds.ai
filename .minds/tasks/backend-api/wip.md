# 后端 API 开发

## 已实现接口

### 任务相关
- `GET /api/tasks/:id/wip` - 获取任务 WIP 摘要
- `GET /api/tasks/:id/tree` - 获取任务树结构
- `GET /api/tasks/:id/events` - 获取事件流

### Provider 相关  
- `GET /api/providers` - 获取 Provider 配置
- `POST /api/providers/test` - 测试连接

## 技术栈
- **框架**: Hono (轻量级 Web 框架)
- **运行时**: Node.js + TypeScript
- **WebSocket**: ws 库
- **验证**: Zod schema

## 特性
- 支持跨日期范围的事件查询
- 自动处理 JSONL 解析错误和警告
- WebSocket 实时通信基础框架
