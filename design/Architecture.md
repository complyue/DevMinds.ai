# DevMinds.ai 架构设计（Architecture）

## 1. 产品目标与对标

- 目标：WebUI-first 的 agentic development tool，等价对标 opencode.ai，同时以文件系统驱动的“Mindset”与双向问答能力形成差异化，提高弱模型在局部任务上的性价比。
- 等价功能：
  - LLM Provider：内置主流模板；兼容 OpenAI/Anthropic 风格；支持自定义 baseUrl + apiKey；工作区级配置。
  - Primary / Subagent：分割总任务与子任务上下文边界。
  - 命令行任务：CLI 可与外部流程编排集成。
- 差异化：
  - WebUI 为主：以工作区为中心，从 cwd 或指定目录启动 HTTP Server，通过浏览器使用；env 指定或随机生成 token。
  - Mindset：.minds/skills/_ 与 .minds/tasks/_ 文件化上下文，摒弃“堆叠对话即上下文”，每轮调用更新 wip.md 摘要。
  - 全链路问答：Agent 支持向直属上级提问，也可向用户提问；避免上下文不清导致的无效计算。
  - 原始对话日志与摘要分离：.tasklogs/ 存储全量原始消息（建议 gitignore），.minds/ 存储心智与任务总结（建议纳入版本控制）。
  - 简化工作区：单进程仅服务一个工作区。

## 2. 总体架构与运行模式

- 单进程、单工作区、前后端一体：
  - 后端：Node.js + Fastify 提供 REST/WS/SSE、文件系统读写、LLM 适配、事件总线。
  - 前端：React + Vite（H5 复刻 opencode TUI 的交互与信息结构）。
  - CLI：devminds 命令，启动 WebUI、执行任务、连接 agent 通信。
- 进程边界：
  - 仅一个 workspace 根目录在进程中活跃；多工作区需多实例。
- 安全：
  - TOKEN 基础鉴权（env 指定或随机生成后输出到控制台）；CORS 白名单；最小可用权限。

## 3. Agent 模型与交互

- 角色：
  - PrimaryAgent：总任务的“协调者与监督者”，划分子任务，持续维护任务 wip.md 摘要；可向用户提问。
  - Subagent（多个）：聚焦具体技能域与子任务；可向上提问、可向用户提问。
- 心智与上下文：
  - 输入上下文 = .minds/tasks/{taskId}/(wip.md + caveats.md) + 相关 skill 的 .minds/skills/{skill}/(def.md + knowledge.md + lessons.md)，均为完整包含（不做片段选读）。
  - 每轮 LLM 请求后，Agent 必须总结进展并更新 wip.md，采用覆盖式或追加式，若非特殊必要，不记录此文件内容的历史变更沿袭。
- 问答流：
  - Subagent -> Primary：当信息不足或需决策时发起问询；Primary 回答后继续。
  - Agent -> User：当必须引入业务知识或偏好时，通过 WebUI/CLI 提问（用户可在 UI 中答复）。
  - 事件化：所有问答与重要工具调用以事件流广播，WebUI 订阅。
- 生命周期（单轮）：
  1. 读取 wip.md + 相关 skills 片段 -> 组装 prompt
  2. 工具调用（文件读写、代码编辑、执行命令等）按需发生
  3. 产出结果并写回摘要到 wip.md（必要时新增 lessons；task 级 caveats.md 单独维护）
  4. 生成用户与上级可读的轮次记录（展示用），原始消息写入 .tasklogs/
  5. 用户中断/纠偏：用户可在 WebUI/CLI 发出“中断当前轮次/停止”的指令；Agent 在合适的检查点（工具调用/LLM 流式响应）检测 WS 中断信号并尽快停止，允许用户调整 wip.md 或追加说明后继续

## 4. Mindset 与文件布局（摘要）

- 详情见 WorkspaceStructure.md。关键点：
  - .minds/skills/{skill}/(def|knowledge|lessons).md
  - .minds/tasks/{taskId}/(plan|wip|caveats).md
  - .tasklogs/{taskId}/events-YYYYMMDD.jsonl（原始消息与事件）
  - 项目资产：工作区中其余文件与子目录（最终代码/文档/资源等，对应交付物与用户资产）
- 读写规则：
  - 以文件为真相源；采用文件锁/队列，原子写；为并发子任务提供安全。
  - .minds 建议纳入版本控制；.tasklogs 建议 .gitignore。

## 5. LLM Provider 抽象

- 兼容协议：OpenAI/Anthropic 风格（/chat/completions、/messages 等），支持自定义 baseUrl 和 APIKEY 的环境变量名。
- 敏感信息：APIKEY 等敏感信息一律来源于环境变量，变量名由内置模板或自定义配置指定
- 配置来源：
  - .minds/provider.yaml（工作区级优先）
  - 软件内置模板
- 模板与覆写：
  - 内置模板（openai, anthropic, azure-openai, together, groq 等）
  - 可自定义 provider 别名、模型清单、默认参数（temperature、max_tokens 等）
- 健康诊断：服务端连通性诊断接口（无前端 UI）

## 6. Web 服务与安全

- Fastify 路由：
  - /api/workspace, /api/tasks, /api/agent, /api/events (WS/SSE)
  - 注：provider/skillset/task-team 配置不暴露 HTTP 或 CLI；M3 通过内部 Agent 工具在 .minds/ 下读写
- 鉴权：
  - CLI：Bearer Token（启动生成或从 env 读取）
  - Web 浏览器：基于会话的 Cookie 鉴权（未鉴权重定向到登录/鉴权页面；WS/SSE 连接继承会话 Cookie）
  - 便捷直达：服务启动时在控制台打印带 token 的直达链接（例如 http://localhost:5173/?token=<TOKEN>）；首次点击将完成一次性鉴权并写入 session，后续访问依赖 session cookie
  - 请求级中间件校验；事件流通道也需校验
- 事件流：
  - WS 为默认（实时双向、状态更丰富），SSE 作为降级选项（在极少数代理/受限环境下使用），暂不编码，实现留待未来扩展
  - 中断机制：通过 WS 分发“中断/停止”信号与状态更新；Agent 必须在流式响应与工具调用之间的检查点响应中断
- 静态资源：Vite 构建产物；单仓同服务

## 7. 并发与可靠性

- 多任务并发：任务级队列；子任务串行或小并发窗口
- 文件安全：基于 fs-ext/flock 或进程级互斥队列；写入采用临时文件 + 原子 rename
- 崩溃与异常：不提供自动恢复；UI 尽量加载可用内容，异常时提示用户查看工作区内相关文件（.tasklogs、.minds 等）
- 写入策略：保持简单可靠的原子写与顺序写；不实现额外的幂等或重放机制

## 8. 观测与事件

- 控制台日志：输出到控制台（含 debug 级别），不做进程结构化日志
- 事件总线：进程内发布订阅；事件持久化遵循多级子任务路径：
  - 顶层任务：.tasklogs/{taskId}/events-YYYYMMDD.jsonl（及 meta.json）
  - 子任务：.tasklogs/{taskId}/subtasks/{childTaskId}/subtasks/{grandChildTaskId}/.../events-YYYYMMDD.jsonl
- WebUI 实时：订阅任务树与对话流更新

## 9. CLI 运行模式

- 子命令与参数：
  - devminds [serve] --workspace [path?] --port [p?] --token [t?] [--open]
    - serve 为默认子命令；--workspace 缺省为当前工作目录（cwd）
    - --token 可选：若未指定则从 env 读取；env 也未提供则启动时生成随机值
    - 总是印直达链接，如果指定了 --open，自动打开浏览器
  - devminds run --skill [name] --text "..." --task [id?]
    - run 为一次性非交互执行；--text 为必填输入，--task 可选（未指定则新建任务并回显 taskId）
    - 不支持 --model；模型由所选 skill 的配置决定
  - devminds ask --task [id] --to [agentId|primary]
    - ask 进入 TUI 交互模式，仅用于问答澄清与状态查看，不允许修改任何文件内容；不接受 --text 参数
- 行为：
  - 打印访问 URL 与 token（含带 token 的直达链接）；通过 WS 订阅日志/事件；退出码反映任务成功与否

## 10. 演进与权衡

- WebUI-first：便于可视化任务树与对话过程（H5 复刻 opencode TUI）
- 文件系统为真相源：简化部署、贴近代码工作区、易于审计与回放
- 局部上下文 + 主动提问：降低上下文污染，尤其适配能力中等模型

## 11. 事件流唯一驱动原则（WS 控制信道）

- 原则：所有交互驱动均以“事件”为唯一事实源；不通过专用 HTTP 路由触发 ask/answer 或 tool 调用。
- 通道：WebSocket /ws/:taskId
  - 出站：服务端向客户端广播事件追加（type=message.appended，payload=事件对象）
  - 入站：客户端仅可发送“控制消息”（kind=control），服务端校验并转写为事件
- 允许的控制类型（type）：
  - agent.ask.request { payload: { question: string } } → 服务端写入事件并广播
  - agent.ask.response { payload: { answer: string } } → 服务端写入事件并广播
  - agent.tool.request { payload: { name: string, args: object } }
    - 服务端先写入 agent.tool.request，再调用 ToolRegistry.call(name,args)
    - 返回结果写入 agent.tool.result { payload: { name, ok: boolean, result? , error? } } 并广播
- 已删除的 HTTP 路由（不再提供）：/api/tasks/:id/ask, /api/tasks/:id/answer, /api/tasks/:id/tool/echo
- UI 行为：
  - 识别 agent.ask.request 节点并渲染回答 UI（文本框或选项）
  - 用户提交即发送 WS 控制消息 agent.ask.response
  - 工具调用由后端自动执行；UI 仅渲染 agent.tool.request/agent.tool.result 事件
