# DevMinds.ai Development Tracker

> **文件更新原则**: 此文档只反映当前最新状态，不记录历史沿袭和时间戳。工作进度用 [ ]/[/]/[x] 标记，当前摘要反映实际完成情况，下一步列出待办事项。

- [ ] is holding
- [/] is doing
- [x] is done

### 项目文档

- [设计原则（第一性）](./design/DesignPrinciples.md)
- [软件功能架构设计](./design/Architecture.md)
- [运行时工作区结构设计](./design/WorkspaceStructure.md)
- [Web 组件与路由映射](./design/WebUIMapping.md)
- [后端 API/WS 契约草案](./design/API_WS_Contracts.md)
- [Opencode 复用计划](./design/OpencodeReusePlan.md)

### 工作进度

### 当前进度摘要

- **文档**: 设计原则、功能架构、工作区结构、API/WS 契约、Web 组件映射、TDD 用例完整
- **后端**: Node.js + TypeScript + Hono + ws，完整实现 M1 只读接口 + 实时功能
  - GET /api/tasks/:id/wip - 任务摘要，含修改时间
  - GET /api/tasks/:id/tree - 任务树结构，支持子任务层级
  - GET /api/tasks/:id/events - 事件流，支持跨日期范围和分页，含错误处理
  - GET /api/providers - Provider 配置，安全隐藏密钥
  - POST /api/providers/test - 连通性测试（支持环境变量配置）
  - WebSocket /ws - 实时连接 + 基于文件尾随的事件广播
- **配置系统**: Provider 配置
  - 使用 `apiKeyEnvVar` 替代直接配置 API Key，提升安全性
  - 后端正确处理环境变量读取和连通性测试
- **前端**: React + Vite + TS + react-markdown，完整三栏界面 + 实时更新
  - TaskTreePanel - 树形视图，展开/折叠，任务选择，状态指示
  - ConversationStream - spanId 层级折叠，WebSocket 实时订阅，长文本折叠，实时事件追加
  - WipSummaryPanel - Markdown 渲染，代码高亮，响应式样式
  - SettingsProviders - Provider 配置界面，连通性测试
  - 错误处理 - 友好的降级显示和状态提示
- **实时功能**: WebSocket 事件广播系统（M1 基础实现 → M2 渐进）
  - 当前：已切换为按 taskId 的 WS (/ws/:taskId) + 懒加载 follow（idle/follow）
  - 新增：M2 基础推进与状态查询已实现（run/status）
    - POST /api/tasks/:id/run：进入 run，调用真实 Agent（OpenAI 兼容，优先 openbuddy），产出 agent.run.\*，完成后切回 follow
    - GET /api/tasks/:id/status：返回 { state: idle|follow|run, clients, running }
  - 前端实时接收并显示新事件，连接状态指示（前端已改为 /ws/:taskId）
  - 支持多客户端同时连接，错误时前端重连
- **测试数据**: DEMO 任务及子任务完整示例，包含实时测试事件

### TDD 验证结果

**✅ workspace_init（工作区初始化）**

- [x] .minds/ 与 .tasklogs/ 目录创建
- [x] providers.json 模板生成（不含密钥）
- [x] .gitignore 包含 .tasklogs/ 规则

**✅ task_lifecycle（任务生命周期）**

- [x] 任务目录结构：.minds/tasks/{taskId}/wip.md
- [x] meta.json 初始化：.tasklogs/{taskId}/meta.json
- [x] 事件文件生成：events-YYYYMMDD.jsonl

**✅ conversation_round（会话轮次）**

- [x] 事件按时序写入 JSONL 文件
- [x] spanId/parentSpanId 层级结构
- [x] UI 实时显示和历史回放

**✅ subtask_tree（子任务树）**

- [x] 父子目录结构：.tasklogs/{taskId}/subtasks/{childTaskId}/
- [x] meta.json 父子关联正确
- [x] UI 任务树展开和定位

**✅ error_handling（错误处理）**

- [x] 损坏 JSONL 行的友好处理和警告
- [x] 缺失文件的降级显示
- [x] API 返回详细错误信息（warnings 数组）
- [x] 系统在异常情况下保持稳定

### 下一步

[/] **M2 交互功能开发**（当前重点）

- AI Agent 集成：基础单轮真实调用已接入（OpenAI 兼容，优先 openbuddy）；下一步接入流式输出与中断控制
- 实时 WebSocket 架构提升：
  - 按 taskId 建立专用 WS 连接
  - 进程内 AI agent 协程 pub/sub 节点订阅
  - 跨进程场景降级为 tail follow JSONL
  - 前端 WS 重连机制
- Web 端任务创建和管理界面
- 用户提交 prompt 触发 AI Agent 对话
- Web 端触发工具调用和中断控制

**技术架构重点**：

- **状态机设计**：后端维护 `taskId => pub/sub 节点` 映射，节点有 3 种状态：
  - `idle`：无活动状态
  - `follow`：文件监控状态（fs.watch events-\*.jsonl）
  - `run`：AI agent 协程运行状态
- **状态转换逻辑**：
  - 本进程开始 task 推进 → 启动 agent 协程 → 进入 `run` 状态
  - 非 `run` 状态 + 前端 WS 请求 → 进入 `follow` 状态
  - `follow` 状态 + 前端请求推进 → 切换到 `run` 状态并停止 fs.watch
- **连接管理**：用户关注特定 task → 建立 `/ws/:taskId` 连接 → 订阅对应状态节点
- **资源优化**：按需状态切换，避免不必要的文件监控和协程开销

### 运行方式

- 后端: `npm run dev` (packages/backend, 端口 5175)
- 前端: `npm run dev` (packages/webapp, 端口 5173, 已代理 /api 与 /ws)
- 访问: http://localhost:5173/tasks/DEMO
- 测试:
  - curl http://localhost:5175/api/tasks/DEMO/wip
  - curl -X POST http://localhost:5175/api/tasks/DEMO/run
  - curl http://localhost:5175/api/tasks/DEMO/status
  - curl "http://localhost:5175/api/tasks/DEMO/events?limit=10"
