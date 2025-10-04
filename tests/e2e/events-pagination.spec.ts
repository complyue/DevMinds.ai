import { test, expect } from '@playwright/test';

const TASK_ID = process.env.TASK_ID || 'DEMO';
const WEB_BASE = process.env.WEB_BASE || 'http://localhost:5173';

test.describe('事件分页与日期过滤（端到端）', () => {
  test('设置过滤与翻页：offset变化与事件数提示更新', async ({ page }) => {
    await page.goto(`${WEB_BASE}/tasks/${encodeURIComponent(TASK_ID)}`, { waitUntil: 'domcontentloaded' });

    const stream = page.locator('.layout .panel').nth(1).locator('.content');

    // 初始读取事件数与 offset
    const getInfo = async () => {
      const txt = await stream.innerText();
      const countMatch = txt.match(/(\d+)\s*个事件/);
      const offMatch = txt.match(/offset:\s*(\d+)/);
      return {
        count: countMatch ? Number(countMatch[1]) : 0,
        offset: offMatch ? Number(offMatch[1]) : 0,
        txt,
      };
    };

    // 设置 limit=20，应用过滤
    await page.locator('label:has-text("limit")').locator('input[type="number"]').fill('20');
    await page.getByRole('button', { name: '应用过滤' }).click();

    await expect.poll(async () => {
      const { txt } = await getInfo();
      // 应用过滤后应显示事件数与 offset 提示区域
      return /个事件/.test(txt) && /offset:\s*\d+/.test(txt) ? 'ok' : 'wait';
    }, { timeout: 30000, intervals: [500] }).toBe('ok');

    const before = await getInfo();

    // 点击“下一页”，offset 应增加
    await page.getByRole('button', { name: '下一页' }).click();
    await expect.poll(async () => {
      const { offset } = await getInfo();
      return offset > before.offset ? 'ok' : 'wait';
    }, { timeout: 20000, intervals: [500] }).toBe('ok');

    const mid = await getInfo();

    // 点击“上一页”，offset 应减少（不小于0）
    await page.getByRole('button', { name: '上一页' }).click();
    await expect.poll(async () => {
      const { offset } = await getInfo();
      return offset <= mid.offset ? 'ok' : 'wait';
    }, { timeout: 20000, intervals: [500] }).toBe('ok');

    // 设置日期范围（使用当前日期作为 from/to），再次应用过滤
    const d = new Date();
    const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    await page.locator('label:has-text("dateFrom")').locator('input[type="text"]').fill(today);
    await page.locator('label:has-text("dateTo")').locator('input[type="text"]').fill(today);
    await page.getByRole('button', { name: '应用过滤' }).click();

    await expect.poll(async () => {
      const { offset } = await getInfo();
      // 应用过滤后应重置 offset 为 0
      return offset === 0 ? 'ok' : 'wait';
    }, { timeout: 20000, intervals: [500] }).toBe('ok');
  });
});
