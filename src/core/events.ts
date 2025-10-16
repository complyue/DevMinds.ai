import { promises as fs } from 'fs';
import path from 'path';
import { Buffer } from 'buffer';

type Paths = {
  minds: (...p: string[]) => string;
  tasklogs: (...p: string[]) => string;
};

let injectedPaths: Paths | null = null;
let broadcastToTask: ((taskId: string, msg: any) => void) | null = null;

export function configureEvents(cfg: {
  paths: Paths;
  broadcaster: (taskId: string, msg: any) => void;
}) {
  injectedPaths = cfg.paths;
  broadcastToTask = cfg.broadcaster;
}

// share watchers and file positions
export const fileWatchers = new Map<string, import('fs').FSWatcher>();
export const filePositions = new Map<string, number>();

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

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

async function atomicWriteJson(fp: string, obj: any) {
  const tmp = fp + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, fp);
}

async function updateMeta(taskId: string, ev: any) {
  const dir = injectedPaths!.tasklogs(taskId);
  await ensureDir(dir);
  const metaPath = path.join(dir, 'meta.json');
  let meta: any = {};
  try {
    if (await fileExists(metaPath)) {
      const txt = await readText(metaPath);
      if (txt && txt.trim()) meta = JSON.parse(txt);
    }
  } catch {}
  meta.taskId = taskId;
  meta.lastTs = ev.ts;
  meta.counts = meta.counts && typeof meta.counts === 'object' ? meta.counts : {};
  meta.counts[ev.type] = (meta.counts[ev.type] ?? 0) + 1;
  const MAX_RECENT = 50;
  const recent = Array.isArray(meta.recentTypes) ? meta.recentTypes : [];
  recent.push(ev.type);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
  meta.recentTypes = recent;
  await atomicWriteJson(metaPath, meta);
}

export async function appendEventToFile(taskId: string, ev: any) {
  if (!injectedPaths) throw new Error('events not configured');
  const day = String(ev.ts).slice(0, 10).replace(/-/g, '');
  const dir = injectedPaths.tasklogs(taskId);
  await ensureDir(dir);
  const file = path.join(dir, `events-${day}.jsonl`);
  const line = JSON.stringify(ev) + '\n';
  await fs.appendFile(file, line, 'utf8');
  try {
    await updateMeta(taskId, ev);
  } catch {}
  try {
    broadcastToTask?.(taskId, {
      ts: new Date().toISOString(),
      type: 'message.appended',
      payload: ev,
    });
  } catch {}
}

export async function monitorEventFile(filePath: string, taskId: string) {
  if (fileWatchers.has(filePath)) return;

  try {
    const stats = await fs.stat(filePath);
    filePositions.set(filePath, stats.size);

    const watcher = (await import('fs')).watch(filePath, async (eventType: string) => {
      if (eventType !== 'change') return;
      try {
        const currentStats = await fs.stat(filePath);
        const lastPosition = filePositions.get(filePath) || 0;

        if (currentStats.size > lastPosition) {
          const fileHandle = await fs.open(filePath, 'r');
          const buffer = Buffer.alloc(currentStats.size - lastPosition);
          await fileHandle.read(buffer, 0, buffer.length, lastPosition);
          await fileHandle.close();

          const newContent = Buffer.from(buffer).toString('utf8');
          const newLines = newContent.split(/\r?\n/).filter(Boolean);

          for (const line of newLines) {
            try {
              const event = JSON.parse(line);
              // 直接广播，按调用方决定是否还需要额外解析校验
              broadcastToTask?.(taskId, {
                ts: new Date().toISOString(),
                type: 'message.appended',
                payload: event,
              });
            } catch {}
          }

          filePositions.set(filePath, currentStats.size);
        }
      } catch {}
    });

    fileWatchers.set(filePath, watcher);
    // eslint-disable-next-line no-console
    console.log(`[file-monitor] Started monitoring ${filePath}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to start monitoring ${filePath}:`, err);
  }
}
