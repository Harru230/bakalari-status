import { test, expect } from '@playwright/test';

test.describe('Minimal Bakalari Status Calendar', () => {
  test('renders status header, monthly calendar grid, and fits mobile & desktop without overflow', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('Is Bakaláři down?');
    await expect(page.locator('.status-pill')).toBeVisible();
    await expect(page.locator('#calendar-heading')).toBeVisible();

    const dayCells = page.locator('.day-cell');
    expect(await dayCells.count()).toBeGreaterThanOrEqual(28);

    // Click a monitored day and verify the single-line summary updates
    const firstMonitored = page.locator('.day-cell[data-status="online"], .day-cell[data-status="offline"]').first();
    await firstMonitored.click();
    await expect(page.locator('#day-detail-live')).toContainText(/Online|Offline/);

    // Navigate to previous month and back to Today
    const prevBtn = page.locator('#nav-prev');
    if (await prevBtn.isEnabled()) {
      const beforeHeading = await page.locator('#calendar-heading').textContent();
      await prevBtn.click();
      await expect(page.locator('#calendar-heading')).not.toHaveText(beforeHeading || '');
      await page.locator('#nav-today').click();
      await expect(page.locator('#calendar-heading')).toHaveText(beforeHeading || '');
    }

    // Verify zero horizontal overflow
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
  });
});
