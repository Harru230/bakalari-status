import { test, expect } from '@playwright/test';

test.describe('Bakalari Status Calendar & Timetable', () => {
  test('renders status page and navigates to 1:1 timetable with light/dark theme and mobile day view', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const isMobile = testInfo.project.name === 'mobile-chrome';

    // Check dark and light color-scheme on status page first
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('Is Bakaláři down?');
    const statusDarkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(statusDarkBg).toBe('rgb(9, 9, 11)');

    await page.emulateMedia({ colorScheme: 'light' });
    const statusLightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(statusLightBg).toBe('rgb(244, 244, 245)');

    await expect(page.locator('.status-banner')).toBeVisible();
    await expect(page.locator('#calendar-heading')).toBeVisible();
    await expect(page.locator('.pct-up')).toContainText('% uptime');
    await expect(page.locator('.pct-down')).toContainText('% downtime');
    await expect(page.locator('.detail-panel')).toBeVisible();

    const dayCells = page.locator('.day-btn');
    expect(await dayCells.count()).toBeGreaterThanOrEqual(28);

    const firstMonitored = page.locator('.day-btn[data-status="online"], .day-btn[data-status="offline"]').first();
    await firstMonitored.click();
    await expect(page.locator('#day-detail-live')).toContainText(/Online|Offline/);

    const tabs = page.locator('.month-tab');
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    await tabs.first().click();
    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
    await tabs.last().click();
    await expect(tabs.last()).toHaveAttribute('aria-pressed', 'true');

    const statusOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(statusOverflow).toBe(false);

    // Click Timetable button and verify /timetable/
    await page.locator('a.header-btn', { hasText: 'Timetable' }).click();
    await expect(page).toHaveURL(/\/timetable\/?$/);
    await expect(page.locator('h1')).toHaveText('Timetable');

    if (isMobile) {
      await expect(page.locator('.tt-day-list')).toBeVisible();
      await expect(page.locator('.tt-day-tab')).toHaveCount(5);
      await page.locator('.tt-day-tab[data-day="2"]').click();
      await expect(page.locator('.tt-day-tab[data-day="2"]')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('.tt-layout-btn[data-layout="week"]').click();
      await expect(page.locator('.tt-table')).toBeVisible();
      await page.locator('.tt-layout-btn[data-layout="day"]').click();
      await expect(page.locator('.tt-day-list')).toBeVisible();
    } else {
      await expect(page.locator('.tt-table')).toBeVisible();
    }

    // Switch between Last week, Next week, Permanent, This week
    await page.locator('.tt-week-tab[data-week="last"]').click();
    await expect(page.locator('.tt-week-tab[data-week="last"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tt-week-tab[data-week="next"]').click();
    await expect(page.locator('.tt-week-tab[data-week="next"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tt-week-tab[data-week="permanent"]').click();
    await expect(page.locator('.tt-week-tab[data-week="permanent"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tt-week-tab[data-week="current"]').click();
    await expect(page.locator('.tt-week-tab[data-week="current"]')).toHaveAttribute('aria-pressed', 'true');

    // Verify class selector 6.A..1.C
    const classPills = page.locator('.tt-class-pill');
    expect(await classPills.count()).toBeGreaterThanOrEqual(16);
    await expect(classPills.first()).toHaveText('6.A');
    await expect(classPills.last()).toHaveText('1.C');

    // Public JSON files must never expose teacher personal data
    const [ttData, clsData] = await Promise.all([
      page.evaluate(async () => (await fetch('/data/timetable.json')).json()),
      page.evaluate(async () => (await fetch('/data/classes.json')).json()),
    ]);
    for (const week of Object.values(ttData.weeks || {})) {
      for (const day of week.days || []) {
        for (const atom of day.atoms || []) {
          expect(atom.teacherAbbrev).toBe('');
          expect(atom.teacherName).toBe('');
        }
      }
    }
    expect(Object.keys(clsData.classes || {}).length).toBe(16);
    for (const clsEntry of Object.values(clsData.classes || {})) {
      for (const day of clsEntry.permanent?.days || []) {
        for (const atom of day.atoms || []) {
          expect(atom.teacherAbbrev).toBe('');
          expect(atom.teacherName).toBe('');
        }
      }
    }

    // Switch to 6.B and verify dark/light adaptation of atoms + zero teacher exposure
    await page.locator('.tt-class-pill[data-class="6.B"]').click();
    await expect(page.locator('.tt-class-pill[data-class="6.B"]')).toHaveAttribute('aria-pressed', 'true');
    if (isMobile) {
      await page.locator('.tt-day-tab[data-day="1"]').click();
    }
    await expect(page.locator('.tt-atom').first()).toBeVisible();

    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(9, 9, 11)');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.tt-atom')).backgroundColor)).toBe('rgb(24, 24, 27)');

    await page.emulateMedia({ colorScheme: 'light' });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(244, 244, 245)');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.tt-atom')).backgroundColor)).toBe('rgb(255, 255, 255)');

    await page.locator('.tt-atom').first().click();
    await expect(page.locator('.tt-detail-title')).toBeVisible();
    await expect(page.locator('.tt-detail-term', { hasText: 'Teacher' })).toHaveCount(0);

    // Teachers tab: verify passphrase lock + optional unlock if TEST_VAULT_KEY set
    await page.locator('.tt-mode-tab[data-mode="teachers"]').click();
    await expect(page.locator('.tt-lock-form')).toBeVisible();
    await page.locator('.tt-lock-input').fill('wrong-passphrase-123');
    await page.locator('.tt-lock-submit').click();
    await expect(page.locator('.tt-lock-error')).toBeVisible();
    await expect(page.locator('.tt-lock-error')).toContainText('Incorrect passphrase');

    const vaultPass = process.env.TEST_VAULT_KEY || '';
    if (vaultPass) {
      await page.locator('.tt-lock-input').fill(vaultPass);
      await page.locator('.tt-lock-submit').click();
      await expect(page.locator('.tt-teacher-bar')).toBeVisible();
      const teacherPills = page.locator('.tt-teacher-pill');
      expect(await teacherPills.count()).toBeGreaterThanOrEqual(25);

      await page.locator('.tt-search-input').fill('FAR');
      await expect(page.locator('.tt-teacher-pill[data-teacher="FAR"]')).toBeVisible();
      await page.locator('.tt-teacher-pill[data-teacher="FAR"]').click();
      await expect(page.locator('.tt-teacher-heading')).toContainText('FAR');
      if (isMobile) {
        await expect(page.locator('.tt-day-list')).toBeVisible();
        await page.locator('.tt-day-tab[data-day="1"]').click();
      }
      await page.locator('.tt-atom').first().click();
      await expect(page.locator('.tt-detail-term', { hasText: 'Class' })).toBeVisible();

      await page.locator('.tt-lock-btn').click();
      await expect(page.locator('.tt-lock-form')).toBeVisible();
    }

    await page.locator('.tt-mode-tab[data-mode="classes"]').click();
    await page.locator('.tt-class-pill[data-available="true"]').first().click();
    await page.locator('.tt-atom').first().click();
    await expect(page.locator('.tt-detail-title')).toBeVisible();

    const ttOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(ttOverflow).toBe(false);
    expect(errors).toEqual([]);
  });
});
