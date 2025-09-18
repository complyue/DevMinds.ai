# DevMinds.ai 后端 API 与 WS 契约（草案）

目标
- 与 design/WorkspaceStructure.md 定义的本地运行时结构配合，提供“只读优先”的 REST/WS 接口。
- 为 M2 之后的交互（停止/新建子任务等）预留扩展点。

鉴权与会话
- 会话来源：浏览器会话 Cookie 或启动 token（Header: Authorization: Bearer <token>）
- 统一中间件校验，所有 REST/WS 接口均需通过

基础数据结构
- Event { ts: string, taskId: string, agentId: string, type: string, payload: any, spanId?: string, parentSpanId?: string }
- TaskTreeNode { id: string, children: TaskTreeNode[], hasMore?: boolean, meta?: any }
- Wip: string (markdown)

通用错误返回
{
  ok: false,
  message: string,
  details?: { file?: string, line?: number, snippet?: string, cause?: any }
}

REST

GET /api/tasks/:id/wip
- 描述：读取 .minds/tasks/{taskId}/wip.md
- 请求：无
- 响应：{ ok: true, wip: string, meta?: { mtime: string } }
- 错误：
  - 404 wip 不存在 → { ok: false, message: "wip not found" }

GET /api/tasks/:id/tree
- 描述：汇总任务与子任务树（读取 .tasklogs/{taskId}/meta.json 及 subtasks/*/meta.json）
- 请求参数（可选）：?depth=1&limit=200
- 响应：{ ok: true, root: TaskTreeNode }
- 说明：children[].hasMore 提示懒加载

GET /api/tasks/:id/events?date=YYYYMMDD&offset=0&limit=500
- 描述：按日分片读取 JSONL；默认返回当天
- 响应：
  {
    ok: true,
    items: Event[], 
    page: { offset: number, limit: number, total?: number },
    source: { file: string }
  }
- 错误（部分可解析）：
  { ok: true, items: Event[], warnings: [{ line: number, reason: string }] }

POST /api/tasks/:id/stop
- 描述：发出中断信号（写入一条 type=interrupt 的事件，M1 可仅广播模拟）
- 请求体：{ reason?: string, spanId?: string }
- 响应：{ ok: true }
- 失败：{ ok: false, message: "..." }

POST /api/tasks
- 描述：新建任务（M2 可启用，M1 可返回 501）
- 请求体：{ title?: string, meta?: any }
- 响应：{ ok: true, taskId: string }
- 失败：409（重复 id）、500（写入失败）

GET /api/providers
- 描述：读取 providers.json（不含密钥），用于设置页展示
- 响应：{ ok: true, providers: any[] }

POST /api/providers/test
- 描述：连通性测试；不保存密钥，仅临时校验
- 请求体：{ name: string, baseUrl?: string, apiKey?: string, model?: string }
- 响应：{ ok: true, latencyMs?: number, model?: string } 或 { ok: false, message: string }

WebSocket

URL: /ws
子协议：无（简化）
消息方向与格式
- 服务器 → 客户端：统一事件推送
  {
    ts: string,
    type: "task.updated" | "message.appended" | "tool.started" | "tool.ended" | "interrupt",
    taskId: string,
    agentId?: string,
    spanId?: string,
    parentSpanId?: string,
    payload: any
  }
- 客户端 → 服务器（M2 启用）
  - { type: "interrupt", taskId: string, spanId?: string, reason?: string }
  - 其他控制类指令后续扩展

事件流与文件回放策略
- WS 用于“现在发生的事”；REST /events 用于“已有事实的回放”
- 时间戳单调递增，以文件为粒度保证序列
- 跨天切换新文件；展示层自动拼接多日数据时需显式选择范围

安全与配额
- 所有接口遵守速率限制（如 10 req/s/ip），WS 连接数限制
- 不回传任何密钥或敏感信息；错误 details 裁剪敏感字段

版本与扩展
- HTTP Header: X-DevMinds-API: v1
- WS 事件字段保留扩展位：payload.ext?: object

与 opencode 的映射（参考，不含路径）
- providers/* → /api/providers, /api/providers/test
- server/session/* → /api/tasks/:id/events 与 WS 的事件封装
- tool/* → 未来在 M3 接入工具触发时使用
