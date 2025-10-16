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
  - TaskTreePanel - 树形视图，展开/折叠，任务选择，状态指示
  - ConversationStream - spanId 层级折叠，WebSocket 实时订阅，长文本折叠，实时事件追加
  - WipSummaryPanel - Markdown 渲染，代码高亮，响应式样式
  - 错误处理 - 友好的降级显示和状态提示
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
- **测试数据**: DEMO 任务及子任务完整示例，包含实时测试事件；测试统一使用 mock 模型 test-model；新增启动/停止后端辅助脚本（tests/cases/\_helpers/start-backend-in-ws.sh、stop-backend.sh，含端口清理）

### TDD 验证结果（摘要）

- 新增：ask-flow（tests/cases/ask-flow.sh）通过，基于 WS 的 ask 事件（request/response）落盘与 meta 增量校验有效
- 新增：ask-await-flow（tests/cases/ask-await-flow.sh）通过；后端 AskAwaitRegistry await 闭环验证完成（agent.ask.request/response → agent.run.output）
- 新增：前端 Ask-await UI 与 awaitAsk 开关接入；E2E 用例 tests/e2e/ask_await_ui.spec.ts 通过（WS 回答“OK by human”后出现 agent.run.output）

- 全部基础用例通过：workspace_init、task_lifecycle、conversation_round、subtask_tree、error_handling
- 场景测试（Case Tests）：run-prompt-flow（tests/cases/run-prompt-flow.sh）、task_lifecycle（tests/cases/task_lifecycle.sh）通过；总入口 scripts/run-case-tests.sh 可一键运行全部场景
- 新增修复：端口清理与进程管理已增强，cancel-flow、delta-flow、ws-reconnect-flow 稳定通过（EADDRINUSE 竞态已消除）
- 新增：events-index-flow（tests/cases/events-index-flow.sh）通过；.tasklogs/{taskId}/meta.json 增量索引（lastTs/counts）已启用
- 新增：tool-echo-flow（tests/cases/tool-echo-flow.sh）通过；agent.tool.echo 事件持久化与 meta.json counts 增量更新（已接入 ToolRegistry）
- 单元测试：meta-index-unit（tests/units/meta-index-unit.sh）通过；验证 meta.json 原子增量与 lastTs 单调更新
- 单元测试：workspace-fs-unit（tests/units/workspace-fs-unit.sh）通过；验证仅允许 .minds/.tasklogs 读写、拒绝越权路径
- 单元测试：workspace-shell-unit（tests/units/workspace-shell-unit.sh）通过；验证仅允许 echo/ls/cat/pwd 等安全命令；拒绝 rm 与绝对路径越权；含超时与输出截断
- 单元测试：ask-unit（tests/units/ask-unit.sh）通过；验证 agent.ask.request/agent.ask.response 事件持久化与 meta.json 增量更新
- 单元测试：tool-registry-unit（tests/units/tool-registry-unit.sh）通过；验证最小 ToolRegistry 注册与执行（echo）
- 单元测试：ask-unit（tests/units/ask-unit.sh）通过；验证 agent.ask.request/agent.ask.response 事件持久化与 meta.json 增量更新
- 回归：scripts/run-case-tests.sh 全量场景再次通过（run/cancel/delta/ws-reconnect/tool-cancel）
- 用例强化：task_lifecycle（tests/cases/task_lifecycle.sh）已补充 created/renamed/deleted 事件断言并通过
- 详细说明：tests/units/results.md、tests/cases/results.md；计划：tests/stories/results.md

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
  - units（cwd=tests/units/works/unit-ws）：模板文件存在性、原子写、索引缓存与 meta.json 增量、shell 限制
  - cases：扩展 tests/cases/task_lifecycle.sh 覆盖新建/重命名/删除与事件落盘；新增 ask 闭环与工具事件映射场景
  - CI 脚本：scripts/run-case-tests.sh 扩充纳入新增场景
- [ ] 前端最小 UI 增强
  - 左栏任务树的创建/删除与选择切换体验优化
  - ConversationStream 中按 tag/收藏筛选（最小）
  - WipSummaryPanel 支持 plan/caveats Markdown 切换

指派与约定：

- 开发遵循“测试工作区隔离”，不写入 packages/\*/.minds 与仓库根 .minds；仅使用 tests 工作区 .minds
- mock 使用 DEVMINDS_MOCK_DIR 指向 tests/units/works/mock-io，禁止外网与真实密钥

**注意遵循 TDD 原则，E2E测试设计先行，以端到端测试驱动业务功能开发**

[x] **M2 交互功能开发**（已完成，详见 tests/cases/results.md）
[/] **M3 任务生命周期与模板初始化**（进行中：后端 API 已实现，模板/事件落盘与测试通过；索引与协作待做）

### M3 目标（草案）

- 多任务管理与创建
  - 特性：新建、重命名、删除、批量操作；左栏任务树的选择/切换体验优化
  - 实现要点：.minds/tasks/{taskId}/(wip|plan|caveats).md 初始化模板；.tasklogs/{taskId}/ 目录与事件文件规范化
  - 测试：cases/task_lifecycle.sh 扩展覆盖新建/删除与事件落盘；units 覆盖文件存在性与模板内容

- 会话持久化与索引
  - 特性：事件归档、分页/范围查询、全文检索、标签/收藏
  - 现状：已支持 GET /api/tasks/:id/events 的分页与日期范围
  - 计划：新增简单索引（基于文件扫描与缓存）、标签元数据文件（.tasklogs/{taskId}/meta.json 增量化），前端检索与筛选 UI（最小）

- 访问与协作（核心）
  - 授权：仅基于访问 token 的授权，无账户/登录与用户/角色模型；能正常访问 Web 即可不受限制地使用所有功能（可见即用）
  - 协作：以问答（ask）为核心的“子 agent → 父 agent”与“向人类”提问/澄清/软授权流程；进度与事件完全事件化
  - 提示词与体验：按 design/AskTool.md 的 Prompt 设计与模板实现，前端以问题卡片+回答输入闭环

- 工具执行增强（基于 opencode 范式的内部 agent 工具）
  - 工具框架：新增 ToolRegistry（name/description/parameters/execute/metadata），与 run 协程集成 LLM tool 调用
  - 基础工具：workspace.fs（安全读写 .minds/.tasklogs，原子写/校验）、workspace.shell（受限命令执行，allowlist+路径越权拒绝、超时与输出截断）
  - 人机/代理间提问（ask）工具（核心特色）：运行中由 agent 触发提问，既支持向人类用户提问，也支持“子任务 agent → 父任务 agent”的提问与回答；落盘 agent.ask.request 事件，前端展示问题并收集回答，后端写入 agent.ask.response 事件后继续计算（不引入权限 ask/deny；遵循“可见即可使用”；设计文档：design/AskTool.md，含 Prompt 设计）（设计文档：design/AskTool.md）
  - 事件映射：tool/ask 开始/进度/结果 → agent.run.delta / agent.run.output / agent.ask.\*（含 metadata 摘要），前端实时展示
  - 安全：严格禁止破坏性/恶意命令；不返回系统内部信息；遵循测试工作区隔离规则
  - 测试：units 在 tests/units/works/unit-ws 下覆盖文件原子写与 shell 限制；cases 扩展端到端展示与问答闭环

- “.minds 配置工具”（包括 provider / skillset / task-team 等配置）
  - 能力：读取与更新 .minds/provider.yaml、.minds/skills/{skill}/def.md、.minds/tasks/{taskId}/team.md（YAML frontmatter 优先）
  - 策略：深度合并内置模板与运行时配置；原子写（tmp+rename）；路径校验（repoRoot contains）；事件审计（更新写入 agent.run.\*）
  - 测试：units 覆盖解析/校验/写入；cases 驱动后端 run 流对 team/def 的解析与回退（mock provider）

- 性能与稳定性
  - 大事件列表滚动分页与增量渲染；WS 重连退避策略调优；内存与文件监控优化（按 task 订阅懒加载）

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
- 测试服务脚本改进：tests/cases/\_helpers/start-backend-in-ws.sh 与 stop-backend.sh 增强端口清理（循环 kill + 校验），scripts/run-case-tests.sh 在每个案例前后统一清理后端，避免端口占用
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
  - 单场景：bash tests/cases/run-prompt-flow.sh；bash tests/cases/cancel-flow.sh；bash tests/cases/delta-flow.sh；bash tests/cases/ws-reconnect-flow.sh；bash tests/cases/tool-cancel-flow.sh；bash tests/cases/events-pagination-flow.sh；bash tests/cases/task_lifecycle.sh
  - 全部场景：bash scripts/run-case-tests.sh
- 辅助脚本：bash tests/cases/\_helpers/start-backend-in-ws.sh；bash tests/cases/\_helpers/stop-backend.sh
