import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { z } from "zod"
import { createServer } from "http"
import { WebSocketServer } from "ws"
import { promises as fs } from "fs"
import path from "path"
import url from "url"

const app = new Hono()

// Resolve runtime root (repo root). Server runs from packages/backend
const repoRoot = path.resolve(process.cwd(), "../../")

const paths = {
  minds: (...p: string[]) => path.join(repoRoot, ".minds", ...p),
  tasklogs: (...p: string[]) => path.join(repoRoot, ".tasklogs", ...p)
}

// Helpers
async function fileExists(p: string) {
  try { await fs.access(p); return true } catch { return false }
}

async function readText(p: string) {
  return fs.readFile(p, "utf8")
}

const EventSchema = z.object({
  ts: z.string(),
  taskId: z.string(),
  agentId: z.string().optional(),
  type: z.string(),
  payload: z.any(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional()
})
type EventT = z.infer<typeof EventSchema>

// GET /api/tasks/:id/wip
app.get("/api/tasks/:id/wip", async (c) => {
  const id = c.req.param("id")
  const p = paths.minds("tasks", id, "wip.md")
  if (!(await fileExists(p))) {
    return c.json({ ok: false, message: "wip not found" }, 404)
  }
  const content = await readText(p)
  let mtime: string | undefined
  try {
    const st = await fs.stat(p)
    mtime = st.mtime.toISOString()
  } catch {}
  return c.json({ ok: true, wip: content, meta: { mtime } })
})

// GET /api/tasks/:id/tree
// Minimal: read .tasklogs/{id}/meta.json and subtasks/*/meta.json
app.get("/api/tasks/:id/tree", async (c) => {
  const id = c.req.param("id")
  const rootDir = paths.tasklogs(id)
  if (!(await fileExists(rootDir))) {
    return c.json({ ok: true, root: { id, children: [], meta: { missing: true } } })
  }
  const rootMetaPath = path.join(rootDir, "meta.json")
  let rootMeta: any = {}
  if (await fileExists(rootMetaPath)) {
    try { rootMeta = JSON.parse(await readText(rootMetaPath)) } catch { rootMeta = { parseError: true } }
  }
  const subtasksDir = path.join(rootDir, "subtasks")
  let children: any[] = []
  if (await fileExists(subtasksDir)) {
    const subIds = (await fs.readdir(subtasksDir, { withFileTypes: true }))
      .filter(d => d.isDirectory()).map(d => d.name)
    for (const sid of subIds) {
      const smetaPath = path.join(subtasksDir, sid, "meta.json")
      let smeta: any = {}
      if (await fileExists(smetaPath)) {
        try { smeta = JSON.parse(await readText(smetaPath)) } catch { smeta = { parseError: true } }
      }
      children.push({ id: sid, children: [], meta: smeta })
    }
  }
  return c.json({ ok: true, root: { id, children, meta: rootMeta } })
})

// GET /api/tasks/:id/events?date=YYYYMMDD&offset=0&limit=500&dateRange=YYYYMMDD-YYYYMMDD
app.get("/api/tasks/:id/events", async (c) => {
  const id = c.req.param("id")
  const urlObj = new URL(c.req.url)
  const date = urlObj.searchParams.get("date") ?? new Date().toISOString().slice(0,10).replace(/-/g, "")
  const dateRange = urlObj.searchParams.get("dateRange")
  const offset = Number(urlObj.searchParams.get("offset") ?? "0")
  const limit = Number(urlObj.searchParams.get("limit") ?? "500")

  // Support date range queries
  let dates: string[] = []
  if (dateRange) {
    const [start, end] = dateRange.split("-")
    if (start && end) {
      const startDate = new Date(`${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)}`)
      const endDate = new Date(`${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}`)
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().slice(0,10).replace(/-/g, ""))
      }
    }
  } else {
    dates = [date]
  }

  const allItems: EventT[] = []
  const allWarnings: { file: string; line: number; reason: string }[] = []

  for (const d of dates) {
    const file = path.join(paths.tasklogs(id), `events-${d}.jsonl`)
    if (!(await fileExists(file))) continue

    const text = await readText(file)
    const lines = text.split(/\r?\n/).filter(Boolean)

    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i])
        const parsed = EventSchema.safeParse(obj)
        if (parsed.success) allItems.push(parsed.data)
        else allWarnings.push({ file: `events-${d}.jsonl`, line: i + 1, reason: "schema mismatch" })
      } catch {
        allWarnings.push({ file: `events-${d}.jsonl`, line: i + 1, reason: "bad json" })
      }
    }
  }

  // Sort by timestamp and apply pagination
  allItems.sort((a, b) => a.ts.localeCompare(b.ts))
  const paginatedItems = allItems.slice(offset, offset + limit)

  const resp: any = { 
    ok: true, 
    items: paginatedItems, 
    page: { offset, limit, total: allItems.length }, 
    source: { dates, files: dates.map(d => `events-${d}.jsonl`) }
  }
  if (allWarnings.length) resp.warnings = allWarnings
  return c.json(resp)
})

// GET /api/providers - Read providers config
app.get("/api/providers", async (c) => {
  const configPath = paths.minds("config", "providers.json")
  if (!(await fileExists(configPath))) {
    // Return default template without secrets
    const template = {
      providers: {
        openai: {
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          models: ["gpt-4", "gpt-3.5-turbo"],
          apiKey: "" // Empty - user needs to fill
        },
        anthropic: {
          name: "Anthropic",
          baseUrl: "https://api.anthropic.com",
          models: ["claude-3-sonnet", "claude-3-haiku"],
          apiKey: ""
        }
      },
      default: "openai"
    }
    return c.json({ ok: true, config: template, isTemplate: true })
  }

  try {
    const content = await readText(configPath)
    const config = JSON.parse(content)
    // Never expose actual API keys in responses
    const sanitized = JSON.parse(JSON.stringify(config))
    if (sanitized.providers) {
      Object.values(sanitized.providers).forEach((p: any) => {
        if (p.apiKey) p.apiKey = "***"
      })
    }
    return c.json({ ok: true, config: sanitized })
  } catch (err) {
    return c.json({ ok: false, message: "Failed to parse providers config" }, 500)
  }
})

// POST /api/providers/test - Test provider connectivity (no persistence)
app.post("/api/providers/test", async (c) => {
  try {
    const body = await c.req.json()
    const { provider, apiKey, baseUrl, model } = body

    if (!provider || !apiKey || !baseUrl) {
      return c.json({ ok: false, message: "Missing required fields" }, 400)
    }

    // Simple connectivity test - just check if we can reach the endpoint
    // In a real implementation, this would make an actual API call
    const testUrl = new URL(baseUrl)
    const isReachable = testUrl.protocol === "https:" || testUrl.protocol === "http:"
    
    if (!isReachable) {
      return c.json({ ok: false, message: "Invalid URL format" })
    }

    // Mock test result for now
    return c.json({ 
      ok: true, 
      result: { 
        connected: true, 
        latency: Math.floor(Math.random() * 200) + 50,
        model: model || "default",
        message: "Connection test successful (mocked)"
      }
    })
  } catch (err) {
    return c.json({ ok: false, message: "Test failed" }, 500)
  }
})

// HTTP + WS server
const httpServer = createServer((req, res) => {
  // Delegate to Hono
  const handler = app.fetch as any
  const urlStr = req.url ? `http://localhost${req.url}` : "http://localhost/"
  const request = new Request(urlStr, {
    method: req.method,
    headers: req.headers as any,
    body: ["GET","HEAD"].includes(req.method ?? "") ? undefined : (req as any)
  })
  handler(request).then((r: Response) => {
    res.writeHead(r.status, Object.fromEntries(r.headers as any))
    r.body?.pipeTo((new WritableStream({
      write(chunk) { res.write(Buffer.from(chunk)) },
      close() { res.end() }
    }) as any)).catch(() => res.end())
  }).catch(() => {
    res.statusCode = 500
    res.end("internal error")
  })
})

const wss = new WebSocketServer({ server: httpServer, path: "/ws" })
// For M1: broadcast-only stub. In future, tie to file tail or in-process events.
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ ts: new Date().toISOString(), type: "welcome", payload: { ok: true } }))
})

const PORT = Number(process.env.PORT ?? 5175)
httpServer.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`)
})
