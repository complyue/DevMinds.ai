// @ts-check
import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

function genId(prefix = 'ASKUI') {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${t}_${r}`;
}

async function createTask(taskId: string) {
  const r = await fetch(`http://localhost:5175/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: taskId }),
  });
  if (!r.ok) throw new Error('create task failed');
}

async function sendWsAppend(taskId: string, payload: any) {
  const url = `ws://localhost:5175/ws/${encodeURIComponent(taskId)}`;
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('ws timeout'));
    }, 3000);
    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({ kind: 'append', event: payload }));
        setTimeout(() => {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve();
        }, 120);
      } catch (e) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(e);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(e);
    });
  });
}

test('Ask-await UI flow produces output with human answer', async ({ page }) => {
  const taskId = genId();

  // 1) Create task via backend API
  await createTask(taskId);

  // 2) Open task page
  await page.goto(`http://localhost:5173/tasks/${encodeURIComponent(taskId)}`);

  // 3) 勾选 Ask-await 并点击推进（拦截 run 请求，断言 awaitAsk=1）
  await expect(page.getByRole('button', { name: '推进' })).toBeVisible();
  const runReqPromise = page.waitForRequest((req) => {
    try {
      if (req.method() !== 'POST') return false;
      const u = new URL(req.url());
      return /\/api\/tasks\/[^/]+\/run$/.test(u.pathname);
    } catch { return false; }
  });
  await page.getByLabel('Ask-await').check();
  await page.waitForTimeout(120);
  await page.getByRole('button', { name: '推进' }).click();
  const runReq = await runReqPromise;
  {
    const u = new URL(runReq.url());
    expect(u.searchParams.get('awaitAsk')).toBe('1');
  }

  // 4) 从本地事件文件轮询提取最新 questionId（使用 UTC 日期，避免 UI 渲染时序影响）
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const evf = path.join(process.cwd(), 'tests/units/works/unit-ws/.tasklogs', taskId, `events-${ymd}.jsonl`);
  let questionId = '';
  for (let i = 0; i < 120; i++) { // up to ~24s
    try {
      if (fs.existsSync(evf)) {
        const txt = fs.readFileSync(evf, 'utf-8');
        const lines = txt.trim().split(/\r?\n/);
        for (let j = lines.length - 1; j >= 0; j--) {
          const line = lines[j];
          if (line.includes('"agent.ask.request"') && line.includes('"questionId"')) {
            const m = line.match(/"questionId":"([^"]+)"/);
            if (m) { questionId = m[1]; break; }
          }
        }
        if (questionId) break;
      }
    } catch {}
    await page.waitForTimeout(200);
  }
  if (!questionId) throw new Error('questionId not found from file within timeout');

  // 5) 通过 WS 回答
  const ts = new Date().toISOString();
  await sendWsAppend(taskId, {
    ts,
    taskId,
    type: 'agent.ask.response',
    payload: { questionId, answer: 'OK by human' },
  });

  // 6) 页面显示完成提示；并在本地事件文件中轮询确认输出包含“OK by human”
  await expect(page.getByText('已完成合并并输出最终内容')).toBeVisible({ timeout: 15000 });
  let okFound = false;
  for (let i = 0; i < 120; i++) { // up to ~24s
    try {
      if (fs.existsSync(evf)) {
        const txt = fs.readFileSync(evf, 'utf-8');
        if (txt.includes('"agent.run.output"') && txt.includes('OK by human')) {
          okFound = true;
          break;
        }
      }
    } catch {}
    await page.waitForTimeout(200);
  }
  expect(okFound).toBeTruthy();
});
