# 人机/代理间“问答（ask）工具”设计

目标

- 在运行中支持 agent 向人类用户或其他代理（子任务→父任务）发起提问，并在获得回答后继续计算。
- 初期遵循“可见即可不受限制地使用”，不引入权限 ask/deny 机制。
- 事件化与可观测：在 .tasklogs 中记录完整问答闭环，前端实时展示与响应。

1. 工具接口（后端，内部 agent 工具）

- 名称：ask.request / ask.response
- ask.request 参数：
  - from: { agent: string; taskId: string }
  - to: { type: 'user' | 'agent'; agent?: string; taskId?: string } // user 为人类，agent 为父/子任务代理
  - question: string
  - context?: { refs?: string[]; hint?: string } // 可附带相关文件/链接标识与简短提示
  - timeoutMs?: number // 默认 120000
- ask.response 参数：
  - to: { agent: string; taskId: string } // 回应目标（原请求方）
  - answer: string
  - inReplyTo: string // 对应 request 的 eventId/callId
  - metadata?: { choices?: string[]; confidence?: number }
- 返回：
  - ok: boolean
  - eventId: string
  - warnings?: string[]

2. 事件模型（.tasklogs 与 WS）

- agent.ask.request
  - fields: { from, to, question, context, timeoutMs, callId, time.start }
  - 前端行为：ConversationStream 展示问题卡片（可选择目标 user/父 agent 的输入面板），支持提交回答。
- agent.ask.response
  - fields: { to, answer, inReplyTo, time.end, metadata }
  - 后端行为：把回答注入当前会话上下文（Message/Part），并唤醒等待中的协程继续执行。
- 超时与取消：
  - 超时：生成 agent.ask.timeout 事件并结束等待；协程可选择重试或降级。
  - 取消：生成 agent.ask.cancelled 事件；由用户或系统触发。

3. 对话编排与上下文（参考 AgentToolsMigration）

- LLM 工具呈现：把 ask.request 暴露为工具（name/description/parameters/execute），由模型在需要时调用。
- resolveTools：注册为 active tool，与 workspace.fs / workspace.shell 一致；执行时写 tool-input → tool-call → agent.ask.request 事件。
- 回答注入：
  - 对 user：前端提交后 POST /api/tasks/:id/ask/answer（或沿用 prompt 输入通道），后端生成 agent.ask.response → 将 answer 作为新的 Message.Part（text）注入，再继续 stream。
  - 对 agent（父/子）：后端直接写入父/子任务的会话消息队列，生成对应 response 事件，形成跨任务的问答链路。

4. 前端最小实现

- 展示请求：在 ConversationStream 中识别 agent.ask.request 事件，渲染问题卡片与输入框。
- 提交回答：调用后端回答接口，附带 inReplyTo 与 answer；成功后滚动到新的 response 事件。
- 代理间回答：对于 to=agent 的 request，在父任务页面提示“来自子任务的提问”，并提供回答入口，提交后将响应路由到子任务上下文。

5. 与 .minds/.tasklogs 的协同（参考 MindsConfigTool）

- 路径与工作区约束：事件写入 .tasklogs/{taskId}/events-YYYYMMDD.jsonl；严格 contains(repoRoot, target) 校验；不触及仓库外路径。
- 原子性与队列：事件追加采用文件尾随写入；会话内对 ask 的等待通过协程锁（AbortSignal）与任务维度队列保障顺序。
- 测试工作区隔离：所有测试以 tests/units/works/unit-ws 为 cwd；仅读写该工作区的 .tasklogs。

6. 行为与边界

- 无权限 ask/deny：初期不进行授权与操作限制；只要工具可见则可使用。
- 重试策略：模型或后端可在超时后自动重试一次；超出后需用户主动触发。
- 输入校验：question 长度限制（<= 4KB）、禁止注入二进制；answer 长度限制（<= 16KB），前端超长提示折叠。
- 多路并发：同一任务内可有多个并发 ask；以 callId 进行配对；UI 需就近显示与折叠。

7. 接口与伪代码

- 后端注册：
  - ToolRegistry.register('ask', { description, parameters, execute })
  - execute(args, ctx): 写 agent.ask.request 事件，阻塞等待 response 或超时；返回 output=“问答已提交，等待回答…”
- 回答处理：
  - POST /api/tasks/:id/ask/answer { inReplyTo, answer } → 写 agent.ask.response → 继续计算
- 协程等待：
  - processor 等待事件（响应 inReplyTo 的 response），或超时；收到后把 answer 作为 text 部分注入并继续 streamText。

8. 安全与合规

- 不写入/暴露明文密钥；question/answer 脱敏（如必要）。
- 不跨越工作区路径；仅事件写入。
- 不引入破坏性操作；不自动执行命令。

9. 测试计划（M3）

- units：问答事件写入与读取；超时/取消；并发 ask 配对；跨任务（子→父）问答链路。
- cases：端到端：agent 发起 ask → 前端回答 → 协程继续 → 结果生成；跨任务问答闭环展示。

10. 业务地位与协作模式（核心特色）

- 核心定位：DevMinds.ai 的 ask 工具是协作引擎的中枢，承担解惑澄清与“软授权”职责，贯穿父/子任务与人类的协作闭环。
- 使用策略：产品不设用户账户与登录，仅基于访问 token 授权；能够访问 Web 即可不受限制地使用所有功能（可见即用）。
- 协作形态：
  - 子 agent → 父 agent：用于任务上下文澄清、需求确认、任务拆解核对与策略选择。
  - agent → 人类：用于需求澄清、决策偏好、风险同意（软授权）与领域知识补充。
- 记录与回放：所有问答事件化，支持审阅、检索与复盘，帮助形成可追溯的协作决策链。

11. Prompt 设计原则与模板

- 设计原则：
  - 明确角色与目标：from/to、任务上下文、期望回答格式（简短/枚举/自由文本）。
  - 限定信息范围：提供 refs/hint，避免开放式泛问；引导可操作答案。
  - 软授权语气：礼貌、事实陈述、风险提示与选项化同意。
- 模板示例：
  - 子→父任务澄清模板：
    ```
    [Ask:child->parent]
    Task: ${childTaskId} → Parent: ${parentTaskId}
    Context: ${hint}; Refs: ${refs.join(', ')}
    Question: ${question}
    Expected: ${expectedFormat}  // e.g., "Choose one: A/B/C", or "Short justification (<=100 words)"
    ```
  - 向人类用户提问模板：
    ```
    [Ask:agent->user]
    Task: ${taskId} / Agent: ${agentName}
    Context: ${hint}; Refs: ${refs.join(', ')}
    Question: ${question}
    Options (optional): ${choices?.join(', ')}
    Note (soft-authorization): ${riskNoteOrConsentText}
    ```
  - 软授权确认模板：
    ```
    [Ask:soft-authorization]
    Action: ${action}
    Reason/Risk: ${reasonOrRisk}
    Please confirm (Yes/No) or propose alternative.
    ```

12. 软授权协作模式

- 定义：不进行系统级权限校验，仅通过问答与明确同意的文本记录完成“授权”与“协作决策”。
- 机制：agent 通过 ask.request 提示风险/后果，人类或父 agent 用 ask.response 给出同意/否决/替代方案。
- 产出：在事件中标注 consent: yes/no/alt 与 rationale 字段，便于后续审计与复盘。

13. 访问 token 策略与约束

- 授权模型：仅访问 token，无账户/登录与用户/角色；能够访问即具备全部可见功能的使用权。
- 风险控制：通过显式问答（软授权）、事件审计与回放作为主要控制方式，不引入操作限制。

14. 未来拓展

- 多轮问答链：在复杂任务中串联多次 ask，形成可视化决策树。
- 模板库：在 .minds 下维护 ask 模板集合，按场景选择与复用。
- UI 细化：支持选项按钮、结构化回答、快捷同意/否决，并保留自由文本。
