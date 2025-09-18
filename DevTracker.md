# DevMinds.ai Development Tracker

### 项目文档

- [软件功能架构设计](./design/Architecture.md)
- [运行时工作区结构设计](./design/WorkspaceStructure.md)

### 工作进度

Note: 

- [ ] is holding
- [/] is doing
- [X] is done

---

[ ] 分析 opencode 代码库，确定可迁移的后台功能模块代码，同时分析 opencode TUI 代码的界面设计，转换成 DevMinds.ai 的 Web UI 设计
  - 鉴权：WS 继承会话 Cookie 或使用启动 token 校验；请求级中间件校验
  - 事件流：中断/状态更新均通过 WS 分发；UI 仅订阅 WS
  - 迁移映射（精要）：
    - 任务与子任务树 → 左侧任务导航；元数据来源 .minds/tasks/{taskId}/wip.md 为主， .tasklogs/{taskId}/meta.json 为辅
    - 对话与事件流 → 会话工作台主视图；WS 实时订阅；后台 task agent 被 WS 请求触发启动，用户提交 prompt 时触发 LLM 轮次，一个轮次期间可能有多次 tool call 以及 ai agent 之间的问答，WS 实推送同时记录原始 JSONL；用户 UI 交互请求查看原始对话时回放原始 JSONL
    - 工具/命令状态 → 基于事件的 spanId/parentSpanId 折叠展示
    - Provider/模型设置 → 设置页读取 .minds/config/providers.json（不存储密钥）
  - 页面/路由（草案）：
    - /start 开始页：最近任务、快速入口、新建任务
    - /tasks/:taskId 会话工作台：左侧任务树 / 中央事件流 / 右侧 wip 摘要
    - /settings/providers：Provider 配置与连通性测试
  - 组件蓝图：
    - TaskTreePanel、ConversationStream（Markdown(Mermaid,Math)/code/diff 渲染）、WipSummaryPanel、Toolbar（新建子任务/停止/刷新）、ProviderConfigForm
  - 后端接口（基线）：
    - REST：GET /api/tasks/:id/wip, GET /api/tasks/:id/tree, POST /api/tasks/:id/stop
    - WS：/ws 统一通道；事件类型 task.updated, message.appended, tool.started/ended, interrupt
  - 数据契约（简要）：
    - Event { ts, taskId, agentId, type, payload, spanId?, parentSpanId? }
    - TaskTreeNode { id, children[], hasMore?, meta }
    - Wip: markdown string
  - 策略：先“可视化事实”，UI 只读展示；后续再开放 Web 侧触发工具调用
[X] 在 design/cases/ 目录下编写关键场景操作步骤设计（用于 TDD）
  - 预期验证点（workspace_init.md）：
    - 若 .minds/ 与 .tasklogs/ 不存在，首次运行应创建
    - 若 .minds/config/providers.json 缺失，生成模板（不含密钥）
    - 提示 .gitignore 包含 .tasklogs/ 与 .tasklogs/**/*.jsonl 规则
  - 预期验证点（task_lifecycle.md）：
    - 新建任务时生成 .minds/tasks/{taskId}/(wip.md, plan.md, caveats.md)
    - 初始化 .tasklogs/{taskId}/meta.json
    - 一轮完成后 wip.md 更新（覆盖或追加），事件文件存在
  - 预期验证点（conversation_round.md）：
    - 对话按时序写入 .tasklogs/{taskId}/events-YYYYMMDD.jsonl
    - UI 默认显示 wip.md 摘要，并可跳转定位原始事件
    - 支持中断信号，能在流式/工具调用检查点停止
  - 预期验证点（subtask_tree.md）：
    - 生成 .tasklogs/{taskId}/subtasks/{childTaskId}/… 结构
    - 各级 meta.json 存在且父子关联正确
    - UI 左侧任务树可展开并定位子任务轮次
  - 预期验证点（error_handling.md）：
    - 异常时 UI 仍可加载可用内容并提示检查关联文件
    - 事件文件损坏给出友好提示，不崩溃
    - 不实现自动恢复，但允许继续操作与溯源
