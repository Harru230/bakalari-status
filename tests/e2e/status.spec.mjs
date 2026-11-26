import { test, expect } from '@playwright/test';

test.describe('Bakalari Status Calendar & Timetable', () => {
  test('renders status page and navigates to 1:1 timetable with week tabs and lesson details without overflow', async ({ page }) => {
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

    // Switch months directly via month tabs
    const tabs = page.locator('.month-tab');
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    await tabs.first().click();
    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
    await tabs.last().click();
    await expect(tabs.last()).toHaveAttribute('aria-pressed', 'true');

    // Verify zero horizontal overflow on status page
    const statusOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(statusOverflow).toBe(false);

    // Click Timetable button and verify /timetable/ page
    await page.locator('a.header-btn', { hasText: 'Timetable' }).click();
    await expect(page).toHaveURL(/\/timetable\/?$/);
    await expect(page.locator('h1')).toHaveText('Timetable');
    await expect(page.locator('.tt-table')).toBeVisible();

    // Switch between Last week, Next week, Permanent, This week
    await page.locator('.tt-week-tab[data-week="last"]').click();
    await expect(page.locator('.tt-week-tab[data-week="last"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tt-week-tab[data-week="next"]').click();
    await expect(page.locator('.tt-week-tab[data-week="next"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tt-week-tab[data-week="permanent"]').click();
    await expect(page.locator('.tt-week-tab[data-week="permanent"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tt-week-tab[data-week="current"]').click();
    await expect(page.locator('.tt-week-tab[data-week="current"]')).toHaveAttribute('aria-pressed', 'true');

    // Verify class selector from 6th to 1st grade works cleanly
    const classPills = page.locator('.tt-class-pill');
    expect(await classPills.count()).toBeGreaterThanOrEqual(16);
    await expect(classPills.first()).toHaveText('6.A');
    await expect(classPills.last()).toHaveText('1.C');

    await classPills.first().click();
    await expect(classPills.first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tt-class-pill[data-available="true"]').first().click();

    // Click a lesson cell and check details card updates
    const firstLesson = page.locator('.tt-atom').first();
    await firstLesson.click();
    await expect(page.locator('.tt-detail-title')).toBeVisible();

    // Verify zero page-level horizontal overflow on timetable page
    const ttOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(ttOverflow).toBe(false);
    expect(errors).toEqual([]);
  });
});
