import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';
import { watch } from 'fs';
import * as yaml from 'js-yaml';
import './providers/defaults.js';
import './providers/hooks.js';
import { callProvider } from './providers/registry.js';

const app = new Hono();

// Get __dirname equivalent in ES modules
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
async function loadProviderTemplate() {
  const templatePath = path.join(__dirname, '../config/known-providers.yaml');
  try {
    if (await fileExists(templatePath)) {
      const yamlContent = await readText(templatePath);
      const cfg = yaml.load(yamlContent) as any;
      // Ensure mock provider exists even when YAML is present
      if (!cfg?.providers) cfg.providers = {};
      if (!cfg.providers.mock) {
        cfg.providers.mock = {
          name: 'MockLLM',
          apiType: 'mock',
          baseUrl: '',
          models: ['test-model'],
          apiKeyEnvVar: 'DEVMINDS_MOCK_DIR',
        };
      }
      return cfg;
    }
  } catch (error) {
    console.warn('Failed to load provider template:', error);
  }

  // Fallback to minimal template if YAML loading fails
  return {
    providers: {
      openai: {
        name: 'OpenAI',
        apiType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'],
        apiKeyEnvVar: 'OPENAI_API_KEY',
      },
      anthropic: {
        name: 'Anthropic',
        apiType: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        models: ['claude-4-sonnet'],
        apiKeyEnvVar: 'ANTHROPIC_AUTH_TOKEN',
      },
      mock: {
        name: 'MockLLM',
        apiType: 'mock',
        baseUrl: '',
        models: ['test-model'],
        apiKeyEnvVar: 'DEVMINDS_MOCK_DIR', // points to a local IO directory for tests
      },
    },
  };
}

/**
 * Load runtime provider config from .minds/provider.yaml if present.
 */
async function loadRuntimeProviderConfig() {
  const runtimePath = paths.minds('provider.yaml');
  try {
    if (await fileExists(runtimePath)) {
      const yamlContent = await readText(runtimePath);
      if (yamlContent && yamlContent.trim().length > 0) {
        const doc = yaml.load(yamlContent) as any;
        if (doc && typeof doc === 'object') {
          return doc;
        }
      }
    }
  } catch (error) {
    console.warn('Failed to load runtime provider config:', error);
  }
  return null;
}

/**
 * Deep merge of provider configs: runtime overrides built-in.
 * - merges top-level fields
 * - for providers map, merges each provider object
 * - for arrays (e.g., models), uses runtime value if provided, otherwise built-in
 */
function mergeProviderConfigs(baseCfg: any, runtimeCfg: any) {
  if (!runtimeCfg) return { merged: baseCfg, hadRuntime: false };

  const isObject = (v: any) => v && typeof v === 'object' && !Array.isArray(v);

  const merge = (a: any, b: any): any => {
    if (Array.isArray(a) || Array.isArray(b)) {
      return b !== undefined ? b : a;
    }
    if (isObject(a) && isObject(b)) {
      const out: any = { ...a };
      for (const k of Object.keys(b)) {
        out[k] = merge(a[k], b[k]);
      }
      return out;
    }
    return b !== undefined ? b : a;
  };

  // Ensure providers maps exist
  const baseProviders = baseCfg?.providers && isObject(baseCfg.providers) ? baseCfg.providers : {};
  const runtimeProviders =
    runtimeCfg?.providers && isObject(runtimeCfg.providers) ? runtimeCfg.providers : {};

  const mergedProviders: any = { ...baseProviders };
  for (const pid of Object.keys(runtimeProviders)) {
    mergedProviders[pid] = merge(baseProviders[pid], runtimeProviders[pid]);
  }

  const mergedTop = merge(baseCfg, runtimeCfg);
  mergedTop.providers = mergedProviders;

  return { merged: mergedTop, hadRuntime: true };
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
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
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
 * GET /api/providers - Read providers config
 * Returns merged config with runtime overrides from .minds/provider.yaml when available.
 */
app.get('/api/providers', async (c) => {
  const template = await loadProviderTemplate();
  const runtime = await loadRuntimeProviderConfig();
  const { merged, hadRuntime } = mergeProviderConfigs(template, runtime);
  return c.json({ ok: true, config: merged, isBuiltIn: !hadRuntime, hasRuntime: hadRuntime });
});

/**
 * POST /api/providers/test - Test provider connectivity (no persistence)
 * Uses merged config so runtime overrides are respected.
 */
app.post('/api/providers/test', async (c) => {
  try {
    const body = await c.req.json();
    const { providerId, model } = body;

    if (!providerId) {
      return c.json({ ok: false, message: 'Missing providerId' }, 400);
    }

    // Use merged provider configuration
    const template = await loadProviderTemplate();
    const runtime = await loadRuntimeProviderConfig();
    const { merged } = mergeProviderConfigs(template, runtime);
    const provider = merged.providers?.[providerId];
    if (!provider) {
      return c.json({ ok: false, message: `Provider ${providerId} not found` }, 404);
    }

    // Get API key from environment variable (with defaults based on apiType)
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
      const isReachable = testUrl.protocol === 'https:' || testUrl.protocol === 'http:';

      if (!isReachable) {
        return c.json({ ok: false, message: 'Invalid URL format' });
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
      return c.json({ ok: false, message: 'Invalid baseUrl' }, 400);
    }
  } catch (err) {
    return c.json({ ok: false, message: 'Test failed' }, 500);
  }
});

// HTTP + WS server
const httpServer = createServer((req, res) => {
  // Delegate to Hono
  const handler = app.fetch as any;
  const urlStr = req.url ? `http://localhost${req.url}` : 'http://localhost/';
  const request = new Request(urlStr, {
    method: req.method,
    headers: req.headers as any,
    body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : (req as any),
    duplex: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : 'half',
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
      res.end('internal error');
    });
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
          await monitorEventFile(fp, taskId); // installs a watcher if not already
          // monitorEventFile uses global maps; we still track presence at node-level by reading global fileWatchers
          node.watchers.set(fp, fileWatchers.get(fp));
        }
      }
    }
    node.state = 'follow';
  } catch (err) {
    console.warn(`[task:${taskId}] ensureFollow failed:`, err);
  }
}

// File monitoring for real-time event broadcasting
const fileWatchers = new Map<string, any>();
const filePositions = new Map<string, number>();

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

    const watcher = watch(filePath, async (eventType) => {
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

            const newContent = buffer.toString('utf8');
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
              await monitorEventFile(filePath, taskId);
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
wss.on('connection', (ws: WebSocket, req: any) => {
  try {
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
  const day = ev.ts.slice(0, 10).replace(/-/g, '');
  const dir = paths.tasklogs(taskId);
  await ensureDir(dir);
  const file = path.join(dir, `events-${day}.jsonl`);
  const line = JSON.stringify(ev) + '\n';
  await fs.appendFile(file, line, 'utf8');
}

// Real agent runner
async function runRealAgent(
  taskId: string,
  promptOverride?: string,
  abortCtrl?: AbortController,
): Promise<void> {
  // Load merged provider config
  const template = await loadProviderTemplate();
  const runtime = await loadRuntimeProviderConfig();
  const { merged } = mergeProviderConfigs(template, runtime);

  // Resolve member and skill via team.md, and provider via skill def.md
  const team = await loadTaskTeam(taskId);
  if (!team.members || team.members.length === 0) {
    throw new Error('No members defined in team.md');
  }
  const chosenMember = team.defaultMember
    ? team.members.find((m) => m.id === team.defaultMember)
    : team.members[0];
  if (!chosenMember) {
    throw new Error('Default member not found in team.md');
  }
  const skill = chosenMember.skill;
  if (!skill) {
    throw new Error('Selected member has no skill');
  }
  const skillDef = await loadSkillDef(skill);
  const providerId: string = skillDef.providerId;
  const provider = merged.providers?.[providerId];
  if (!provider) {
    throw new Error(`Provider ${providerId} not found`);
  }
  const modelOverride: string | undefined = skillDef.model;

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
  const model: string =
    modelOverride ||
    provider.models?.[0] ||
    (provider.apiType === 'openai' ? 'gpt-5' : 'claude-4-sonnet');

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
      payload: { member: chosenMember.id, skill, providerId, model, delta },
    };
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
  const nowIso = new Date().toISOString();
  const evOut: EventT = {
    ts: nowIso,
    taskId,
    type: 'agent.run.output',
    payload: { member: chosenMember.id, skill, providerId, model, content },
  };
  await appendEventToFile(taskId, evOut);
  broadcastToTask(taskId, {
    ts: new Date().toISOString(),
    type: 'message.appended',
    payload: evOut,
  });
}

async function startRun(taskId: string, promptOverride?: string) {
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
        await runRealAgent(taskId, promptOverride, node.abortCtrl);
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
 * POST /api/tasks/:id/run - keep existing run trigger
 */
app.post('/api/tasks/:id/run', async (c) => {
  const taskId = c.req.param('id');
  startRun(taskId);
  return c.json({ ok: true, message: 'run started' });
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
  const prompt = typeof body?.prompt === 'string' ? body.prompt : undefined;
  startRun(taskId, prompt);
  return c.json({ ok: true, message: 'prompt run started' });
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

    node.abortCtrl.abort();
    return c.json({ ok: true, message: 'cancel sent' });
  }
  return c.json({ ok: false, message: 'no running task' }, 400);
});

// GET /api/tasks/:id/status - report current node state
app.get('/api/tasks/:id/status', async (c) => {
  const taskId = c.req.param('id');
  const status = getTaskStatus(taskId);
  return c.json({ ok: true, status });
});

const PORT = Number(process.env.PORT ?? 5175);
httpServer.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
});
