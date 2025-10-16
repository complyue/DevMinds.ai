# DevMinds.ai Web 组件与路由映射（agent-ui → DevMinds Web）

目标

- 参考 ../agent-ui 的组件与布局进行适配，不引入 OpenAPI；先实现“可视化事实”的只读模式，通信沿用最小化 HTTP + WS。

路由

- /start：开始页（最近任务、快速入口、新建任务）
- /tasks/:taskId：会话工作台（左：任务树；中：事件流；右：WIP 摘要）

核心组件

1. TaskTreePanel（左侧）

- 职责：展示父/子任务树，支持懒加载与定位
- 依赖：GET /api/tasks/:id/tree
- 交互：点击节点 → 切换中央事件流与右侧摘要
- 状态：expandedNodes, selectedTaskId

2. ConversationStream（中央）

- 职责：渲染事件流（Markdown/代码/diff），支持按 spanId/parentSpanId 折叠
- 数据源：
  - 初始：GET /api/tasks/:id/events?date=...
  - 实时：WS /ws/:taskId 订阅
- 交互：
  - 展开/折叠工具调用
  - 跳转到原始 JSON（调试视图）
- 错误处理：坏行提示但不崩溃（来自 REST warnings）

3. WipSummaryPanel（右侧）

- 职责：渲染 .minds/tasks/{taskId}/wip.md 的当前摘要（只读）
- 数据源：GET /api/tasks/:id/wip
- 降级：缺失时显示“摘要缺失，去查看原始事件”

4. Toolbar

- 职责：常用操作入口（新建子任务/停止/刷新）
- 行为（阶段）：
  - M1：刷新（重新拉取 /events 与 /wip）
  - M2：停止（POST /api/tasks/:id/stop）、新建子任务（POST /api/tasks）
- 状态：loading, error toast

呈现规范与渲染细节

- Markdown：支持代码高亮与差异渲染（diff）
- Mermaid/Math：可延后，先保留原文/回退
- Span 折叠：依据 spanId/parentSpanId 做树形 UI
- 时序：事件按 ts 排序；跨天用户需选择日期/范围

页面装配

/tasks/:taskId

- 左侧 20-25%：TaskTreePanel
- 中央自适应：ConversationStream（顶部显示任务标题/基本信息）
- 右侧 20-25%：WipSummaryPanel
- 顶部工具条：Toolbar
- 错误区：非阻塞 toast（文件坏行/缺失提示）

状态管理

- 全局：currentTaskId, wsConnected
- 按页面：events, wipContent, tree, filters, expandedSpans
- 加载策略：首次进入加载 wip 与 events，当天落地；切换任务时清空并重载

与 TUI 的映射（参考，不含路径）

- components/chat/messages → ConversationStream
- components/status/status → Toolbar/状态区
- components/textarea → 后续的输入区（M2+）
- internal/app 与 internal/commands → 路由装配与命令面板的 UX 参考

里程碑落地检查

- M1：只读渲染与回放，覆盖 design/cases 下的所有“读取类”验证点
- M2：停止/新建子任务；中断事件贯通
- M3：工具触发与更丰富的命令面板
