import { test, expect } from '@playwright/test';

test.describe('Bakalari Status Calendar & Day Details', () => {
  test('renders status banner, month tabs, uptime/downtime percentages, calendar, and day details without overflow', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('Is Bakaláři down?');
    await expect(page.locator('.status-banner')).toBeVisible();
    await expect(page.locator('#calendar-heading')).toBeVisible();
    await expect(page.locator('.pct-up')).toContainText('% uptime');
    await expect(page.locator('.pct-down')).toContainText('% downtime');
    await expect(page.locator('.detail-panel')).toBeVisible();

    const dayCells = page.locator('.day-btn');
    expect(await dayCells.count()).toBeGreaterThanOrEqual(28);

    // Click a monitored day and verify the Day details panel updates
    const firstMonitored = page.locator('.day-btn[data-status="online"], .day-btn[data-status="offline"]').first();
    await firstMonitored.click();
    await expect(page.locator('#day-detail-live')).toContainText(/Online|Offline/);

    // Switch months directly via month tabs (September, October, November)
    const tabs = page.locator('.month-tab');
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    await tabs.first().click();
    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
    await tabs.last().click();
    await expect(tabs.last()).toHaveAttribute('aria-pressed', 'true');

    // Verify zero horizontal overflow
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
  });
});
