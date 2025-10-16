/**
 * MiniApp: minimal router
 * - Supports app.get/post/patch/delete(path, handler)
 * - Path params like /api/tasks/:id/...
 * - Context c: c.req.param(name), c.req.url, c.req.json(); c.json(data, status?)
 * - Global Bearer token auth for /api/*
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { FSWatcher, Dirent } from 'fs';
import { getToken, checkWsAuth } from './core/auth.js';
import { MiniApp } from './core/miniapp.js';

const DEVMINDS_AUTH_KEY = getToken();
import { z } from 'zod';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { promises as fs } from 'fs';
import { watch } from 'fs';
import path from 'path';
import url from 'url';
import { Buffer } from 'buffer';
import * as yaml from 'js-yaml';
import './providers/defaults.js';
import './providers/hooks.js';
import { callProvider } from './providers/registry.js';
import { ToolRegistry } from './tools/registry.js';
import {
  loadProviderTemplate,
  loadRuntimeProviderConfig,
  mergeProviderConfigs,
} from './core/providers.js';
import { createAgentRunners } from './core/agent.js';
import {
  configureEvents,
  monitorEventFile as evMonitorEventFile,
  fileWatchers as evFileWatchers,
  filePositions as evFilePositions,
  appendEventToFile as evAppendEventToFile,
} from './core/events.js';
import { waitForAnswer, handleEventBusiness } from './core/events-business.js';

const app = new MiniApp();

/**
 * Get __dirname equivalent in ES modules
 * (uses node:url and node:path)
 */
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Frontend dist directory (production static assets)
const webappDist = path.resolve(__dirname, '../../webapp/dist');

function getMimeType(fp: string): string {
  const ext = path.extname(fp).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

async function tryServeStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  try {
    // Only handle non-API, non-WS paths here
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(reqUrl.pathname || '/');

    // Skip API and WS
    if (pathname.startsWith('/api') || pathname.startsWith('/ws')) return false;

    // Map URL to file in dist; directory or "" → index.html
    let fp = path.join(webappDist, pathname);
    let st: any = null;
    try {
      st = await fs.stat(fp);
      if (st.isDirectory()) {
        fp = path.join(fp, 'index.html');
      }
    } catch {
      // Not found → SPA fallback to index.html
      fp = path.join(webappDist, 'index.html');
      try {
        st = await fs.stat(fp);
      } catch {
        return false;
      }
    }

    const data = await fs.readFile(fp);
    res.statusCode = 200;
    res.setHeader('Content-Type', getMimeType(fp));
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

// Single-port dev: lazy-create Vite in middlewareMode when DEV_SINGLE=1
let viteDev: any = null;
async function ensureViteDev(httpServer: import('http').Server) {
  if (viteDev) return viteDev;
  const vite = await import('vite');
  viteDev = await vite.createServer({
    root: path.resolve(__dirname, '../../webapp'),
    server: {
      middlewareMode: true,
      hmr: { server: httpServer }
    },
    appType: 'spa',
  });
  return viteDev;
}

/**
 * Workspace root is the server process current working directory.
 * Do not use env vars to override; tests should run server from the intended root.
 */
const repoRoot = process.cwd();

const paths = {
  minds: (...p: string[]) => path.join(repoRoot, '.minds', ...p),
  tasklogs: (...p: string[]) => path.join(repoRoot, '.tasklogs', ...p),
};

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

/**
 * Load built-in provider template from YAML.
 */

/**
 * Load runtime provider config from .minds/provider.yaml if present.
 */

/**
 * Deep merge of provider configs: runtime overrides built-in.
 * - merges top-level fields
 * - for providers map, merges each provider object
 * - for arrays (e.g., models), uses runtime value if provided, otherwise built-in
 */

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
  return fs.readFile(p, 'utf8');
}

/**
 * Load task team configuration from .minds/tasks/{taskId}/team.md
 * Supports YAML frontmatter:
 * ---
 * defaultMember: alice
 * members:
 *   - id: alice
 *     skill: coding
 *   - id: bob
 *     skill: review
 * ---
 * Fallback: simple "members:" list in JSON fenced block.
 */
async function loadTaskTeam(
  taskId: string,
): Promise<{ defaultMember?: string; members: Array<{ id: string; skill: string }> }> {
  const dir = paths.minds('tasks', taskId);
  const teamPath = path.join(dir, 'team.md');
  if (!(await fileExists(teamPath))) {
    throw new Error('team.md not found for task');
  }
  const text = await readText(teamPath);
  // Try YAML frontmatter
  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (fmMatch) {
    try {
      const fm = yaml.load(fmMatch[1]) as any;
      const members = Array.isArray(fm?.members) ? fm.members : [];
      return {
        defaultMember: fm?.defaultMember,
        members: members.map((m: any) => ({
          id: String(m?.id || m?.name),
          skill: String(m?.skill),
        })),
      };
    } catch (err) {
      console.warn('Failed to parse team.md frontmatter:', err);
    }
  }
  // Fallback: find a JSON code block
  const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[1]);
      const members = Array.isArray(obj?.members) ? obj.members : [];
      return {
        defaultMember: obj?.defaultMember,
        members: members.map((m: any) => ({
          id: String(m?.id || m?.name),
          skill: String(m?.skill),
        })),
      };
    } catch (err) {
      console.warn('Failed to parse team.md JSON block:', err);
    }
  }
  throw new Error('Unable to parse team.md');
}

/**
 * Load skill definition from .minds/skills/{skill}/def.md
 * Supports YAML frontmatter:
 * ---
 * providerId: openai
 * model: gpt-5
 * ---
 * Fallback: lines like "Provider: openai" and "Model: gpt-5"
 */
async function loadSkillDef(skill: string): Promise<{ providerId: string; model?: string }> {
  const dir = paths.minds('skills', skill);
  const defPath = path.join(dir, 'def.md');
  if (!(await fileExists(defPath))) {
    throw new Error(`def.md not found for skill ${skill}`);
  }
  const text = await readText(defPath);
  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (fmMatch) {
    try {
      const fm = yaml.load(fmMatch[1]) as any;
      if (!fm?.providerId) throw new Error('providerId missing in def.md');
      return { providerId: String(fm.providerId), model: fm?.model ? String(fm.model) : undefined };
    } catch (err) {
      console.warn('Failed to parse def.md frontmatter:', err);
    }
  }
  const provLine = text.match(/Provider:\s*([A-Za-z0-9_-]+)/i);
  const modelLine = text.match(/Model:\s*([A-Za-z0-9._-]+)/i);
  if (provLine) {
    return { providerId: provLine[1], model: modelLine ? modelLine[1] : undefined };
  }
  throw new Error(`providerId not specified in def.md for skill ${skill}`);
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
app.get('/api/tasks/:id/wip', async (c) => {
  const id = c.req.param('id');
  const p = paths.minds('tasks', id, 'wip.md');
  if (!(await fileExists(p))) {
    return c.json({ ok: false, message: 'wip not found' }, 404);
  }
  const content = await readText(p);
  let mtime: string | undefined;
  try {
    const st = await fs.stat(p);
    mtime = st.mtime.toISOString();
  } catch {}
  return c.json({ ok: true, wip: content, meta: { mtime } });
});

/**
 * GET /api/tasks/:id/tree
 * Read hierarchy from .tasklogs only; meta.json is deprecated.
 * Meta information is carried in per-event payloads.
 */
app.get('/api/tasks/:id/tree', async (c) => {
  const id = c.req.param('id');
  const rootDir = paths.tasklogs(id);
  if (!(await fileExists(rootDir))) {
    return c.json({ ok: true, root: { id, children: [] } });
  }
  const subtasksDir = path.join(rootDir, 'subtasks');
  const children: any[] = [];
  if (await fileExists(subtasksDir)) {
    const subIds = (await fs.readdir(subtasksDir, { withFileTypes: true }))
      .filter((d: Dirent) => d.isDirectory())
      .map((d: Dirent) => d.name);
    for (const sid of subIds) {
      children.push({ id: sid, children: [] });
    }
  }
  return c.json({ ok: true, root: { id, children } });
});

// GET /api/tasks/:id/events?date=YYYYMMDD&offset=0&limit=500&dateRange=YYYYMMDD-YYYYMMDD
app.get('/api/tasks/:id/events', async (c) => {
  const id = c.req.param('id');
  const urlObj = new URL(c.req.url);
  const date =
    urlObj.searchParams.get('date') ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dateRange = urlObj.searchParams.get('dateRange');
  const offset = Number(urlObj.searchParams.get('offset') ?? '0');
  const limit = Number(urlObj.searchParams.get('limit') ?? '500');

  // Support date range queries
  let dates: string[] = [];
  if (dateRange) {
    const [start, end] = dateRange.split('-');
    if (start && end) {
      const startDate = new Date(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`);
      const endDate = new Date(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}`);
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
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
            reason: 'schema mismatch',
          });
      } catch {
        allWarnings.push({
          file: `events-${d}.jsonl`,
          line: i + 1,
          reason: 'bad json',
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

/**
 * [removed] Provider config HTTP routes per design:
 * - No public routes or CLI interfaces for provider config.
 * - Config will be managed via internal agentic tools in M3, operating on .minds/provider.yaml.
 */

/**
 * [removed] Provider connectivity HTTP route per design:
 * - Connectivity diagnostics will be provided via internal agentic tools in M3.
 */

// HTTP + WS server
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const reqUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(reqUrl.pathname || '/');

  if (process.env.DEV_SINGLE === '1') {
    // Single-port dev: use Vite middleware for non-API/WS
    if (!pathname.startsWith('/api') && !pathname.startsWith('/ws')) {
      const v = await ensureViteDev(httpServer);
      // Let Vite handle and fallback to 404 if unhandled
      return v.middlewares(req as any, res as any, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
    }
  } else {
    // Production/static preview: try static first
    const served = await tryServeStatic(req, res);
    if (served) return;
  }

  // Delegate to API/WS handlers
  app.handle(req, res, DEVMINDS_AUTH_KEY);
});

const wss = new WebSocketServer({ server: httpServer });

// Minimal per-task state node
type TaskState = 'idle' | 'follow' | 'run';
type TaskNode = {
  state: TaskState;
  clients: Set<WebSocket>;
  watchers: Map<string, ReturnType<typeof watch>>;
  running?: boolean;
  abortCtrl?: AbortController;
  cancelRequested?: boolean;
};
const taskNodes = new Map<string, TaskNode>();

function getOrCreateTaskNode(taskId: string): TaskNode {
  let node = taskNodes.get(taskId);
  if (!node) {
    node = {
      state: 'idle',
      clients: new Set(),
      watchers: new Map(),
      running: false,
      abortCtrl: undefined,
      cancelRequested: false,
    };
    taskNodes.set(taskId, node);
  }
  return node;
}

// Broadcast to clients of a specific task
function broadcastToTask(taskId: string, message: any) {
  const node = taskNodes.get(taskId);
  if (!node) return;
  const msg = JSON.stringify(message);
  for (const client of node.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

configureEvents({ paths, broadcaster: broadcastToTask });
// Ensure the task is in "follow" mode by watching event files
async function ensureFollow(taskId: string) {
  const node = getOrCreateTaskNode(taskId);
  if (node.state === 'follow' || node.state === 'run') return;

  const taskDir = paths.tasklogs(taskId);
  if (!(await fileExists(taskDir))) {
    node.state = 'idle';
    return;
  }

  try {
    const files = await fs.readdir(taskDir);
    for (const f of files) {
      if (f.startsWith('events-') && f.endsWith('.jsonl')) {
        const fp = path.join(taskDir, f);
        if (!node.watchers.has(fp)) {
          await evMonitorEventFile(fp, taskId); // installs a watcher if not already
          // monitorEventFile uses global maps; we still track presence at node-level by reading global fileWatchers
          const fw = fileWatchers.get(fp);
          if (fw) node.watchers.set(fp, fw);
        }
      }
    }
    node.state = 'follow';
  } catch (err) {
    console.warn(`[task:${taskId}] ensureFollow failed:`, err);
  }
}

// File monitoring for real-time event broadcasting
const fileWatchers = evFileWatchers;
const filePositions = evFilePositions;

function stopAllWatchersForTask(taskId: string) {
  const node = taskNodes.get(taskId);
  if (!node) return;
  for (const [fp, w] of node.watchers) {
    try {
      w.close();
      fileWatchers.delete(fp);
      filePositions.delete(fp);
    } catch {}
  }
  node.watchers.clear();
}

// Broadcast message to all connected WebSocket clients
function broadcast(message: any) {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

/**
 * Status helpers
 */
function getTaskStatus(taskId: string) {
  const node = getOrCreateTaskNode(taskId);
  return {
    state: node.state,
    clients: node.clients.size,
    running: !!node.running,
  };
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

    const watcher = watch(filePath, async (eventType: string) => {
      if (eventType === 'change') {
        try {
          const currentStats = await fs.stat(filePath);
          const lastPosition = filePositions.get(filePath) || 0;

          if (currentStats.size > lastPosition) {
            // Read new content from last position
            const fileHandle = await fs.open(filePath, 'r');
            const buffer = Buffer.alloc(currentStats.size - lastPosition);
            await fileHandle.read(buffer, 0, buffer.length, lastPosition);
            await fileHandle.close();

            const newContent = Buffer.from(buffer).toString('utf8');
            const newLines = newContent.split(/\r?\n/).filter(Boolean);

            // Parse and broadcast new events
            for (const line of newLines) {
              try {
                const event = JSON.parse(line);
                const parsed = EventSchema.safeParse(event);
                if (parsed.success) {
                  broadcastToTask(taskId, {
                    ts: new Date().toISOString(),
                    type: 'message.appended',
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
            if (file.startsWith('events-') && file.endsWith('.jsonl')) {
              const filePath = path.join(taskPath, file);
              await evMonitorEventFile(filePath, taskId);
            }
          }
        } catch (err) {
          console.warn(`Failed to scan task directory ${taskId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Failed to initialize file monitoring:', err);
  }
}

/**
 * WebSocket connection handling
 * Route: /ws/:taskId
 */
wss.on('connection', (ws: WebSocket, req: IncomingMessage & { url?: string; headers?: any }) => {
  try {
    // WS Bearer via Sec-WebSocket-Protocol: expect ['devminds','bearer.<token>']
    const protoRaw = String(req?.headers?.['sec-websocket-protocol'] || '');
    if (!checkWsAuth(protoRaw, DEVMINDS_AUTH_KEY)) {
      try {
        ws.close(1008, 'invalid token');
      } catch {}
      return;
    }

    const reqUrl = new URL(req?.url || '/', 'http://localhost');
    const parts = reqUrl.pathname.split('/').filter(Boolean); // ['ws', ':taskId']
    if (parts[0] !== 'ws' || parts.length < 2) {
      ws.close(1008, 'Expected /ws/:taskId');
      return;
    }
    const taskId = decodeURIComponent(parts[1]);
    const node = getOrCreateTaskNode(taskId);
    node.clients.add(ws);

    // Move to follow on first subscriber if idle
    if (node.state === 'idle') {
      ensureFollow(taskId);
    }

    ws.send(
      JSON.stringify({
        ts: new Date().toISOString(),
        type: 'welcome',
        payload: { ok: true, message: `WebSocket connected to task ${taskId}` },
      }),
    );

    ws.on('close', () => {
      node.clients.delete(ws);
      console.log(`[ws] client disconnected from ${taskId} (clients=${node.clients.size})`);
      // keep watchers for now; optimization for tearing down can be added later
    });

    ws.on('error', (err: unknown) => {
      console.error(`[ws] error for ${taskId}:`, err);
    });

    // Inbound: append-only, no business semantics
    ws.on('message', async (data: any) => {
      try {
        const msg = JSON.parse(String(data || 'null'));
        if (!msg || msg.kind !== 'append' || typeof msg.event !== 'object') return;
        const ev = msg.event as any;
        // Minimal schema check
        if (
          !ev ||
          typeof ev.ts !== 'string' ||
          typeof ev.taskId !== 'string' ||
          typeof ev.type !== 'string' ||
          !('payload' in ev)
        ) {
          return;
        }
        if (ev.taskId !== taskId) return; // guard cross-task
        // persist and broadcast
        await appendEventToFile(taskId, ev);
        broadcastToTask(taskId, {
          ts: new Date().toISOString(),
          type: 'message.appended',
          payload: ev,
        });
      } catch (e) {
        console.warn('[ws] append message failed:', e);
      }
    });
  } catch (err) {
    console.error('[ws] failed to handle connection:', err);
    try {
      ws.close(1011, 'Internal error');
    } catch {}
  }
});

/**
 * M2: switch to lazy, task-scoped following.
 * Startup-wide file monitoring is disabled; watchers are created on demand per /ws/:taskId connection.
 */
// initializeFileMonitoring();

/**
 * M2: run state — start a simulated agent producer
 */

async function appendEventToFile(taskId: string, ev: EventT) {
  await evAppendEventToFile(taskId, ev);
  try {
    handleEventBusiness(ev);
  } catch (e) {
    console.warn('[event-hook] handleEventBusiness failed:', e);
  }
}

// Real agent runner
async function runRealAgent(
  taskId: string,
  promptOverride?: string,
  awaitAsk?: boolean,
  abortCtrl?: AbortController,
): Promise<void> {
  // Load merged provider config
  const template = await loadProviderTemplate();
  const runtime = await loadRuntimeProviderConfig(paths);
  const { merged } = mergeProviderConfigs(template, runtime);

  // Resolve member and skill via team.md, and provider via skill def.md
  let chosenMember: { id: string; skill: string } | null = null;
  let providerId: string | null = null;
  let modelOverride: string | undefined = undefined;

  try {
    const team = await loadTaskTeam(taskId);
    if (!team.members || team.members.length === 0) {
      throw new Error('No members defined in team.md');
    }
    chosenMember = team.defaultMember
      ? team.members.find((m) => m.id === team.defaultMember) || team.members[0]
      : team.members[0];
    const skill = chosenMember?.skill;
    if (!skill) throw new Error('Selected member has no skill');
    const skillDef = await loadSkillDef(skill);
    providerId = String(skillDef.providerId);
    modelOverride = skillDef.model ? String(skillDef.model) : undefined;
  } catch {
    // Fallback: use built-in mock provider so runs can proceed without .minds
    chosenMember = { id: 'mock', skill: 'mock' };
    providerId = 'mock';
    modelOverride = undefined;
  }

  const provider = merged.providers?.[providerId!];
  if (!provider) {
    throw new Error(`Provider ${providerId} not found`);
  }
  // Ensure skill variable is available for event payloads
  const skill = chosenMember!.skill;

  // Resolve API key env var by apiType or explicit apiKeyEnvVar
  const getDefaultEnvVar = (apiType: string) => {
    switch (apiType) {
      case 'openai':
        return 'OPENAI_API_KEY';
      case 'anthropic':
        return 'ANTHROPIC_AUTH_TOKEN';
      default:
        return null;
    }
  };
  const envVar = provider.apiKeyEnvVar || getDefaultEnvVar(provider.apiType);
  const apiKey = envVar ? process.env[envVar] : undefined;
  if (provider.apiType !== 'mock') {
    if (!envVar) throw new Error(`No env var for apiType ${provider.apiType}`);
    if (!apiKey) throw new Error(`Env ${envVar} not set`);
  }

  // Build prompt from override or WIP if available
  let prompt = promptOverride ?? `Please summarize the current task ${taskId} context.`;
  try {
    if (!promptOverride) {
      const wipPath = paths.minds('tasks', taskId, 'wip.md');
      if (await fileExists(wipPath)) {
        prompt = await readText(wipPath);
      }
    }
  } catch {}

  const baseUrl: string = (provider.baseUrl?.replace(/\/+$/, '') ||
    (provider.apiType === 'openai'
      ? 'https://api.openai.com/v1'
      : 'https://api.anthropic.com')) as string;
  // Choose model: mock always uses its first model (or 'test-model'); others may honor override
  let model: string;
  if (provider.apiType === 'mock') {
    // For tests, mock model is fixed to 'test-model' regardless of runtime overrides or def.md
    model = 'test-model';
  } else {
    model =
      modelOverride ||
      provider.models?.[0] ||
      (provider.apiType === 'openai' ? 'gpt-5' : 'claude-4-sonnet');
  }
  // Debug chosen model and stack
  try {
    const debugStack = new Error('model.debug').stack;
    console.debug(
      `[debug:model] task=${taskId} providerId=${providerId} apiType=${provider.apiType} modelOverride=${String(
        modelOverride,
      )} models=${JSON.stringify(provider.models)} chosen=${model}`,
    );
    if (debugStack) console.debug(`[debug:stack] ${debugStack}`);
  } catch {}

  // Optional ask-await before calling provider
  let askNote: any = null;
  if (awaitAsk) {
    const questionId = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const evAsk: EventT = {
      ts: new Date().toISOString(),
      taskId,
      type: 'agent.ask.request',
      payload: { question: 'Please confirm to proceed.', questionId },
    };
    await appendEventToFile(taskId, evAsk);
    broadcastToTask(taskId, {
      ts: new Date().toISOString(),
      type: 'message.appended',
      payload: evAsk,
    });
    try {
      const p = waitForAnswer(questionId);
      const withTimeout = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ask timeout')), 15000);
        p.then((v) => {
          clearTimeout(t);
          resolve(v);
        }).catch((e) => {
          clearTimeout(t);
          reject(e);
        });
      });
      askNote = await withTimeout;
    } catch (e: any) {
      askNote = { timeout: true, error: String(e?.message || e) };
    }
    if (abortCtrl?.signal.aborted) {
      const evCancelled: EventT = {
        ts: new Date().toISOString(),
        taskId,
        type: 'agent.run.cancelled',
        payload: { message: 'run cancelled' },
      };
      await appendEventToFile(taskId, evCancelled);
      broadcastToTask(taskId, {
        ts: new Date().toISOString(),
        type: 'message.appended',
        payload: evCancelled,
      });
      return;
    }
  }

  let content = '';
  if (provider.apiType === 'mock') {
    const envVarMock = provider.apiKeyEnvVar || 'DEVMINDS_MOCK_DIR';
    const ioDir = envVarMock ? process.env[envVarMock] : undefined;
    if (!ioDir) {
      throw new Error(`Mock io dir env var ${envVarMock} not set`);
    }
    const outPath = path.join(ioDir, `${taskId}.output`);
    if (await fileExists(outPath)) {
      content = await readText(outPath);
    } else {
      const p = (prompt || '').replace(/\s+/g, ' ').slice(0, 80);
      content = `mock:${model}:${p}`;
    }
  } else {
    content = await callProvider(provider.apiType, { provider, model, prompt, apiKey });
  }

  // Stream delta before final output (simulated chunking)
  const chunks: string[] = [];
  const CHUNK_SIZE = 80;
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }
  for (const delta of chunks) {
    if (abortCtrl?.signal.aborted) {
      const evCancelled: EventT = {
        ts: new Date().toISOString(),
        taskId,
        type: 'agent.run.cancelled',
        payload: { member: chosenMember.id, skill, providerId, model, message: 'run cancelled' },
      };
      await appendEventToFile(taskId, evCancelled);
      broadcastToTask(taskId, {
        ts: new Date().toISOString(),
        type: 'message.appended',
        payload: evCancelled,
      });
      return;
    }
    const evDelta: EventT = {
      ts: new Date().toISOString(),
      taskId,
      type: 'agent.run.delta',
      payload: {
        member: chosenMember.id,
        skill,
        providerId,
        model: provider.apiType === 'mock' ? 'test-model' : model,
        delta,
      },
    };
    try {
      console.debug(
        `[debug:evDelta] payload.model=${(evDelta as any).payload?.model} providerId=${providerId} skill=${skill}`,
      );
    } catch {}
    await appendEventToFile(taskId, evDelta);
    broadcastToTask(taskId, {
      ts: new Date().toISOString(),
      type: 'message.appended',
      payload: evDelta,
    });
    // small delay to simulate streaming pace
    await new Promise((r) => setTimeout(r, 30));
  }

  // Emit final output event with full content
  // Final abort check in case cancellation occurred after streaming
  if (abortCtrl?.signal.aborted) {
    const evCancelled: EventT = {
      ts: new Date().toISOString(),
      taskId,
      type: 'agent.run.cancelled',
      payload: { member: chosenMember.id, skill, providerId, model, message: 'run cancelled' },
    };
    await appendEventToFile(taskId, evCancelled);
    broadcastToTask(taskId, {
      ts: new Date().toISOString(),
      type: 'message.appended',
      payload: evCancelled,
    });
    return;
  }
  const nowIso = new Date().toISOString();
  const evOut: EventT = {
    ts: nowIso,
    taskId,
    type: 'agent.run.output',
    payload: {
      member: chosenMember.id,
      skill,
      providerId,
      model: provider.apiType === 'mock' ? 'test-model' : model,
      content: askNote ? `ask-note: ${JSON.stringify(askNote)}\n${content}` : content,
    },
  };
  try {
    console.debug(
      `[debug:evOut] payload.model=${(evOut as any).payload?.model} providerId=${providerId} skill=${skill}`,
    );
  } catch {}
  await appendEventToFile(taskId, evOut);
  broadcastToTask(taskId, {
    ts: new Date().toISOString(),
    type: 'message.appended',
    payload: evOut,
  });
}

const { runRealAgent: agentRunReal, runAskAwaitAgent: agentRunAskAwait } = createAgentRunners({
  paths,
  fileExists,
  readText,
  appendEventToFile,
  broadcastToTask,
  waitForAnswer,
  callProvider,
  providers: { loadProviderTemplate, loadRuntimeProviderConfig, mergeProviderConfigs },
});

async function startRun(taskId: string, promptOverride?: string, awaitAsk?: boolean) {
  const node = getOrCreateTaskNode(taskId);
  if (node.running) return; // already running
  node.running = true;
  node.cancelRequested = false;
  node.abortCtrl = new AbortController();
  stopAllWatchersForTask(taskId);
  node.state = 'run';

  // Real agent flow: started -> output -> finished
  (async () => {
    const startTs = Date.now();
    try {
      // started
      const nowIso = new Date().toISOString();
      const evStart: EventT = {
        ts: nowIso,
        taskId,
        type: 'agent.run.started',
        payload: { message: 'run started' },
      };
      await appendEventToFile(taskId, evStart);
      broadcastToTask(taskId, {
        ts: new Date().toISOString(),
        type: 'message.appended',
        payload: evStart,
      });

      // run agent once
      try {
        await agentRunReal(taskId, promptOverride, awaitAsk, node.abortCtrl);
      } catch (err: any) {
        const evErr: EventT = {
          ts: new Date().toISOString(),
          taskId,
          type: 'agent.run.error',
          payload: { message: String(err?.message || err) },
        };
        await appendEventToFile(taskId, evErr);
        broadcastToTask(taskId, {
          ts: new Date().toISOString(),
          type: 'message.appended',
          payload: evErr,
        });
      }
    } finally {
      // finished
      const evDone: EventT = {
        ts: new Date().toISOString(),
        taskId,
        type: 'agent.run.finished',
        payload: { durationMs: Date.now() - startTs },
      };
      await appendEventToFile(taskId, evDone);
      broadcastToTask(taskId, {
        ts: new Date().toISOString(),
        type: 'message.appended',
        payload: evDone,
      });

      // switch back to follow
      node.running = false;
      node.state = 'idle';
      node.abortCtrl = undefined;
      node.cancelRequested = false;
      await ensureFollow(taskId);
    }
  })();
}

/**
 * Ask-await run: emit ask.request(questionId), await response, then output
 * This is a minimal entry to e2e-verify the ask-await mechanism while keeping WS append-only.
 */
async function runAskAwaitAgent(taskId: string, abortCtrl?: AbortController) {
  const now = () => new Date().toISOString();

  // started
  const evStart: EventT = {
    ts: now(),
    taskId,
    type: 'agent.run.started',
    payload: { message: 'run-ask started' },
  };
  await appendEventToFile(taskId, evStart);
  broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evStart });

  // emit ask.request with questionId
  const questionId = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const evAsk: EventT = {
    ts: now(),
    taskId,
    type: 'agent.ask.request',
    payload: { question: 'Please provide your confirmation to proceed.', questionId },
  };
  await appendEventToFile(taskId, evAsk);
  broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evAsk });

  // wait for human answer with a soft timeout
  let answered: any = null;
  try {
    const p = waitForAnswer(questionId);
    const withTimeout = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ask timeout')), 15000);
      p.then((v) => {
        clearTimeout(t);
        resolve(v);
      }).catch((e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    answered = await withTimeout;
  } catch (e: any) {
    answered = { timeout: true, error: String(e?.message || e) };
  }

  if (abortCtrl?.signal.aborted) {
    const evCancelled: EventT = {
      ts: now(),
      taskId,
      type: 'agent.run.cancelled',
      payload: { message: 'run cancelled' },
    };
    await appendEventToFile(taskId, evCancelled);
    broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evCancelled });
    return;
  }

  // produce output including the received answer
  const evOut: EventT = {
    ts: now(),
    taskId,
    type: 'agent.run.output',
    payload: { content: `answer received: ${JSON.stringify(answered)}` },
  };
  await appendEventToFile(taskId, evOut);
  broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evOut });

  const evDone: EventT = {
    ts: now(),
    taskId,
    type: 'agent.run.finished',
    payload: { message: 'run-ask finished' },
  };
  await appendEventToFile(taskId, evDone);
  broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evDone });
}

/**
 * POST /api/tasks/:id/run - keep existing run trigger
 */
app.post('/api/tasks/:id/run', async (c) => {
  const taskId = c.req.param('id');
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {}
  const urlObj = new URL(c.req.url);
  const qFlag = urlObj.searchParams.get('awaitAsk');
  const awaitAsk =
    typeof body?.awaitAsk === 'boolean' ? body.awaitAsk : qFlag === '1' || qFlag === 'true';
  startRun(taskId, undefined, awaitAsk);
  return c.json({ ok: true, message: 'run started', awaitAsk: !!awaitAsk });
});

/**
 * POST /api/tasks/:id/run-ask - trigger a run that awaits a human answer
 * Minimal E2E entry for ask-await verification
 */
app.post('/api/tasks/:id/run-ask', async (c) => {
  const taskId = c.req.param('id');
  // fire-and-forget to keep minimal impact on existing startRun flow
  (async () => {
    try {
      await agentRunAskAwait(taskId);
    } catch (err) {
      const evErr: EventT = {
        ts: new Date().toISOString(),
        taskId,
        type: 'agent.run.error',
        payload: { message: String((err as any)?.message || err) },
      };
      await appendEventToFile(taskId, evErr);
      broadcastToTask(taskId, {
        ts: new Date().toISOString(),
        type: 'message.appended',
        payload: evErr,
      });
    }
  })();
  return c.json({ ok: true, message: 'run-ask started' });
});

/**
 * POST /api/tasks/:id/prompt - trigger a run with user-provided prompt override
 */
app.post('/api/tasks/:id/prompt', async (c) => {
  const taskId = c.req.param('id');
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {}
  const urlObj = new URL(c.req.url);
  const qFlag = urlObj.searchParams.get('awaitAsk');
  const prompt = typeof body?.prompt === 'string' ? body.prompt : undefined;
  const awaitAsk =
    typeof body?.awaitAsk === 'boolean' ? body.awaitAsk : qFlag === '1' || qFlag === 'true';
  startRun(taskId, prompt, awaitAsk);
  return c.json({ ok: true, message: 'prompt run started', awaitAsk: !!awaitAsk });
});

/**
 * POST /api/tasks/:id/cancel - request to cancel current run (if any)
 */
app.post('/api/tasks/:id/cancel', async (c) => {
  const taskId = c.req.param('id');
  const node = getOrCreateTaskNode(taskId);
  if (node.running && node.abortCtrl && !node.abortCtrl.signal.aborted) {
    node.cancelRequested = true;
    // emit request event
    const evReq: EventT = {
      ts: new Date().toISOString(),
      taskId,
      type: 'agent.run.cancel.requested',
      payload: { message: 'cancel requested' },
    };
    await appendEventToFile(taskId, evReq);
    broadcastToTask(taskId, {
      ts: new Date().toISOString(),
      type: 'message.appended',
      payload: evReq,
    });

    node.abortCtrl?.abort();
    return c.json({ ok: true, message: 'cancel sent' });
  }
  return c.json({ ok: false, message: 'no running task' }, 400);
});

/**
 * Task lifecycle helpers for M3
 */
async function createTaskTemplates(taskId: string) {
  const dir = paths.minds('tasks', taskId);
  await ensureDir(dir);
  const files = [
    { name: 'wip.md', content: '# WIP\n\n' },
    { name: 'plan.md', content: '# Plan\n\n' },
    { name: 'caveats.md', content: '# Caveats\n\n' },
  ];
  for (const f of files) {
    const fp = path.join(dir, f.name);
    try {
      await fs.writeFile(fp, f.content, 'utf8');
    } catch (err) {
      console.warn(`[task:${taskId}] failed to write ${f.name}:`, err);
    }
  }
}

async function deleteTaskTemplates(taskId: string) {
  const dir = paths.minds('tasks', taskId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[task:${taskId}] failed to remove templates dir:`, err);
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * POST /api/tasks
 * body: { id: string, name?: string }
 */
app.post('/api/tasks', async (c) => {
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {}
  const taskId = String(body?.id || '').trim();
  const name = typeof body?.name === 'string' ? body.name : undefined;
  if (!taskId) {
    return c.json({ ok: false, message: 'id is required' }, 400);
  }

  // Create templates and ensure logs dir
  await createTaskTemplates(taskId);
  await ensureDir(paths.tasklogs(taskId));

  // Emit created event
  const ev: EventT = {
    ts: nowIso(),
    taskId,
    type: 'task.lifecycle.created',
    payload: { name },
  };
  await appendEventToFile(taskId, ev);

  return c.json({ ok: true, message: 'task created', taskId });
});

/**
 * PATCH /api/tasks/:id
 * body: { name?: string }
 */
app.patch('/api/tasks/:id', async (c) => {
  const taskId = c.req.param('id');
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {}
  const name = typeof body?.name === 'string' ? body.name : undefined;

  // Ensure logs dir exists
  await ensureDir(paths.tasklogs(taskId));

  // Emit renamed event (no rename of id; only metadata change)
  const ev: EventT = {
    ts: nowIso(),
    taskId,
    type: 'task.lifecycle.renamed',
    payload: { name },
  };
  await appendEventToFile(taskId, ev);

  return c.json({ ok: true, message: 'task updated', taskId });
});

/**
 * DELETE /api/tasks/:id
 * Policy: remove templates, retain logs dir
 */
app.delete('/api/tasks/:id', async (c) => {
  const taskId = c.req.param('id');

  // Remove templates
  await deleteTaskTemplates(taskId);

  // Ensure logs dir exists (retain by policy)
  await ensureDir(paths.tasklogs(taskId));

  // Emit deleted event
  const ev: EventT = {
    ts: nowIso(),
    taskId,
    type: 'task.lifecycle.deleted',
    payload: { message: 'task deleted (templates removed, logs retained)' },
  };
  await appendEventToFile(taskId, ev);

  return c.json({ ok: true, message: 'task deleted', taskId });
});

/**
 * Ask minimal APIs: persist request/response events and update meta.json
 */

/**
 * Ask minimal APIs: persist request/response events and update meta.json
 */

/**
 * ToolRegistry integration for M3 verification
 * - register tools declaratively
 * - use registry.call(name, args) to execute
 */
const toolReg = new ToolRegistry();
toolReg.register({
  name: 'echo',
  description: 'Echo back provided message',
  parameters: [{ name: 'message', type: 'string', required: true, description: 'Text to echo' }],
  async execute(args: any) {
    const msg = String(args?.message ?? '').slice(0, 2000);
    if (!msg) throw new Error('message required');
    return { ok: true, echoed: msg };
  },
});

/**
 * POST /api/tasks/:id/tool/echo
 * Tool endpoint via ToolRegistry: append agent.tool.echo with payload+result
 */

// GET /api/tasks/:id/status - report current node state
app.get('/api/tasks/:id/status', async (c) => {
  const taskId = c.req.param('id');
  const status = getTaskStatus(taskId);
  return c.json({ ok: true, status });
});

const PORT = Number(process.env.PORT ?? 5175);
httpServer.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] bearer token = ${DEVMINDS_AUTH_KEY}`);
});
