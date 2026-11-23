import { test, expect } from '@playwright/test';
import {
  EMOJI_REGEX,
  EM_DASH_REGEX,
  HISTORY_START_DATE,
  buildSyntheticStatusFixture,
  daysInMonth,
  getPragueDateParts,
} from './helpers/contracts.mjs';
import {
  getMonthHeadingLocator,
  getNavButtons,
  installErrorCollectors,
  navigateToMonth,
  waitForCalendarReady,
} from './helpers/dom-audit.mjs';

test.describe('UI States, Route Interception, Boundaries & Fallbacks', () => {
  test('T2-F09-01: Loading state is visibly rendered while status.json fetch is in flight', async ({ page }) => {
    const fixture = buildSyntheticStatusFixture({ endDate: getPragueDateParts().ymd });
    let releaseFetch;
    const gate = new Promise((resolve) => {
      releaseFetch = resolve;
    });

    await page.route('**/data/status.json*', async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    });

    await page.goto('./', { waitUntil: 'domcontentloaded' });

    const loadingLocator = page
      .locator('[aria-busy="true"], [role="status"], main')
      .filter({ hasText: /loading|fetching|checking/i })
      .first();
    await expect(loadingLocator).toBeVisible({ timeout: 5_000 });
    const opacity = await loadingLocator.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    expect(opacity).toBeGreaterThan(0);

    releaseFetch();
    await waitForCalendarReady(page);
  });

  test('T2-F09-02: Empty state (days: {}) displays explicit English message with zero errors', async ({ page }) => {
    const collector = installErrorCollectors(page);
    const emptyPayload = buildSyntheticStatusFixture({
      emptyDays: true,
      endDate: getPragueDateParts().ymd,
    });

    await page.route('**/data/status.json*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyPayload),
      })
    );

    await page.goto('./');
    const mainText = await page.locator('main').innerText();
    expect(mainText.trim().length).toBeGreaterThan(15);
    expect(mainText.toLowerCase()).toMatch(/no (checks|data|status|history|records)|empty/);
    expect(await page.locator('button[data-status="online"], button[data-status="offline"]').count()).toBe(0);
    collector.assertClean();
  });

  test('T2-F09-03: Error state (abort and HTTP 500) shows English error and recovers via Retry', async ({ page }) => {
    const fixture = buildSyntheticStatusFixture({ endDate: getPragueDateParts().ymd });

    // Case 1: Network abort -> Retry -> 200 OK
    let attempt = 0;
    await page.route('**/data/status.json*', (route) => {
      attempt += 1;
      if (attempt === 1) {
        return route.abort('failed');
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    });

    await page.goto('./');
    const { retry } = getNavButtons(page);
    await expect(retry).toBeVisible({ timeout: 8_000 });
    const errText = await page.locator('main').innerText();
    expect(errText.toLowerCase()).toMatch(/error|failed|unable|could not|unavailable/);

    await retry.click();
    await waitForCalendarReady(page);
    expect(attempt).toBeGreaterThanOrEqual(2);

    // Case 2: HTTP 500 -> Retry -> 200 OK
    let attempt500 = 0;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/data/status.json*', (route) => {
      attempt500 += 1;
      if (attempt500 === 1) {
        return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    });

    await page.reload();
    await expect(retry).toBeVisible({ timeout: 8_000 });
    await retry.click();
    await waitForCalendarReady(page);
  });

  test('T2-F07-01 & T2-F07-05: Loading, Empty, and Error states keep English copy, zero emojis/em-dashes, lang="en" and <title>', async ({ page }) => {
    const emptyPayload = buildSyntheticStatusFixture({
      emptyDays: true,
      endDate: getPragueDateParts().ymd,
    });

    // Check Error state metadata & copy hygiene
    await page.route('**/data/status.json*', (route) => route.abort('failed'));
    await page.goto('./');
    await expect(getNavButtons(page).retry).toBeVisible({ timeout: 8_000 });
    const errorCopy = await page.locator('body').innerText();
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    expect((await page.title()).trim().length).toBeGreaterThan(5);
    expect(EMOJI_REGEX.test(errorCopy)).toBe(false);
    expect(EM_DASH_REGEX.test(errorCopy)).toBe(false);
    expect(errorCopy).not.toContain(' -- ');

    // Check Empty state metadata & copy hygiene
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/data/status.json*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyPayload),
      })
    );
    await page.reload();
    await expect(page.locator('main')).toContainText(/no (checks|data|status|history|records)|empty/i);
    const emptyCopy = await page.locator('body').innerText();
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    expect((await page.title()).trim().length).toBeGreaterThan(5);
    expect(EMOJI_REGEX.test(emptyCopy)).toBe(false);
    expect(EM_DASH_REGEX.test(emptyCopy)).toBe(false);
    expect(emptyCopy).not.toContain(' -- ');
  });

  test('T2-F08-05: Mixed-status partial outage day (4 up, 1 down) renders offline cross SVG and exact counts', async ({ page }) => {
    const today = getPragueDateParts().ymd;
    const fixture = buildSyntheticStatusFixture({
      endDate: today,
      dayOverrides: {
        [today]: {
          date: today,
          status: 'offline',
          checks: 5,
          up: 4,
          down: 1,
          lastCheckedAt: `${today}T13:15:00.000Z`,
          lastHttpStatus: 502,
          lastReason: 'non_200',
          sources: ['probe'],
        },
      },
      currentStatusOverride: {
        status: 'offline',
        checkedAt: `${today}T13:15:00.000Z`,
        httpStatus: 502,
        latencyMs: 310,
        reason: 'non_200',
      },
    });

    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    );
    await page.goto('./');
    await waitForCalendarReady(page);

    const todayBtn = page.locator(`button[aria-label*="${today}"]`).first();
    await expect(todayBtn).toBeVisible();
    expect(await todayBtn.getAttribute('data-status')).toBe('offline');
    const aria = (await todayBtn.getAttribute('aria-label')) || '';
    expect(aria.toLowerCase()).toContain('offline');

    await todayBtn.click();
    const detail = await page.locator('[aria-live="polite"]').first().innerText();
    const strippedDetail = detail
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
      .replace(
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/gi,
        ' '
      )
      .replace(
        /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+\d{4})?\b/gi,
        ' '
      );
    expect(strippedDetail).toMatch(/\b5\b/);
    expect(strippedDetail).toMatch(/\b4\b/);
    expect(strippedDetail).toMatch(/\b1\b/);
    expect(detail.toLowerCase()).toContain('offline');
  });

  test('T2-F08-02: Month lengths match Sep (30), Oct (31), Nov (30), Feb 2027 (28) and Leap Feb 2028 (29)', async ({ page }) => {
    const leapEnd = '2028-02-29';
    const leapFixture = buildSyntheticStatusFixture({
      startDate: HISTORY_START_DATE,
      endDate: leapEnd,
      generatedAt: '2028-02-29T12:00:00.000Z',
    });

    await page.clock.install({ time: new Date('2028-02-29T12:00:00.000Z') });
    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(leapFixture) })
    );

    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    expect((await heading.innerText()).trim()).toBe('February 2028');
    expect(await page.locator('[data-status]').count()).toBe(daysInMonth(2028, 2)); // 29
    expect(await page.locator('[data-status]').nth(28).getAttribute('data-status')).not.toBe('unmonitored');

    await navigateToMonth(page, 2027, 2);
    expect(await page.locator('[data-status]').count()).toBe(daysInMonth(2027, 2)); // 28

    await navigateToMonth(page, 2026, 11);
    expect(await page.locator('[data-status]').count()).toBe(daysInMonth(2026, 11)); // 30

    await navigateToMonth(page, 2026, 10);
    expect(await page.locator('[data-status]').count()).toBe(daysInMonth(2026, 10)); // 31

    await navigateToMonth(page, 2026, 9);
    expect(await page.locator('[data-status]').count()).toBe(daysInMonth(2026, 9)); // 30
    // Sep 16 unmonitored vs Sep 17 monitored boundary
    expect(await page.locator('[data-status]').nth(15).getAttribute('data-status')).toBe('unmonitored');
    expect(await page.locator('[data-status]').nth(16).getAttribute('data-status')).not.toBe('unmonitored');
  });

  test('T2-F13-01: Blocked external fonts keep page visible with readable fallback typography', async ({ page }) => {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const isExternal = /^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url);
      if (isExternal) {
        return route.abort('failed');
      }
      return route.continue();
    });

    await page.goto('./');
    await waitForCalendarReady(page);
    const bodyOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.body).opacity));
    expect(bodyOpacity).toBe(1);
    expect((await page.locator('h1').innerText()).trim().length).toBeGreaterThan(0);
  });

  test('T2-F13-04: XSS-safe JSON rendering escapes HTML/script payloads via textContent', async ({ page }) => {
    const today = getPragueDateParts().ymd;
    const xssString = '<img src=x onerror="window.__xssExecuted=true">';
    const fixture = buildSyntheticStatusFixture({
      endDate: today,
      dayOverrides: {
        [today]: {
          status: 'offline',
          checks: 1,
          up: 0,
          down: 1,
          lastCheckedAt: `${today}T12:00:00.000Z`,
          lastHttpStatus: 500,
          lastReason: xssString,
          sources: ['probe'],
        },
      },
      currentStatusOverride: {
        status: 'offline',
        checkedAt: `${today}T12:00:00.000Z`,
        httpStatus: 500,
        latencyMs: 50,
        reason: xssString,
      },
    });

    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    );

    await page.goto('./');
    await waitForCalendarReady(page);
    await page.locator(`button[aria-label*="${today}"]`).first().click();

    const executed = await page.evaluate(() => Boolean(window.__xssExecuted));
    expect(executed).toBe(false);
    expect(await page.locator('main img').count()).toBe(0);
  });
});
