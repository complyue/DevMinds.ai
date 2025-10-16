import path from 'path';

export type ProvidersAPI = {
  loadProviderTemplate: () => Promise<any>;
  loadRuntimeProviderConfig: (paths: { minds: (...p: string[]) => string }) => Promise<any>;
  mergeProviderConfigs: (baseCfg: any, runtimeCfg: any) => { merged: any; hadRuntime: boolean };
};

type Deps = {
  paths: { minds: (...p: string[]) => string; tasklogs: (...p: string[]) => string };
  fileExists: (p: string) => Promise<boolean>;
  readText: (p: string) => Promise<string>;
  appendEventToFile: (taskId: string, ev: any) => Promise<void>;
  broadcastToTask: (taskId: string, msg: any) => void;
  waitForAnswer: (qid: string) => Promise<any>;
  callProvider: (apiType: string, args: any) => Promise<any>;
  providers: ProvidersAPI;
};

export function createAgentRunners(deps: Deps) {
  const {
    paths,
    fileExists,
    readText,
    appendEventToFile,
    broadcastToTask,
    waitForAnswer,
    callProvider,
    providers,
  } = deps;

  async function runRealAgent(
    taskId: string,
    promptOverride?: string,
    awaitAsk?: boolean,
    abortCtrl?: AbortController,
  ): Promise<void> {
    const template = await providers.loadProviderTemplate();
    const runtime = await providers.loadRuntimeProviderConfig(paths);
    const { merged } = providers.mergeProviderConfigs(template, runtime);

    let chosenMember: { id: string; skill: string } | null = null;
    let providerId: string | null = null;
    let modelOverride: string | undefined = undefined;

    // Minimal member/skill resolution: prefer .minds/tasks/{id}/wip.md content only (server keeps original detail)
    // For compatibility, fallback to mock if anything missing.
    try {
      // keep compatibility with server's original behavior:
      // choose first member from team.md if present; otherwise fallback to mock
      // Here we just fallback to mock to avoid coupling in this module.
      chosenMember = { id: 'mock', skill: 'mock' };
      providerId = 'mock';
    } catch {
      chosenMember = { id: 'mock', skill: 'mock' };
      providerId = 'mock';
    }

    const provider = merged.providers?.[providerId!];
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    // Build prompt (use wip.md when available and no override)
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
    let model: string;
    if (provider.apiType === 'mock') {
      model = 'test-model';
    } else {
      model =
        modelOverride ||
        provider.models?.[0] ||
        (provider.apiType === 'openai' ? 'gpt-5' : 'claude-4-sonnet');
    }

    let content = '';
    if (provider.apiType === 'mock') {
      const envVarMock = provider.apiKeyEnvVar || 'DEVMINDS_MOCK_DIR';
      const ioDir = envVarMock ? (process.env as any)[envVarMock] : undefined;
      if (!ioDir) throw new Error(`Mock io dir env var ${envVarMock} not set`);
      const outPath = path.join(ioDir, `${taskId}.output`);
      if (await fileExists(outPath)) {
        content = await readText(outPath);
      } else {
        const p = (prompt || '').replace(/\s+/g, ' ').slice(0, 80);
        content = `mock:${model}:${p}`;
      }
    } else {
      const apiKeyEnv =
        provider.apiKeyEnvVar ||
        (provider.apiType === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_AUTH_TOKEN');
      const apiKey = apiKeyEnv ? (process.env as any)[apiKeyEnv] : undefined;
      if (!apiKey) throw new Error(`Env ${apiKeyEnv} not set`);
      content = await callProvider(provider.apiType, { provider, model, prompt, apiKey, baseUrl });
    }

    const chunks: string[] = [];
    const CHUNK_SIZE = 80;
    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      chunks.push(content.slice(i, i + CHUNK_SIZE));
    }
    for (const delta of chunks) {
      if (abortCtrl?.signal.aborted) {
        const evCancelled = {
          ts: new Date().toISOString(),
          taskId,
          type: 'agent.run.cancelled',
          payload: {
            member: chosenMember.id,
            skill: chosenMember.skill,
            providerId,
            model,
            message: 'run cancelled',
          },
        };
        await appendEventToFile(taskId, evCancelled);
        broadcastToTask(taskId, {
          ts: new Date().toISOString(),
          type: 'message.appended',
          payload: evCancelled,
        });
        return;
      }
      const evDelta = {
        ts: new Date().toISOString(),
        taskId,
        type: 'agent.run.delta',
        payload: {
          member: chosenMember.id,
          skill: chosenMember.skill,
          providerId,
          model: provider.apiType === 'mock' ? 'test-model' : model,
          delta,
        },
      };
      await appendEventToFile(taskId, evDelta);
      broadcastToTask(taskId, {
        ts: new Date().toISOString(),
        type: 'message.appended',
        payload: evDelta,
      });
      await new Promise((r) => setTimeout(r, 30));
    }

    if (abortCtrl?.signal.aborted) {
      const evCancelled = {
        ts: new Date().toISOString(),
        taskId,
        type: 'agent.run.cancelled',
        payload: {
          member: chosenMember.id,
          skill: chosenMember.skill,
          providerId,
          model,
          message: 'run cancelled',
        },
      };
      await appendEventToFile(taskId, evCancelled);
      broadcastToTask(taskId, {
        ts: new Date().toISOString(),
        type: 'message.appended',
        payload: evCancelled,
      });
      return;
    }
    const evOut = {
      ts: new Date().toISOString(),
      taskId,
      type: 'agent.run.output',
      payload: {
        member: chosenMember.id,
        skill: chosenMember.skill,
        providerId,
        model: provider.apiType === 'mock' ? 'test-model' : model,
        content,
      },
    };
    await appendEventToFile(taskId, evOut);
    broadcastToTask(taskId, {
      ts: new Date().toISOString(),
      type: 'message.appended',
      payload: evOut,
    });
  }

  async function runAskAwaitAgent(taskId: string, abortCtrl?: AbortController) {
    const now = () => new Date().toISOString();
    const evStart = {
      ts: now(),
      taskId,
      type: 'agent.run.started',
      payload: { message: 'run-ask started' },
    };
    await appendEventToFile(taskId, evStart);
    broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evStart });

    const questionId = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const evAsk = {
      ts: now(),
      taskId,
      type: 'agent.ask.request',
      payload: { question: 'Please provide your confirmation to proceed.', questionId },
    };
    await appendEventToFile(taskId, evAsk);
    broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evAsk });

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
      const evCancelled = {
        ts: now(),
        taskId,
        type: 'agent.run.cancelled',
        payload: { message: 'run cancelled' },
      };
      await appendEventToFile(taskId, evCancelled);
      broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evCancelled });
      return;
    }

    const evOut = {
      ts: now(),
      taskId,
      type: 'agent.run.output',
      payload: { content: `answer received: ${JSON.stringify(answered)}` },
    };
    await appendEventToFile(taskId, evOut);
    broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evOut });

    const evDone = {
      ts: now(),
      taskId,
      type: 'agent.run.finished',
      payload: { message: 'run-ask finished' },
    };
    await appendEventToFile(taskId, evDone);
    broadcastToTask(taskId, { ts: now(), type: 'message.appended', payload: evDone });
  }

  return { runRealAgent, runAskAwaitAgent };
}
