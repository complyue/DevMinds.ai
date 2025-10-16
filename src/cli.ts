#!/usr/bin/env node
/**
 * dminds-run: 单次运行 DevMinds 的 CLI
 * 选项：
 *   --task <id>        任务ID（必选）
 *   --prompt "<text>"  覆盖提示词
 *   --await-ask        运行中等待一次人类确认
 */
import path from 'path';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';
import { createAgentRunners } from './core/agent.js';
import { waitForAnswer, handleEventBusiness } from './core/events-business.js';
import { callProvider } from './providers/registry.js';
import {
  loadProviderTemplate,
  loadRuntimeProviderConfig,
  mergeProviderConfigs,
} from './core/providers.js';
import {
  appendEventToFile as evAppendEventToFile,
  configureEvents,
} from './core/events.js';

type Args = { task: string; prompt?: string; awaitAsk?: boolean };
function parseArgs(argv: string[]): Args {
  const out: Args = { task: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task' && argv[i+1]) { out.task = argv[++i]; continue; }
    if (a === '--prompt' && argv[i+1]) { out.prompt = argv[++i]; continue; }
    if (a === '--await-ask') { out.awaitAsk = true; continue; }
  }
  return out;
}

const repoRoot = process.cwd();
const paths = {
  minds: (...p: string[]) => path.join(repoRoot, '.minds', ...p),
  tasklogs: (...p: string[]) => path.join(repoRoot, '.tasklogs', ...p),
};

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }).catch(() => {}); }
async function fileExists(p: string) { try { await fs.access(p); return true; } catch { return false; } }
async function readText(p: string) { return fs.readFile(p, 'utf8'); }

configureEvents({ paths, broadcaster: () => {} });

async function appendEventToFile(taskId: string, ev: any) {
  await evAppendEventToFile(taskId, ev);
  try { handleEventBusiness(ev); } catch {}
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.task) {
    console.error('Usage: dminds-run --task <id> [--prompt "<text>"] [--await-ask]');
    process.exit(1);
  }
  await ensureDir(paths.tasklogs(args.task));
  const runners = createAgentRunners({
    paths,
    fileExists,
    readText,
    appendEventToFile,
    broadcastToTask: () => {},
    waitForAnswer,
    callProvider,
    providers: { loadProviderTemplate, loadRuntimeProviderConfig, mergeProviderConfigs },
  });

  try {
    if (args.awaitAsk) {
      await runners.runAskAwaitAgent(args.task);
    } else {
      await runners.runRealAgent(args.task, args.prompt, false);
    }
    console.log('Run finished.');
    process.exit(0);
  } catch (e: any) {
    console.error('Run failed:', e?.message || e);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(3);
});
