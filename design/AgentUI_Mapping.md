# DevMinds.ai Web 组件与路由映射（Agent UI 适配）

目标
- 参考 ../agent-ui 的组件与布局，在不引入 OpenAPI 的前提下，基于最小化 HTTP + WS 契约实现只读优先的 Web 界面。
- 严格同源；鉴权采用 localStorage token + WS 子协议（Sec-WebSocket-Protocol）承载 Bearer。

路由
- /start：开始页（最近任务、快速入口、新建任务）
- /tasks/:taskId：工作台（左：任务树；中：事件流；右：WIP 摘要）
- /settings：设置页（管理访问 token，保存在 localStorage）

核心组件

1) TaskTreePanel（左侧）
- 职责：展示父/子任务树，支持懒加载与定位
- 数据：GET /api/tasks/:id/tree
- 交互：点击节点切换当前 task

2) ConversationStream（中间）
- 职责：渲染事件流（Markdown/代码/diff），支持按 spanId/parentSpanId 折叠
- 数据：
  - 初次：GET /api/tasks/:id/events?date=...
  - 实时：WS /ws/:taskId（使用子协议：['devminds','bearer.<token>']）
- 交互：
  - 展开/折叠工具调用与子 span
  - 跳转原始 JSON（调试视图）
- 错误处理：坏行提示但不崩溃（REST warnings）

3) WipSummaryPanel（右侧）
- 职责：渲染 .minds/tasks/{taskId}/wip.md（只读）
- 数据：GET /api/tasks/:id/wip
- 降级：缺失时提示查看原始事件

4) Toolbar
- 职责：常用操作入口（刷新、后续的停止/新建子任务）
- 阶段：
  - M1：刷新（重新拉取 /events 与 /wip）
  - M2：停止（POST /api/tasks/:id/stop）、新建子任务（POST /api/tasks）

呈现规范
- Markdown：支持代码高亮与 diff 渲染
- Span 折叠：依据 spanId/parentSpanId 展现层级
- 时序：按 ts 排序；跨天需选择日期/范围

页面装配（/tasks/:taskId）
- 左侧 20-25%：TaskTreePanel
- 中间自适应：ConversationStream（顶部显示任务标题/基本信息）
- 右侧 20-25%：WipSummaryPanel
- 顶部工具条：Toolbar
- 错误区：非阻塞 toast

状态管理
- 全局：currentTaskId, wsConnected, token
- 页面：events, wipContent, tree, filters, expandedSpans
- 加载策略：首次进入加载 wip 与当天 events；切换任务清空并重载

实现约束（与 agent-ui 的差异）
- 不使用 Next.js/shadcn-ui/Radix/framer-motion；如需复用交互/样式，采用本地 UI 适配层与 CSS Modules 或可选 Tailwind（仅在必要时引入）。
- 严格同源；HTTP 使用 Authorization: Bearer <token>；WS 使用 Sec-WebSocket-Protocol（不提供 ?token 降级）。
- 不引入 OpenAPI；沿用现有最小 REST + WS 契约。

里程碑
- M1：只读渲染与回放（覆盖 design/cases 下“读取类”验证点）
- M2：停止/新建子任务；中断事件贯通
- M3：工具触发与命令面板增强（视需求适配动画）
