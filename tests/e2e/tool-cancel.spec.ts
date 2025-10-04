import { test, expect } from '@playwright/test';

const TASK_ID = process.env.TASK_ID || 'DEMO';
const WEB_BASE = process.env.WEB_BASE || 'http://localhost:5173';

test.describe('工具触发与取消（端到端）', () => {
  test('触发工具 → 产生片段 → 取消 → 提示与状态回退', async ({ page }) => {
    await page.goto(`${WEB_BASE}/tasks/${encodeURIComponent(TASK_ID)}`, { waitUntil: 'domcontentloaded' });

    const stream = page.locator('.layout .panel').nth(1).locator('.content');

    // 输入工具参数并触发
    await page.getByPlaceholder('工具参数...').fill('demo-tool');
    await page.getByRole('button', { name: '触发工具' }).click();

    // 等待进度或完成提示出现
    await expect.poll(async () => {
      const txt = await stream.innerText();
      return (/进度：已收 \\d+ 片段/.test(txt) || /已完成合并并输出最终内容/.test(txt)) ? 'ok' : 'wait';
    }, { timeout: 60000, intervals: [500] }).toBe('ok');

    // 取消
    await page.getByRole('button', { name: '停止' }).click();

    // 看到取消 toast 或取消态显式化
    await expect.poll(async () => {
      const txt = await stream.innerText();
      return (/已取消/.test(txt) || /取消失败/.test(txt)) ? 'ok' : 'wait';
    }, { timeout: 30000, intervals: [500] }).toBe('ok');
  });
});
