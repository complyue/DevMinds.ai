# DevMinds.ai 初稿规划（WebUI-first Agentic Development Tool）

## Core Features

- LLM 提供商模板与 OpenAI/Anthropic 兼容

- Primary/Subagent 树与上下级双向问答

- CLI 启动与命令行任务执行

- WebUI-first 工作区浏览与控制（对 opencode.ai TUI 的 H5 复刻）

- Mindset 文件驱动上下文与轮次总结写回

- 单进程单工作区的多任务并发与文件锁

- 结构化日志与事件流（WS/SSE）

- 任务对话原始消息存于 .tasklogs/（建议 gitignore），.minds/ 建议纳入版本控制

## Tech Stack

{
  "Web": {
    "arch": "react",
    "component": null
  },
  "iOS": null,
  "Android": null
}

## Design

WebUI 为 opencode.ai TUI 的 H5 复刻：以任务树为核心视图，节点为任务；右侧为对话过程流，内嵌 markdown/code/diff 渲染；.tasklogs/ 存放原始消息（建议 gitignore），.minds/ 版本追踪；深色科技风但以功能可读性优先。

## Plan

Note: 

- [ ] is holding
- [/] is doing
- [X] is done

---

[ ] 在 design/cases/ 目录下编写关键场景操作步骤设计（用于 TDD）

[ ] 实现“工作区总览”页面：展示工作区路径、活跃任务面板与实时事件流订阅

[ ] 实现“任务控制台”：创建/选择任务，展示与编辑 wip.md 摘要与轮次记录，支持用户提问与回复

[ ] 实现“Agent 树与问答视图”：可视化 Primary/Subagent 结构，展示上下级与用户双向问答记录

[ ] 实现“技能心智管理”：浏览与编辑 skills 的 def/lessons/knowledge/caveats，并关联任务上下文

[ ] 实现“LLM Provider 设置”：选择模板、配置 baseUrl/apiKey，并提供一键连通性测试

[ ] 实现“CLI 任务执行与 WebUI 启动”：支持指定工作区、端口、token，命令行任务与日志输出

[ ] 实现“并发与持久化保障”：多任务并发队列、文件锁与原子写，错误恢复与重试
