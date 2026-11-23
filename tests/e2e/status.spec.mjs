import { test, expect } from '@playwright/test';

test.describe('Minimal Bakalari Status Calendar', () => {
  test('renders status header, month tabs, uptime/downtime percentages, and calendar grid without overflow', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('Is Bakaláři down?');
    await expect(page.locator('.status-pill')).toBeVisible();
    await expect(page.locator('#calendar-heading')).toBeVisible();
    await expect(page.locator('.pct-up')).toContainText('% uptime');
    await expect(page.locator('.pct-down')).toContainText('% downtime');

    const dayCells = page.locator('.day-cell');
    expect(await dayCells.count()).toBeGreaterThanOrEqual(28);

    // Click a monitored day and verify the single-line summary updates
    const firstMonitored = page.locator('.day-cell[data-status="online"], .day-cell[data-status="offline"]').first();
    await firstMonitored.click();
    await expect(page.locator('#day-detail-live')).toContainText(/Online|Offline/);

    // Switch months directly via month tabs (e.g. September, October, November)
    const tabs = page.locator('.month-tab');
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    const firstTab = tabs.first();
    const lastTab = tabs.last();
    await firstTab.click();
    await expect(firstTab).toHaveAttribute('aria-pressed', 'true');
    await lastTab.click();
    await expect(lastTab).toHaveAttribute('aria-pressed', 'true');

    // Verify zero horizontal overflow
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
  });
});
