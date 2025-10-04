# Agent 工具呈现与调用（参考 opencode 范式）与 DevMinds.ai 迁移方案

## 1. 工具呈现与调用的通用范式（LLM Tool Calling）

- 工具呈现：以 name、description 与 JSON Schema（parameters）描述，随同对话上下文提供给模型（如 OpenAI tools/function-calling，或兼容实现）。
- 调用流程：
  1. 模型在回复中产生 tool_call（包含工具名与参数 JSON）。
  2. 后端执行对应工具（受安全与资源限制），将结果以 role=tool 的消息/事件回传。
  3. 模型继续下一轮，综合工具结果生成最终输出或继续调用其它工具。
- 事件化与可观测性：每次工具调用与结果写入事件流（JSONL），前端通过 /ws/:taskId 实时订阅追加。

## 2. DevMinds.ai 现状可对接点

- 运行态：packages/backend/src/server.ts 的 runRealAgent(taskId, prompt) 已有 provider 调用与 agent.run.\* 事件写入（delta/output/cancelled/error/finished），具备接入“工具调用→事件写入→WS广播”的基础。
- Provider 机制：packages/backend/src/providers/{registry,defaults}.ts 抽象了 API 类型与调用封装，可扩展为“工具注册中心”相同思路。
- 前端：TaskPage.tsx 已支持“工具参数 + 触发按钮”，当前经 POST /api/tasks/:id/prompt 驱动一次 run；后续可拓展为“工具选择与参数编辑”，但本阶段工具由内部 agent 驱动，不暴露公开 HTTP 接口。

## 3. 基础工具迁移目标

- 工作区文件读写工具（workspace.fs）
  - 能力：安全读取/写入 .minds 与任务相关文件（如 .minds/tasks/{id}/wip.md、.minds/skills/{skill}/def.md 等），支持追加/覆盖、原子写、校验。
  - 限制：仅允许在“当前工作区根”下的白名单路径；禁止越权访问；写入采用临时文件 + 原子 rename；并发采用进程内队列或文件锁。
  - 事件：每次操作写入 agent.run.delta/agent.run.output 型事件，payload 包含操作类型、路径与摘要。
- 终端命令执行工具（workspace.shell）
  - 能力：执行经显式允许列表的只读/受限命令（如 ls、cat、git status 等），采集 stdout/stderr/exitCode。
  - 限制：严格 allowlist；资源限额（超时、最大输出大小）；环境变量隔离与清理；禁止网络/写敏感路径；审计日志。
  - 事件：命令开始/结束/错误写入事件，便于回放与审计。

## 4. Agent 内部工具框架（后端）

- 工具注册中心（与 provider 类似）：

  ```ts
  type ToolParams = { taskId: string; name: string; args: any };
  type ToolHandler = (
    params: ToolParams,
    ctx: { repoRoot: string },
  ) => Promise<{ ok: boolean; result?: any; warnings?: any[] }>;

  const tools = new Map<string, ToolHandler>();
  export function registerTool(name: string, handler: ToolHandler) {
    tools.set(name, handler);
  }
  export async function callTool(name: string, params: ToolParams, ctx) {
    const h = tools.get(name);
    if (!h) throw new Error('unknown tool');
    return h(params, ctx);
  }
  ```

- 执行入口：由 runRealAgent 协程在需要时触发工具（源自模型 tool_call，或本地规则），将执行结果写入 .tasklogs/{taskId}/events-YYYYMMDD.jsonl 并经 WS 推送。
- 安全总则：
  - 路径约束：仅允许读取/写入 .minds 与 .tasklogs 下的特定文件；禁止访问仓库外路径。
  - 原子写与队列：写入采用 tmp + rename；并发采用任务维度队列串行化。
  - 审计：每次工具调用追加事件，包含 name、args 摘要（脱敏）、结果摘要、耗时、限制是否触发。

## 5. 具体工具设计

### 5.1 workspace.fs（文件读写）

- 参数：
  - op: 'read' | 'write' | 'append'
  - path: 相对 .minds 或 .tasklogs 的白名单路径（如 ['tasks', taskId, 'wip.md']）
  - content?: string（write/append 必填）
- 行为：
  - 读：返回文本与 meta（mtime, size）
  - 写：原子写、校验（例如 YAML/MD frontmatter 合法性）
- 失败策略：返回 ok=false + warnings；不抛出明文内容导致的异常到日志。
- 事件：
  - agent.run.delta（开始/进度）
  - agent.run.output（完成，含摘要）

### 5.2 workspace.shell（受限命令执行）

- 参数：
  - cmd: string（从 allowlist 中选择）
  - args: string[]（允许子集）
  - cwd?: 默认为工作区根，且仅允许在工作区内
- 限制：
  - allowlist 示例：['ls', 'cat', 'git', 'node -v', 'pnpm -v']（git 子命令限制为只读，如 status, log --oneline）
  - 超时：默认 3s；输出大小上限：256KB；屏蔽敏感 env。
- 事件：
  - agent.run.delta（开始/部分输出）
  - agent.run.output（完成，含 exitCode 与输出摘要）
- 拒绝策略：如请求非白名单或疑似破坏性命令，直接返回拒绝，并写入警告事件。

## 6. 前后端集成步骤（M3）

- 后端：
  1. 新增 tools 注册中心与两类工具实现。
  2. runRealAgent 中接入工具调用事件写入（保留现有 provider 输出流式）。
  3. 将工具调用作为“内部 agent 能力”暴露，不提供公开 HTTP；可保留 POST /api/tasks/:id/prompt 作为触发入口。
- 前端：
  - 近期保持现有 UI（“工具参数... → 触发工具”走 prompt），后续迭代为“工具选择 + 参数编辑器 + 结果展示”。
- 测试：
  - 单元测试：在 tests/units/works/unit-ws 下以 .minds/.tasklogs 隔离验证文件读写与命令执行。
  - 场景测试：扩展现有 cases/\* 流程，校验事件产出与 WS 展示。

## 7. 安全与合规

- 明确禁止执行潜在恶意/破坏性命令（即便用于“教学/演示”）。
- 不暴露系统信息或内部配置；仅返回必要的结果摘要。
- 不写入明文密钥；provider 仍使用环境变量引用。

## 8. Opencode 参考实现要点与 DevMinds.ai 映射

- 工具定义与注册：
  - Opencode 使用 Tool.define(id, init) 约定工具接口（description、parameters、execute、metadata），并通过 ToolRegistry 聚合内置与插件工具。
  - 映射：DevMinds.ai 增加 ToolRegistry，沿用 name/description/parameters/execute 签名，支持插件/扩展。
- 工具启用与权限：
  - Opencode 的 ToolRegistry.enabled(agent) 根据 Agent.permission（edit/bash/webfetch）裁剪工具可用性；BashTool 通过 Wildcard + AST 识别命令并执行 deny/ask。
  - 映射：DevMinds.ai 的 workspace.shell 引入权限表与 allowlist；对 rm/mv/cp/chmod/chown 等敏感命令进行路径解析与越权拒绝；对 ask 模式触发确认事件。
- 路径与工作区约束：
  - Opencode 工具通过 Instance.directory/worktree 与 Filesystem.contains() 约束文件/命令作用域。
  - 映射：DevMinds.ai 以 repoRoot 为工作区根，所有文件读写/命令执行均需通过 contains(repoRoot, targetPath) 校验。
- 对话中的工具编排：
  - session/prompt.ts 使用 ai SDK 的 tools，resolveTools(activeTools) 将 ToolRegistry 工具转换为 LLM tools；streamText 回传 tool-input/tool-call/tool-result/tool-error，并在 Session 中以 ToolPart 实时记录（metadata 流）。
  - 映射：DevMinds.ai 在 runRealAgent 中接入 LLM tool 调用；将 tool 开始/进度/结果映射到 agent.run.delta（含 metadata）与 agent.run.output；前端 ConversationStream 直接展示事件 payload。
- 文件读写工具：
  - ReadTool/WriteTool 强制 cwd 检查、二进制/图片拒读、原子写后做 LSP 诊断并返回预览/诊断元信息。
  - 映射：DevMinds.ai 的 workspace.fs 同步实现这些策略，并将写入后的诊断摘要纳入事件。
- Bash 执行工具：
  - BashTool 解析命令 AST，路径出仓拒绝，权限 ask/deny，进程输出以 metadata 流式更新，超时与输出长度限制。
  - 映射：DevMinds.ai 的 workspace.shell 采用类似模式，输出截断与审计事件一致。
- 修复与兼容：
  - Opencode 在 experimental_repairToolCall 里修复工具名大小写或回退 invalid 工具。
  - 映射：DevMinds.ai 可在工具注册处进行大小写归一与未匹配工具的 graceful degrade（写入 warning 事件）。

## 9. 迁移步骤补充（基于参考实现）

1. 后端新增 ToolRegistry、workspace.fs、workspace.shell，对齐权限/路径/metadata 语义。
2. runRealAgent 集成 ai SDK tools，resolveTools → activeTools；将工具事件转译为 agent.run.\* 并写 .tasklogs。
3. 测试：以 tests/units/works/unit-ws 为 cwd，覆盖 read/write/bash 的路径越权、ask/deny 与事件展示。
