# DevMinds.ai Development Tracker

> **文件更新原则**: 本页仅保留最新状态摘要；详细测试结果集中维护于 tests/\*/results.md（当前：tests/units/results.md；计划：tests/cases/results.md、tests/stories/results.md）。进度用 [ ]/[/]/[x] 标记；“下一步”列待办。

- [ ] is holding
- [/] is doing
- [x] is done

### 项目文档

- [设计原则（第一性）](./design/DesignPrinciples.md)
- [软件功能架构设计](./design/Architecture.md)
- [运行时工作区结构设计](./design/WorkspaceStructure.md)
- [Web 组件与路由映射](./design/AgentUI_Mapping.md)
- [后端 API/WS 契约草案](./design/API_WS_Contracts.md)
- [Opencode 复用计划](./design/OpencodeReusePlan.md)

### 工作进度

### 当前进度摘要

- **文档**: 设计原则、功能架构、工作区结构、API/WS 契约、Web 组件映射、TDD 用例完整
- **后端**: Node.js + TypeScript 原生 http + ws，完整实现 M1 只读接口 + 实时功能（WS 子协议承载 Bearer）
  - GET /api/tasks/:id/wip - 任务摘要，含修改时间
  - GET /api/tasks/:id/tree - 任务树结构，支持子任务层级
  - GET /api/tasks/:id/events - 事件流，支持跨日期范围和分页，含错误处理
  - GET /api/providers - Provider 配置，安全隐藏密钥
  - POST /api/providers/test - 连通性测试（支持环境变量配置）
  - WebSocket /ws/:taskId - append-only 传输（仅追加事件节点）+ 基于文件尾随的事件广播
  - M3 任务生命周期 API：POST /api/tasks（创建模板与事件）、PATCH /api/tasks/:id（重命名事件）、DELETE /api/tasks/:id（移除模板、保留日志目录）
- **配置系统**: Provider 配置
  - 使用 `apiKeyEnvVar` 替代直接配置 API Key，提升安全性
  - 后端正确处理环境变量读取和连通性测试
- **前端**: React + Vite + TS + react-markdown，完整三栏界面 + 实时更新
  待详细设计
- **实时功能**: WebSocket 事件广播系统（M1 基础实现 → M2 渐进）
  - 当前：已切换为按 taskId 的 WS (/ws/:taskId，append-only) + 懒加载 follow（idle/follow）
  - 新增：M2 基础推进与状态查询已实现（run/status/prompt）
    - POST /api/tasks/:id/run：进入 run，调用真实 Agent（OpenAI 兼容，优先 openbuddy），产出 agent.run.\*，完成后切回 follow；支持 awaitAsk=1 触发 ask-await 闭环
    - POST /api/tasks/:id/prompt：以用户提供的 prompt 触发一次运行（覆盖默认 WIP 内容）
    - GET /api/tasks/:id/status：返回 { state: idle|follow|run, clients, running }
    - 新增：流式事件 agent.run.delta（按片推送），最终 agent.run.output 完成
    - 新增：取消接口 POST /api/tasks/:id/cancel，后端通过 AbortController 中断协程，事件 agent.run.cancelled
  - 前端实时接收并显示新事件，连接状态指示（前端已改为 /ws/:taskId）
  - 支持多客户端同时连接，错误时前端重连

### TDD 验证结果（摘要）

待开发验证

### 下一步

执行项列表（本周）：

- [/] 优先：调研 agent-ui 实现细节，制定其 AI Chat 组件在 DevMinds 的复现方案（不引入 OpenAPI，尽量零重依赖）
  - 输出物：
    - 组件结构与依赖梳理（Next/shadcn/Radix/Tailwind/framer-motion 的使用点）
    - DevMinds 适配方案（本地 UI 适配层、样式迁移策略、动画降级/子协议适配）
    - 事件→消息映射规范（span 折叠、代码块、diff、tool 请求/结果渲染）
    - 里程碑与风险（M1 只读、M2 交互、M3 动画/增强）
  - 验收：design/AgentUI_Chat_Plan.md 文档；packages/webapp 提交最小 PoC（ChatBlankState 与消息列表静态渲染）

- [/] 后端 M3 模板初始化与落盘规范
  - .minds/tasks/{taskId}/(wip|plan|caveats).md 原子初始化（tmp+rename），校验 repoRoot 包含路径
  - .tasklogs/{taskId}/ 事件文件规范：按日期写入 events-YYYYMMDD.jsonl，顺序与 Schema 保持一致
  - API：POST /api/tasks（创建模板与事件）、PATCH /api/tasks/:id（重命名事件）、DELETE /api/tasks/:id（移除模板、保留日志目录）
- [/] 会话持久化与索引
  - 已实现：.tasklogs/{taskId}/meta.json 增量写入 lastTs 与各事件类型 counts（原子写 tmp+rename）
  - 基于文件扫描的轻量索引缓存（recent events / spans），新增 .tasklogs/{taskId}/meta.json 增量写入 tag/收藏
  - GET /api/tasks/:id/events 增强：分页与范围在现有基础上补充 tag/收藏过滤（最小）
- [/] 协作与问答（ask）最小闭环
  - 后端：WS 追加事件已落地（agent.ask.request/agent.ask.response），事件持久化与 meta 增量已验证（ask-flow 通过）；AskAwaitRegistry 已挂接 append 后解释；run 协程已接入 waitForAnswer，通过 awaitAsk 开关触发（/api/tasks/:id/run?awaitAsk=1，超时 15s）
  - 前端：问题卡片展示与回答输入（最小 AskPanel 已携带 questionId 并自动回填）；TaskPage 已加入 Ask-await 开关，运行时可选择 awaitAsk 流程
  - 设计遵循 design/AskTool.md Prompt 模板
- [/] 内部工具框架（ToolRegistry）与受限工具
  - ToolRegistry：name/description/parameters/execute/metadata；与 run 协程集成
  - 最小骨架已落地：packages/backend/src/tools/registry.ts（注册/调用/列出，独立安全上下文）
  - 路由接入：后端 /api/tasks/:id/tool/echo 已通过 ToolRegistry 注册与调用；run 协程集成待做
  - workspace.fs：最小受限实现已落地（packages/backend/src/tools/workspaceFs.ts），仅允许 cwd 下 .minds/.tasklogs；原子写 tmp+rename
  - workspace.shell：最小受限实现已落地（packages/backend/src/tools/workspaceShell.ts），允许 echo/ls/cat/pwd；拒绝 rm 等破坏性命令、绝对路径越权；超时与输出截断
- [ ] 测试设计与覆盖
  待细化

指派与约定：

- mock 使用 DEVMINDS_MOCK_DIR 指向 tests/workspaces/mock-io，禁止外网与真实密钥

**注意遵循 TDD 原则，E2E测试设计先行，以端到端测试驱动业务功能开发**

[x] **M2 交互功能开发**（已完成，详见 tests/cases/results.md）
[/] **M3 任务生命周期与模板初始化**（进行中：后端 API 已实现，模板/事件落盘与测试通过；索引与协作待做）

### M3 目标（草案）

待细化

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

待细化
