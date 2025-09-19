import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { promises as fs } from "fs";
import path from "path";
import url from "url";
import { watch } from "fs";
import * as yaml from "js-yaml";

const app = new Hono();

// Get __dirname equivalent in ES modules
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve runtime root (repo root). Server runs from packages/backend
const repoRoot = path.resolve(process.cwd(), "../../");

const paths = {
  minds: (...p: string[]) => path.join(repoRoot, ".minds", ...p),
  tasklogs: (...p: string[]) => path.join(repoRoot, ".tasklogs", ...p),
};

// Load provider template from YAML
async function loadProviderTemplate() {
  const templatePath = path.join(__dirname, "../config/known-providers.yaml");
  try {
    if (await fileExists(templatePath)) {
      const yamlContent = await readText(templatePath);
      return yaml.load(yamlContent) as any;
    }
  } catch (error) {
    console.warn("Failed to load provider template:", error);
  }

  // Fallback to minimal template if YAML loading fails
  return {
    providers: {
      openai: {
        name: "OpenAI",
        apiType: "openai",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-5", "gpt-5-mini", "gpt-5-nano"],
        apiKeyEnvVar: "OPENAI_API_KEY",
      },
      anthropic: {
        name: "Anthropic",
        apiType: "anthropic",
        baseUrl: "https://api.anthropic.com",
        models: ["claude-4-sonnet"],
        apiKeyEnvVar: "ANTHROPIC_AUTH_TOKEN",
      },
    },
  };
}

// Helpers
async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(p: string) {
  return fs.readFile(p, "utf8");
}

const EventSchema = z.object({
  ts: z.string(),
  taskId: z.string(),
  agentId: z.string().optional(),
  type: z.string(),
  payload: z.any(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
});
type EventT = z.infer<typeof EventSchema>;

// GET /api/tasks/:id/wip
app.get("/api/tasks/:id/wip", async (c) => {
  const id = c.req.param("id");
  const p = paths.minds("tasks", id, "wip.md");
  if (!(await fileExists(p))) {
    return c.json({ ok: false, message: "wip not found" }, 404);
  }
  const content = await readText(p);
  let mtime: string | undefined;
  try {
    const st = await fs.stat(p);
    mtime = st.mtime.toISOString();
  } catch {}
  return c.json({ ok: true, wip: content, meta: { mtime } });
});

// GET /api/tasks/:id/tree
// Minimal: read .tasklogs/{id}/meta.json and subtasks/*/meta.json
app.get("/api/tasks/:id/tree", async (c) => {
  const id = c.req.param("id");
  const rootDir = paths.tasklogs(id);
  if (!(await fileExists(rootDir))) {
    return c.json({
      ok: true,
      root: { id, children: [], meta: { missing: true } },
    });
  }
  const rootMetaPath = path.join(rootDir, "meta.json");
  let rootMeta: any = {};
  if (await fileExists(rootMetaPath)) {
    try {
      rootMeta = JSON.parse(await readText(rootMetaPath));
    } catch {
      rootMeta = { parseError: true };
    }
  }
  const subtasksDir = path.join(rootDir, "subtasks");
  let children: any[] = [];
  if (await fileExists(subtasksDir)) {
    const subIds = (await fs.readdir(subtasksDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const sid of subIds) {
      const smetaPath = path.join(subtasksDir, sid, "meta.json");
      let smeta: any = {};
      if (await fileExists(smetaPath)) {
        try {
          smeta = JSON.parse(await readText(smetaPath));
        } catch {
          smeta = { parseError: true };
        }
      }
      children.push({ id: sid, children: [], meta: smeta });
    }
  }
  return c.json({ ok: true, root: { id, children, meta: rootMeta } });
});

// GET /api/tasks/:id/events?date=YYYYMMDD&offset=0&limit=500&dateRange=YYYYMMDD-YYYYMMDD
app.get("/api/tasks/:id/events", async (c) => {
  const id = c.req.param("id");
  const urlObj = new URL(c.req.url);
  const date =
    urlObj.searchParams.get("date") ??
    new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dateRange = urlObj.searchParams.get("dateRange");
  const offset = Number(urlObj.searchParams.get("offset") ?? "0");
  const limit = Number(urlObj.searchParams.get("limit") ?? "500");

  // Support date range queries
  let dates: string[] = [];
  if (dateRange) {
    const [start, end] = dateRange.split("-");
    if (start && end) {
      const startDate = new Date(
        `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`,
      );
      const endDate = new Date(
        `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}`,
      );
      for (
        let d = new Date(startDate);
        d <= endDate;
        d.setDate(d.getDate() + 1)
      ) {
        dates.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
      }
    }
  } else {
    dates = [date];
  }

  const allItems: EventT[] = [];
  const allWarnings: { file: string; line: number; reason: string }[] = [];

  for (const d of dates) {
    const file = path.join(paths.tasklogs(id), `events-${d}.jsonl`);
    if (!(await fileExists(file))) continue;

    const text = await readText(file);
    const lines = text.split(/\r?\n/).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        const parsed = EventSchema.safeParse(obj);
        if (parsed.success) allItems.push(parsed.data);
        else
          allWarnings.push({
            file: `events-${d}.jsonl`,
            line: i + 1,
            reason: "schema mismatch",
          });
      } catch {
        allWarnings.push({
          file: `events-${d}.jsonl`,
          line: i + 1,
          reason: "bad json",
        });
      }
    }
  }

  // Sort by timestamp and apply pagination
  allItems.sort((a, b) => a.ts.localeCompare(b.ts));
  const paginatedItems = allItems.slice(offset, offset + limit);

  const resp: any = {
    ok: true,
    items: paginatedItems,
    page: { offset, limit, total: allItems.length },
    source: { dates, files: dates.map((d) => `events-${d}.jsonl`) },
  };
  if (allWarnings.length) resp.warnings = allWarnings;
  return c.json(resp);
});

// GET /api/providers - Read providers config
app.get("/api/providers", async (c) => {
  // Always use built-in provider configuration
  const template = await loadProviderTemplate();
  return c.json({ ok: true, config: template, isBuiltIn: true });
});

// POST /api/providers/test - Test provider connectivity (no persistence)
app.post("/api/providers/test", async (c) => {
  try {
    const body = await c.req.json();
    const { providerId, model } = body;

    if (!providerId) {
      return c.json({ ok: false, message: "Missing providerId" }, 400);
    }

    // Use built-in provider configuration
    const template = await loadProviderTemplate();
    const provider = template.providers?.[providerId];
    if (!provider) {
      return c.json(
        { ok: false, message: `Provider ${providerId} not found` },
        404,
      );
    }

    // Get API key from environment variable (with defaults based on apiType)
    const getDefaultEnvVar = (apiType: string) => {
      switch (apiType) {
        case "openai":
          return "OPENAI_API_KEY";
        case "anthropic":
          return "ANTHROPIC_AUTH_TOKEN";
        default:
          return null;
      }
    };

    const envVar = provider.apiKeyEnvVar || getDefaultEnvVar(provider.apiType);
    if (!envVar) {
      return c.json({
        ok: false,
        message: `No environment variable specified for apiType ${provider.apiType}`,
      });
    }

    const apiKey = process.env[envVar];
    if (!apiKey) {
      return c.json({
        ok: false,
        message: `Environment variable ${envVar} not set`,
      });
    }

    // Simple connectivity test - just check if we can reach the endpoint
    try {
      const testUrl = new URL(provider.baseUrl);
      const isReachable =
        testUrl.protocol === "https:" || testUrl.protocol === "http:";

      if (!isReachable) {
        return c.json({ ok: false, message: "Invalid URL format" });
      }

      // Mock test result for now - in real implementation would make actual API call
      return c.json({
        ok: true,
        result: {
          connected: true,
          latency: Math.floor(Math.random() * 200) + 50,
          model: model || provider.models[0],
          apiType: provider.apiType,
          baseUrl: provider.baseUrl,
          message: `Connection test successful for ${providerId} (mocked)`,
        },
      });
    } catch (err) {
      return c.json({ ok: false, message: "Invalid baseUrl" }, 400);
    }
  } catch (err) {
    return c.json({ ok: false, message: "Test failed" }, 500);
  }
});

// HTTP + WS server
const httpServer = createServer((req, res) => {
  // Delegate to Hono
  const handler = app.fetch as any;
  const urlStr = req.url ? `http://localhost${req.url}` : "http://localhost/";
  const request = new Request(urlStr, {
    method: req.method,
    headers: req.headers as any,
    body: ["GET", "HEAD"].includes(req.method ?? "") ? undefined : (req as any),
    duplex: ["GET", "HEAD"].includes(req.method ?? "") ? undefined : "half",
  } as RequestInit);
  handler(request)
    .then((r: Response) => {
      res.writeHead(r.status, Object.fromEntries(r.headers as any));
      r.body
        ?.pipeTo(
          new WritableStream({
            write(chunk) {
              res.write(Buffer.from(chunk));
            },
            close() {
              res.end();
            },
          }) as any,
        )
        .catch(() => res.end());
    })
    .catch(() => {
      res.statusCode = 500;
      res.end("internal error");
    });
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

// File monitoring for real-time event broadcasting
const fileWatchers = new Map<string, any>();
const filePositions = new Map<string, number>();

// Broadcast message to all connected WebSocket clients
function broadcast(message: any) {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

// Monitor a specific event file for new content
async function monitorEventFile(filePath: string, taskId: string) {
  if (fileWatchers.has(filePath)) {
    return; // Already monitoring
  }

  try {
    // Initialize file position to current end
    const stats = await fs.stat(filePath);
    filePositions.set(filePath, stats.size);

    const watcher = watch(filePath, async (eventType) => {
      if (eventType === "change") {
        try {
          const currentStats = await fs.stat(filePath);
          const lastPosition = filePositions.get(filePath) || 0;

          if (currentStats.size > lastPosition) {
            // Read new content from last position
            const fileHandle = await fs.open(filePath, "r");
            const buffer = Buffer.alloc(currentStats.size - lastPosition);
            await fileHandle.read(buffer, 0, buffer.length, lastPosition);
            await fileHandle.close();

            const newContent = buffer.toString("utf8");
            const newLines = newContent.split(/\r?\n/).filter(Boolean);

            // Parse and broadcast new events
            for (const line of newLines) {
              try {
                const event = JSON.parse(line);
                const parsed = EventSchema.safeParse(event);
                if (parsed.success) {
                  broadcast({
                    ts: new Date().toISOString(),
                    type: "message.appended",
                    payload: parsed.data,
                  });
                }
              } catch (err) {
                console.warn(`Failed to parse event line: ${line}`, err);
              }
            }

            // Update file position
            filePositions.set(filePath, currentStats.size);
          }
        } catch (err) {
          console.error(`Error reading file ${filePath}:`, err);
        }
      }
    });

    fileWatchers.set(filePath, watcher);
    console.log(`[file-monitor] Started monitoring ${filePath}`);
  } catch (err) {
    console.error(`Failed to start monitoring ${filePath}:`, err);
  }
}

// Start monitoring all existing event files
async function initializeFileMonitoring() {
  try {
    const tasklogsDir = paths.tasklogs();
    if (!(await fileExists(tasklogsDir))) {
      return;
    }

    const taskDirs = await fs.readdir(tasklogsDir, { withFileTypes: true });
    for (const taskDir of taskDirs) {
      if (taskDir.isDirectory()) {
        const taskId = taskDir.name;
        const taskPath = path.join(tasklogsDir, taskId);

        try {
          const files = await fs.readdir(taskPath);
          for (const file of files) {
            if (file.startsWith("events-") && file.endsWith(".jsonl")) {
              const filePath = path.join(taskPath, file);
              await monitorEventFile(filePath, taskId);
            }
          }
        } catch (err) {
          console.warn(`Failed to scan task directory ${taskId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Failed to initialize file monitoring:", err);
  }
}

// WebSocket connection handling
wss.on("connection", (ws: WebSocket) => {
  ws.send(
    JSON.stringify({
      ts: new Date().toISOString(),
      type: "welcome",
      payload: { ok: true, message: "WebSocket connected" },
    }),
  );

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });

  ws.on("error", (err: unknown) => {
    console.error("WebSocket error:", err);
  });
});

// Initialize file monitoring on startup
initializeFileMonitoring();

const PORT = Number(process.env.PORT ?? 5175);
httpServer.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
});
