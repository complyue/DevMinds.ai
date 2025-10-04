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
  - SettingsProviders - Provider 配置界面，连通性测试
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

[/] **M2 交互功能开发**（当前重点）

- AI Agent 集成：基础单轮真实调用已接入（OpenAI 兼容，优先 openbuddy）
- [x] 接入流式输出（server → WS → UI 逐片推送）
- [x] 中断控制（前端 Cancel → 后端终止协程 → 状态回退）
- 实时 WebSocket 架构提升：
  - 按 taskId 建立专用 WS 连接
  - 进程内 AI agent 协程 pub/sub 节点订阅
  - 跨进程场景降级为 tail follow JSONL
  - 前端 WS 重连机制
- Web 端任务创建和管理界面
- [x] 用户提交 prompt 触发 AI Agent 对话
- [x] Web 端触发工具调用与中断控制（完善交互与状态提示）
  - 子任务：
    - UI：在 ConversationStream/WipSummaryPanel 增加 Run/Cancel/Tool 触发控件；运行中禁用 Run、显示取消中状态
    - API：前端接线 POST /api/tasks/:id/run、/prompt、/cancel；统一错误提示
    - 状态提示：显式 idle/run/follow 标签；取消成功/失败 toast
  - 场景测试：
    - tests/cases/cancel-flow.sh：启动 run → 触发 cancel → 验证事件序列包含 agent.run.delta（至少1片）、agent.run.cancelled、状态回退为 follow/idle
  - 验收标准：
    - UI 状态与按钮禁用逻辑正确；取消后 2s 内出现取消提示；WS 流中包含取消事件
- [x] 增加场景测试：cancel-flow（验证 cancel 事件序列）、delta-flow（验证流式片段）
  - 子任务：
    - 设计完整事件断言：顺序、类型、关键字段（taskId、spanId、ts）
    - 覆盖边界：短流（≤3片）、长流（≥50片）、网络抖动重连后事件连续性
  - 脚本（待新增）：
    - tests/cases/delta-flow.sh：触发 run，收集片段，断言片段累计长度与最终 output 一致
  - 运行命令：
    - 单场景：bash tests/cases/run-prompt-flow.sh；bash tests/cases/cancel-flow.sh；bash tests/cases/delta-flow.sh；bash tests/cases/ws-reconnect-flow.sh；bash tests/cases/tool-cancel-flow.sh
    - 全部场景：bash scripts/run-case-tests.sh
  - 验收标准：
    - 三个场景均 0 退出码；results.md 有对应通过记录与关键指标（片段数/耗时）
- [x] 前端提示与可视化：运行进度/取消状态显式化，delta 合并展示优化
  - 子任务：
    - 进度条/计数：基于已收片段数展示粗略进度；最终 output 到达后自动合并并替换占位
    - 取消态：在流区域插入“已取消”标记；保留已收片段，不再继续合并
    - 性能：大文本增量渲染，避免整段重排
  - 验收标准：
    - 长文本（≥100KB 输出）仍保持流畅渲染；合并后无重复片段；取消后不再追加
- [x] WS 重连与退避策略优化（断线提示、自动恢复）
  - 子任务：
    - 指数退避：1000ms → 2000ms → 4000ms（上限 10s）；最大尝试次数后提示“请手动重试”
    - 可视化：连接状态指示灯（green/amber/red），断线时顶栏提示
    - 会话连续性：重连后从最后 offset 继续拉取 events（降级到 HTTP 拉取补齐）
  - 验收标准：
    - 本地断网 10s、后端重启均可在 30s 内恢复并补齐缺片段；无重复/乱序

- [ ] 事件分页与日期范围在前端加入 UI 支持
  - 子任务：
    - 控件：limit、dateFrom/dateTo 输入；对接 GET /api/tasks/:id/events
    - 交互：切换分页不丢失当前选择的 task；日期范围与分页可组合
    - 性能：分页滚动加载，避免一次性渲染大量事件
  - 验收标准：
    - 不同分页/日期组合下事件条目与后端响应一致；快速切换无明显卡顿

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
  - 单场景：bash tests/cases/run-prompt-flow.sh；bash tests/cases/cancel-flow.sh；bash tests/cases/delta-flow.sh；bash tests/cases/ws-reconnect-flow.sh
  - 全部场景：bash scripts/run-case-tests.sh
