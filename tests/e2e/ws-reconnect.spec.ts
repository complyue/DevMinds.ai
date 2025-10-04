import { test, expect } from '@playwright/test';

const TASK_ID = process.env.TASK_ID || 'DEMO';
const WEB_BASE = process.env.WEB_BASE || 'http://localhost:5173';

test.describe('WS 重连与事件补齐（端到端）', () => {
  test('断后端 → 前端重连与恢复输出', async ({ page }) => {
    // 打开任务页
    await page.goto(`${WEB_BASE}/tasks/${encodeURIComponent(TASK_ID)}`, { waitUntil: 'domcontentloaded' });

    // 中间栏事件流面板（布局：左树/中流/右WIP）
    const stream = page.locator('.layout .panel').nth(1).locator('.content');

    // 点击“推进”触发运行
    await page.getByRole('button', { name: '推进' }).click();

    // 等待出现进度提示（已收 delta 片段）或最终完成提示，任意其一即可
    await expect.poll(async () => {
      const txt = await stream.innerText();
      return (/进度：已收 \d+ 片段/.test(txt) || /已完成合并并输出最终内容/.test(txt)) ? 'ok' : 'wait';
    }, { timeout: 60000, intervals: [500] }).toBe('ok');

    // 观察到断线后的“重连中”退避指示（amber）
    await expect.poll(async () => {
      const txt = await stream.innerText();
      return /重连中（第 \d+ 次，退避中）/.test(txt) ? 'ok' : 'wait';
    }, { timeout: 30000, intervals: [500] }).toBe('ok');

    // 后端重启后应恢复为“实时连接”（green），或直接进入“已完成合并并输出最终内容”
    await expect.poll(async () => {
      const txt = await stream.innerText();
      return (/实时连接/.test(txt) || /已完成合并并输出最终内容/.test(txt)) ? 'ok' : 'wait';
    }, { timeout: 60000, intervals: [500] }).toBe('ok');

    // 最终输出合并完成提示
    await expect.poll(async () => {
      const txt = await stream.innerText();
      return /已完成合并并输出最终内容/.test(txt) ? 'ok' : 'wait';
    }, { timeout: 30000, intervals: [500] }).toBe('ok');
  });
});
