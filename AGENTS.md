# DevMinds.ai Agents 指南（结构与开发注意事项）

本项目采用 Monorepo，后端与前端协同围绕“任务（taskId）”构建实时可观测的 AI Agent 开发体验。本文面向要在本仓内扩展/接入 AI Agent 的开发者，提供结构概览、运行方式与关键约定。

## 1. 仓库结构

- packages/backend
  - 技术栈：Node.js + TypeScript + Hono（HTTP）+ ws（WebSocket）
  - 主要文件：
    - src/server.ts：HTTP API、WS 服务、事件文件跟随（follow）、任务级状态管理（idle/follow）
    - src/evt.ts：轻量事件通道与 EventSink（发布/订阅、流式消费）
  - 运行期目录：
    - .minds/：任务 WIP 等工作区数据（例：.minds/tasks/{taskId}/wip.md）
    - .tasklogs/：事件存储（例：.tasklogs/{taskId}/events-YYYYMMDD.jsonl）
- packages/webapp
  - 技术栈：React + Vite + TypeScript
  - 主要页面：
    - src/pages/TaskPage.tsx：三栏布局（任务树 / 事件流 / WIP 摘要），按 taskId 连接 /ws/:taskId
    - src/main.tsx：路由（/tasks/:taskId）

## 2. 运行与调试

优先使用 pnpm 初始化与运行，避免 npm/yarn 与 pnpm 混用。

- 一次性初始化（仓库根目录执行）
  - pnpm install
- 启动服务
  - 后端：pnpm --filter @devminds/backend dev （默认 http://localhost:5175）
  - 前端：pnpm --filter @devminds/webapp dev （默认 http://localhost:5173，端口占用将自动切换）
- 访问
  - http://localhost:5173 或切换端口后在终端输出查看
  - 示例任务页：http://localhost:5173/tasks/DEMO

常见异常与排查

- “vite: command not found” 或依赖未解析：回到仓库根目录执行 pnpm install，再启动前端 dev
- 端口占用：前端会自动换端口；后端可通过 PORT 环境变量调整
- 安装异常或缓存损坏：pnpm store prune 后重试 pnpm install

## 3. 实时与状态机（后端要点）

- WebSocket 按任务划分：/ws/:taskId
  - 连接时解析 req.url 获取 taskId
  - 仅向对应 task 的订阅者广播事件
- 状态管理（最小实现）
  - idle：无订阅者/未跟随
  - follow：有订阅者时按需跟随 .tasklogs/{taskId}/events-\*.jsonl（fs.watch + 增量读取）
  - run：预留给 Agent 协程运行态（M2 后续完善，运行态应停止文件跟随，直接由协程推送）
- 事件模型
  - JSONL 行格式，字段含 ts、taskId、type、payload、spanId、parentSpanId 等
  - API 提供历史读取与分页：GET /api/tasks/:id/events
  - 新增行经由 follow 解析并通过 WS 推送 type=message.appended

## 4. 前端约定

- TaskPage 中间栏（ConversationStream）：
  - 初次加载通过 GET /api/tasks/:id/events 拉取历史
  - 建立 WS /ws/:taskId 订阅实时事件并追加
- 左栏任务树：GET /api/tasks/:id/tree 读取 .tasklogs 层级构建树（不依赖 meta.json）
- 右栏 WIP 摘要：GET /api/tasks/:id/wip 渲染 Markdown
- Vite 代理（vite.config.ts）
  - /api → http://localhost:5175
  - /ws → ws://localhost:5175（支持 WS 透传）

## 5. Provider 配置与连通性

- 内置模板：packages/backend/config/known-providers.yaml
- 运行期覆盖：.minds/provider.yaml（字段将与模板合并）
- 当前版本约定：仅通过 .minds/provider.yaml 手工配置 Provider/Model；必要时可由 Agent 辅助更新。前端不提供任何 Provider/模型相关的设置 UI。
- API
  - GET /api/providers：返回合并后的 provider 配置（密钥通过环境变量引用 apiKeyEnvVar）
  - POST /api/providers/test：基于环境变量测试连通性（当前为安全占位实现）

## 6. 如何集成/扩展 AI Agent（建议路径）

- 入口与契约（建议）
  - 新增 POST /api/tasks/:id/prompt 接口以触发一次对话/推进
  - 后端创建 taskId 对应的“运行态”节点（run），启动 Agent 协程
  - 协程通过 EventSink（见 src/evt.ts）发布事件，后端转发给 /ws/:taskId
- 状态切换
  - 有用户订阅但未运行 → follow
  - 用户触发推进 → 切换为 run，停止 follow 的 fs.watch，改由协程产出事件
  - 运行结束 → EndOfStream，必要时回到 idle
- 事件写入与可观测性
  - 按需持续写入 .tasklogs/{taskId}/events-YYYYMMDD.jsonl，便于历史回放与容错
  - 事件 schema 保持与当前 GET /api/tasks/:id/events 一致

## 7. 代码与安全规范

- 不写入明文 API Key：通过环境变量（provider.apiKeyEnvVar）读取
- 统一日志与错误返回：API 返回 warnings 数组用于非致命解析/数据异常
- 保持模块内聚，遵循现有风格与工具链（TypeScript 严格模式、ESM）

## 8. 快速清单（你要做什么）

- 拉起环境：pnpm install → 分别 dev
- 打开 DEMO：/tasks/DEMO，确认三栏与实时流正常
- 接入 Agent：
  - 后端加 POST /api/tasks/:id/prompt
  - 引入协程（run）使用 EventSink 推送事件
  - 按任务维度广播至 /ws/:taskId
  - 必要时补充 .tasklogs 写入以便回放

如需我按以上建议落地 prompt 接口与 run 流程，请在 DevTracker 中将条目标注为进行中（[/]）并指派我实现。

## 9. 测试运行与设计原则

- 运行方法
  - 单元测试：bash scripts/run-unit-tests.sh
    - 后端以 tests/units/works/unit-ws 为工作区根（cwd）启动
    - mock 输出位于 tests/units/works/mock-io（由环境变量 DEVMINDS_MOCK_DIR 指向）
  - 后续计划：scripts/run-case-test.sh（场景/案例测试）、scripts/run-story-tests.sh（长流程/故事测试）

- 设计原则
  - 不引入测试模式；使用业务内置的 mock 引擎（apiType=mock）
    - mock 引擎通过 provider.apiKeyEnvVar 指向的目录读取固定输出（例如：DEVMINDS_MOCK_DIR/{taskId}.output），无需外部网络和密钥
  - 显式 provider 选择
    - tasks/{taskId}/team.md 指定成员与其 skill
    - skills/{skill}/def.md 指定 providerId 与可选 model
  - 文件系统隔离
    - 测试工作区固定为 tests/units/works/unit-ws；server 以该目录为 cwd 启动；测试数据与 tests/units/works/mock-io 随仓库版本追踪
  - 异步稳定性
    - 对事件读取采用轮询等待 agent.run.output 出现，避免竞态

- 覆盖目标
  - /api/tasks/:id/tree 不依赖 meta.json，仅返回层级结构
  - run 流程事件 payload 包含 member、skill、providerId、model、content
  - 事件文件 events-YYYYMMDD.jsonl 按时间顺序写入并可通过 WS 广播
