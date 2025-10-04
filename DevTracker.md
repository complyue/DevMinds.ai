# DevMinds.ai Development Tracker

> **文件更新原则**: 本页仅保留最新状态摘要；详细测试结果集中维护于 tests/\*/results.md（当前：tests/units/results.md；计划：tests/cases/results.md、tests/stories/results.md）。进度用 [ ]/[/]/[x] 标记；“下一步”列待办。

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
  - 错误处理 - 友好的降级显示和状态提示
- **实时功能**: WebSocket 事件广播系统（M1 基础实现 → M2 渐进）
  - 当前：已切换为按 taskId 的 WS (/ws/:taskId) + 懒加载 follow（idle/follow）
  - 新增：M2 基础推进与状态查询已实现（run/status/prompt）
    - POST /api/tasks/:id/run：进入 run，调用真实 Agent（OpenAI 兼容，优先 openbuddy），产出 agent.run.\*，完成后切回 follow
    - POST /api/tasks/:id/prompt：以用户提供的 prompt 触发一次运行（覆盖默认 WIP 内容）
    - GET /api/tasks/:id/status：返回 { state: idle|follow|run, clients, running }
    - 新增：流式事件 agent.run.delta（按片推送），最终 agent.run.output 完成
    - 新增：取消接口 POST /api/tasks/:id/cancel，后端通过 AbortController 中断协程，事件 agent.run.cancelled
  - 前端实时接收并显示新事件，连接状态指示（前端已改为 /ws/:taskId）
  - 支持多客户端同时连接，错误时前端重连
- **测试数据**: DEMO 任务及子任务完整示例，包含实时测试事件

### TDD 验证结果（摘要）

- 全部基础用例通过：workspace_init、task_lifecycle、conversation_round、subtask_tree、error_handling
- 场景测试（Case Tests）：run-prompt-flow（tests/cases/run-prompt-flow.sh）通过；总入口 scripts/run-case-tests.sh 可一键运行全部场景
- 详细说明：tests/units/results.md、tests/cases/results.md；计划：tests/stories/results.md

### 下一步

**注意遵循 TDD 原则，E2E测试设计先行，以端到端测试驱动业务功能开发**

[x] **M2 交互功能开发**（已完成，详见 tests/cases/results.md）

### M3 目标（草案）

- 多任务管理与创建：新建任务、重命名、删除，批量操作与任务切换优化
- 会话持久化与索引：事件归档、全文检索、标签与收藏
- 权限与协作：基础用户/角色模型，任务共享与访问控制（MVP）
- 工具执行增强：真实工具接口对接、参数校验、沙箱与安全审计日志
- Provider 配置 UX（后续版）：YAML 辅助编辑器与连通性诊断面板（沿用手工配置为主）
- 性能与稳定性：大事件列表滚动分页、内存占用优化、WS 压测与退避策略调优
- CI/CD 与质量：将现有 E2E 场景纳入 CI、错误监控与告警、结果自动汇总到 tests/\*/results.md

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
  - curl -X POST http://localhost:5175/api/tasks/DEMO/prompt -H "Content-Type: application/json" -d '{"prompt":"..."}'
  - curl http://localhost:5175/api/tasks/DEMO/status
  - curl -X POST http://localhost:5175/api/tasks/DEMO/cancel
  - curl "http://localhost:5175/api/tasks/DEMO/events?limit=10"
- 场景测试:
  - 单场景：bash tests/cases/run-prompt-flow.sh；bash tests/cases/cancel-flow.sh；bash tests/cases/delta-flow.sh；bash tests/cases/ws-reconnect-flow.sh；bash tests/cases/tool-cancel-flow.sh；bash tests/cases/events-pagination-flow.sh
  - 全部场景：bash scripts/run-case-tests.sh
