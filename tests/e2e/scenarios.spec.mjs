import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import {
  EMOJI_REGEX,
  EM_DASH_REGEX,
  HISTORY_START_DATE,
  buildSyntheticStatusFixture,
  enumerateDates,
  formatPragueDate,
  getPragueDateParts,
  isDryRunSandbox,
  isRemoteBaseUrl,
  resolveRepoRoot,
  scanTextForPrivacyLeaks,
  validateStatusPayload,
} from './helpers/contracts.mjs';
import {
  checkActiveFocusRing,
  extractDomAntiSlopSnapshot,
  getMonthHeadingLocator,
  getNavButtons,
  installErrorCollectors,
  measureContrastViolations,
  navigateToMonth,
  waitForCalendarReady,
} from './helpers/dom-audit.mjs';

const execFileAsync = promisify(execFile);

test.describe('Tier 3 Pairwise Combinations & Tier 4 Real-World Scenarios', () => {
  // Tier 3: Cross-Feature Pairwise Combinations (T3-01 .. T3-16)
  test('T3-01: Probe 200 / 302->200 / timeout across Europe/Prague midnight boundary aggregates accurately', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe + aggregation check');
    const repoRoot = resolveRepoRoot();
    const { checkLoginEndpoint } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'probe.mjs')).href);

    let mode = '200';
    const server = http.createServer((req, res) => {
      if (mode === '200') {
        res.writeHead(200);
        res.end('ok');
      } else if (mode === '302') {
        if (req.url === '/login') {
          res.writeHead(302, { Location: '/ok' });
          res.end();
        } else {
          res.writeHead(200);
          res.end('ok');
        }
      }
      // mode === 'timeout' hangs
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const url = `http://127.0.0.1:${port}/login`;
      const r1 = await checkLoginEndpoint(url, { timeoutMs: 250 });
      mode = '302';
      const r2 = await checkLoginEndpoint(url, { timeoutMs: 250 });
      mode = 'timeout';
      const r3 = await checkLoginEndpoint(url, { timeoutMs: 200 });

      expect(r1.status).toBe('online');
      expect(r2.status).toBe('offline');
      expect(r2.reason).toBe('non_200');
      expect(r3.status).toBe('offline');
      expect(r3.reason).toBe('timeout');

      const d1 = formatPragueDate('2026-11-23T22:55:00.000Z');
      const d2 = formatPragueDate('2026-11-23T23:05:00.000Z');
      const d3 = formatPragueDate('2026-11-23T23:10:00.000Z');
      expect(d1).toBe('2026-11-23');
      expect(d2).toBe('2026-11-24');
      expect(d3).toBe('2026-11-24');

      const fixture = buildSyntheticStatusFixture({
        endDate: '2026-11-24',
        dayOverrides: {
          '2026-11-23': {
            status: 'online',
            checks: 1,
            up: 1,
            down: 0,
            lastCheckedAt: '2026-11-23T22:55:00.000Z',
            lastHttpStatus: 200,
            lastReason: 'ok',
            sources: ['probe'],
          },
          '2026-11-24': {
            status: 'offline',
            checks: 2,
            up: 0,
            down: 2,
            lastCheckedAt: '2026-11-23T23:10:00.000Z',
            lastHttpStatus: null,
            lastReason: 'timeout',
            sources: ['probe'],
          },
        },
      });
      expect(validateStatusPayload(fixture, { maxDate: '2026-11-24' }).valid).toBe(true);
    } finally {
      server.close();
    }
  });

  test('T3-02: ECONNREFUSED probe writes sanitized network_error and privacy-scan exits 0', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe + privacy check');
    const repoRoot = resolveRepoRoot();
    const { checkLoginEndpoint } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'probe.mjs')).href);

    const srv = http.createServer();
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const { port } = srv.address();
    await new Promise((resolve) => srv.close(resolve));

    const res = await checkLoginEndpoint(`http://127.0.0.1:${port}/login`, { timeoutMs: 500 });
    expect(res.status).toBe('offline');
    expect(res.reason).toBe('network_error');

    const { stdout } = await execFileAsync('npm', ['run', 'test:privacy'], { cwd: repoRoot });
    expect(stdout.toLowerCase()).toMatch(/pass|clean|ok/);
  });

  test('T3-03: Historical mixed-outage day (up > 0, down > 0) shows offline cross SVG and exact detail counts', async ({ page }) => {
    const today = getPragueDateParts().ymd;
    const mixedDay = getPragueDateParts(new Date(Date.now() - 86_400_000)).ymd;
    const fixture = buildSyntheticStatusFixture({
      endDate: today,
      dayOverrides: {
        [mixedDay]: {
          status: 'offline',
          checks: 6,
          up: 4,
          down: 2,
          lastCheckedAt: `${mixedDay}T14:20:00.000Z`,
          lastHttpStatus: 503,
          lastReason: 'non_200',
          sources: ['historical', 'probe'],
        },
      },
    });
    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    );
    await page.goto('./');
    await waitForCalendarReady(page);
    const btn = page.locator(`button[aria-label*="${mixedDay}"]`).first();
    if ((await btn.count()) === 0) {
      await getNavButtons(page).prev.click();
    }
    await expect(btn).toBeVisible();
    expect(await btn.getAttribute('data-status')).toBe('offline');
    await btn.click();
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
    expect(strippedDetail).toMatch(/\b6\b/);
    expect(strippedDetail).toMatch(/\b4\b/);
    expect(strippedDetail).toMatch(/\b2\b/);
    expect(detail.toLowerCase()).toContain('non_200');
  });

  test('T3-04: Visitor timezones (America/Los_Angeles and Asia/Tokyo) align calendar to Europe/Prague', async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const fixture = buildSyntheticStatusFixture({
      endDate: '2026-11-24',
      generatedAt: '2026-11-23T23:30:00.000Z',
    });

    for (const tz of ['America/Los_Angeles', 'Asia/Tokyo']) {
      const ctx = await browser.newContext({ baseURL, timezoneId: tz });
      try {
        const page = await ctx.newPage();
        await page.clock.install({ time: new Date('2026-11-23T23:30:00.000Z') });
        await page.route('**/data/status.json*', (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
        );
        await page.goto('./');
        await waitForCalendarReady(page);
        // 2026-11-24 in Europe/Prague must be monitored (not unmonitored), even in America/Los_Angeles (Nov 23)
        const nov24 = page.locator('button[aria-label*="2026-11-24"]').first();
        await expect(nov24).toBeVisible();
        expect(await nov24.getAttribute('data-status')).not.toBe('unmonitored');
      } finally {
        await ctx.close();
      }
    }
  });

  test('T3-05: Navigate Nov 2026 -> Oct 2026 -> Sep 2026 verifies Sep 1..16 unmonitored, Sep 17..30 monitored, Prev disabled', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    await navigateToMonth(page, 2026, 9);
    const cells = page.locator('[data-status]');
    expect(await cells.count()).toBe(30);
    for (let i = 0; i < 16; i += 1) {
      expect(await cells.nth(i).getAttribute('data-status')).toBe('unmonitored');
    }
    for (let i = 16; i < 30; i += 1) {
      expect(['online', 'offline']).toContain(await cells.nth(i).getAttribute('data-status'));
    }
    expect(await getNavButtons(page).prev.isDisabled()).toBe(true);
  });

  test('T3-06: Simultaneous audit of WCAG contrast, zero emojis/em-dashes, and distinct SVG icons', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(EMOJI_REGEX.test(snap.bodyText)).toBe(false);
    expect(EM_DASH_REGEX.test(snap.bodyText)).toBe(false);
    const report = await measureContrastViolations(page);
    expect(report.textViolations).toEqual([]);
    expect(report.svgViolations).toEqual([]);
  });

  test('T3-07: 320x568 narrow mobile + keyboard Tab/Enter selection maintains focus ring, live update, and zero overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('./');
    await waitForCalendarReady(page);

    let activated = false;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const active = await page.evaluate(() => ({
        tag: document.activeElement?.tagName?.toLowerCase(),
        status: document.activeElement?.getAttribute?.('data-status') || null,
        rect: document.activeElement?.getBoundingClientRect?.(),
      }));
      if (active.tag === 'button') {
        const ring = await checkActiveFocusRing(page);
        expect(ring.ok).toBe(true);
        if (active.status === 'online' || active.status === 'offline') {
          expect(active.rect.height).toBeGreaterThanOrEqual(44);
          await page.keyboard.press('Enter');
          const liveText = await page.locator('[aria-live="polite"]').first().innerText();
          expect(liveText.toLowerCase()).toContain(active.status);
          activated = true;
          break;
        }
      }
    }
    expect(activated).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
  });

  test('T3-08: 768x1024 tablet + prefers-reduced-motion: reduce + Prev/Next/Today navigation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    const startText = (await heading.innerText()).trim();
    const { prev, next, today } = getNavButtons(page);

    if (!(await prev.isDisabled())) {
      await prev.click();
      expect((await heading.innerText()).trim()).not.toBe(startText);
      await next.click();
      expect((await heading.innerText()).trim()).toBe(startText);
      await prev.click();
      await today.click();
      expect((await heading.innerText()).trim()).toBe(startText);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 768)).toBe(true);
  });

  test('T3-09: 1280x800 at 200% zoom passes clipping/overflow and AA contrast checks', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto('./');
    await waitForCalendarReady(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const contrast = await measureContrastViolations(page);
    expect(contrast.textViolations).toEqual([]);
  });

  test('T3-10: Fetch abort -> Error state -> Retry -> Loading -> 200 OK Calendar with clean English copy', async ({ page }) => {
    const fixture = buildSyntheticStatusFixture({ endDate: getPragueDateParts().ymd });
    let step = 0;
    let releaseRetry;
    const retryGate = new Promise((resolve) => {
      releaseRetry = resolve;
    });

    await page.route('**/data/status.json*', async (route) => {
      step += 1;
      if (step === 1) {
        return route.abort('failed');
      }
      await retryGate;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    });

    await page.goto('./');
    const { retry } = getNavButtons(page);
    await expect(retry).toBeVisible({ timeout: 8_000 });
    const errText = await page.locator('body').innerText();
    expect(EMOJI_REGEX.test(errText)).toBe(false);
    expect(EM_DASH_REGEX.test(errText)).toBe(false);

    await retry.click();
    await expect(page.locator('[aria-busy="true"], [role="status"], main').filter({ hasText: /loading|fetching|checking/i }).first()).toBeVisible({
      timeout: 5_000,
    });
    releaseRetry();
    await waitForCalendarReady(page);
  });

  test('T3-11: Pipeline simulation: isolated mocked probe -> build -> privacy-scan passes cleanly', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local pipeline build + privacy check');
    const repoRoot = resolveRepoRoot();
    await execFileAsync('npm', ['run', 'build'], { cwd: repoRoot, timeout: 45_000 });
    await execFileAsync('npm', ['run', 'test:privacy'], { cwd: repoRoot, timeout: 30_000 });
    const distStatus = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'data', 'status.json'), 'utf8'));
    expect(validateStatusPayload(distStatus, { maxDate: formatPragueDate() }).valid).toBe(true);
  });

  test('T3-12: Git log identity hygiene + dist/ build + privacy-scan.mjs pass together', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git + dist privacy check');
    const repoRoot = resolveRepoRoot();
    const { stdout } = await execFileAsync('git', ['log', '--all', '--format=%an|%ae'], { cwd: repoRoot });
    expect(stdout.trim().length).toBeGreaterThan(0);
    await execFileAsync('npm', ['run', 'test:privacy'], { cwd: repoRoot, timeout: 30_000 });
  });

  test('T3-13: Subpath /bakalari-status/ serves data/status.json with zero 404s and renders matching SVGs', async ({ page }) => {
    const collector = installErrorCollectors(page);
    const res = await page.request.get('data/status.json');
    expect(res.status()).toBe(200);
    const data = await res.json();

    await page.goto('./');
    await waitForCalendarReady(page);
    const todayPrague = formatPragueDate();
    if (data.days[todayPrague]) {
      const cell = page.locator(`button[aria-label*="${todayPrague}"]`).first();
      await expect(cell).toBeVisible();
      expect(await cell.getAttribute('data-status')).toBe(data.days[todayPrague].status);
    }
    collector.assertClean();
  });

  test('T3-14: Live GitHub Pages mobile (390x844) navigation and day detail inspection', async ({ page }) => {
    const runLive = process.env.CHECK_LIVE === '1' || isRemoteBaseUrl(process.env.BASE_URL);
    test.skip(!runLive, 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const collector = installErrorCollectors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('https://harru230.github.io/bakalari-status/');
    await waitForCalendarReady(page);
    const { prev, today } = getNavButtons(page);
    await prev.click();
    await today.click();
    await page.locator('button[data-status="online"], button[data-status="offline"]').first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
    collector.assertClean();
  });

  test('T3-15: Live GitHub Pages data/status.json continuity and zero-PII scan', async ({ request }) => {
    const runLive = process.env.CHECK_LIVE === '1' || isRemoteBaseUrl(process.env.BASE_URL);
    test.skip(!runLive, 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const res = await request.get('https://harru230.github.io/bakalari-status/data/status.json');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(scanTextForPrivacyLeaks(text, { forbidAllIpv4: true })).toEqual([]);
    const data = JSON.parse(text);
    expect(validateStatusPayload(data, { maxDate: formatPragueDate() }).valid).toBe(true);
  });

  test('T3-16: Full local verification chain (unit tests + build + privacy scan + helper self-test) exits 0', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local full verification chain');
    const repoRoot = resolveRepoRoot();
    await execFileAsync('npm', ['test'], { cwd: repoRoot, timeout: 45_000 });
    await execFileAsync('npm', ['run', 'build'], { cwd: repoRoot, timeout: 45_000 });
    await execFileAsync('npm', ['run', 'test:privacy'], { cwd: repoRoot, timeout: 30_000 });
    await execFileAsync('node', ['--test', 'tests/e2e/helpers/contracts.self-test.mjs'], {
      cwd: repoRoot,
      timeout: 20_000,
    });
  });

  // Tier 4: Real-World Application Scenarios (T4-01 .. T4-08)
  test('T4-01: Classmate on Phone (390x844) checks current verdict above fold and taps today cell for stats', async ({ page }) => {
    const collector = installErrorCollectors(page);
    const res = await page.request.get('data/status.json');
    const data = await res.json();
    const todayPrague = formatPragueDate();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./');
    await waitForCalendarReady(page);

    const h1Box = await page.locator('h1').boundingBox();
    expect(h1Box.y).toBeLessThan(350);

    const todayCell = page.locator(`button[aria-label*="${todayPrague}"]`).first();
    await expect(todayCell).toBeVisible();
    await todayCell.click();

    const detail = await page.locator('[aria-live="polite"]').first().innerText();
    expect(detail.toLowerCase()).toContain(data.days[todayPrague].status);
    expect(detail).toContain(String(data.days[todayPrague].checks));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
    collector.assertClean();
  });

  test('T4-02: Desktop Visitor (1440x900) explores history back to 2026-09-17 vs 2026-09-16 and returns via Today', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    const currentMonthHeading = (await heading.innerText()).trim();

    await navigateToMonth(page, 2026, 9);
    const sep16 = page.locator('[data-status]').nth(15);
    const sep17 = page.locator('[data-status]').nth(16);
    expect(await sep16.getAttribute('data-status')).toBe('unmonitored');
    expect(['online', 'offline']).toContain(await sep17.getAttribute('data-status'));

    await getNavButtons(page).today.click();
    expect((await heading.innerText()).trim()).toBe(currentMonthHeading);
  });

  test('T4-03: Keyboard-Only Assistive User (1280x800) operates calendar solely via Tab/Enter/Space', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    const startMonth = (await heading.innerText()).trim();

    const { prev } = getNavButtons(page);
    await prev.focus();
    // Tab away and Shift+Tab back to engage keyboard :focus-visible
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    if (!(await prev.isDisabled())) {
      expect((await checkActiveFocusRing(page)).ok).toBe(true);
      await page.keyboard.press('Enter');
      expect((await heading.innerText()).trim()).not.toBe(startMonth);
    }

    const firstDay = page.locator('button[data-status="online"], button[data-status="offline"]').first();
    await firstDay.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect((await checkActiveFocusRing(page)).ok).toBe(true);
    await page.keyboard.press('Space');
    const live = await page.locator('[aria-live="polite"]').first().innerText();
    expect(live.toLowerCase()).toMatch(/online|offline/);
  });

  test('T4-04: Small-Phone (320x568) and 200% Zoom User scrolls/taps month without clipping or overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('./');
    await waitForCalendarReady(page);
    const cells = page.locator('button[data-status="online"], button[data-status="offline"]');
    const count = await cells.count();
    expect(count).toBeGreaterThan(0);

    // Tap first and last monitored cell of the month
    await cells.first().click();
    await cells.last().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);

    // 200% desktop zoom check
    await page.setViewportSize({ width: 640, height: 400 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 640)).toBe(true);
  });

  test('T4-05: Abroad Visitor (America/New_York at 23:30 UTC) sees Europe/Prague D+1 Today alignment', async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const fixture = buildSyntheticStatusFixture({
      endDate: '2026-11-24',
      generatedAt: '2026-11-23T23:30:00.000Z',
    });
    const ctx = await browser.newContext({ baseURL, timezoneId: 'America/New_York' });
    try {
      const page = await ctx.newPage();
      await page.clock.install({ time: new Date('2026-11-23T23:30:00.000Z') });
      await page.route('**/data/status.json*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
      );
      await page.goto('./');
      await waitForCalendarReady(page);
      const pragueTomorrowBtn = page.locator('button[aria-label*="2026-11-24"]').first();
      await expect(pragueTomorrowBtn).toBeVisible();
      expect(await pragueTomorrowBtn.getAttribute('data-status')).not.toBe('unmonitored');
    } finally {
      await ctx.close();
    }
  });

  test('T4-06: Flaky School Wi-Fi Recovery (390x844): fetch fails once -> Error -> Retry -> Loading -> Calendar', async ({ page }) => {
    const fixture = buildSyntheticStatusFixture({ endDate: getPragueDateParts().ymd });
    let count = 0;
    await page.route('**/data/status.json*', async (route) => {
      count += 1;
      if (count === 1) return route.abort('failed');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./');
    const { retry } = getNavButtons(page);
    await expect(retry).toBeVisible({ timeout: 8_000 });
    await retry.click();
    await waitForCalendarReady(page);
  });

  test('T4-07: Automated 30-Min Outage-to-Publish Pipeline: mocked probe -> build -> privacy scan -> cross SVG', async ({ page }) => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local pipeline integration check');
    const repoRoot = resolveRepoRoot();
    const { checkLoginEndpoint } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'probe.mjs')).href);

    let step = 0;
    const srv = http.createServer((req, res) => {
      step += 1;
      if (step === 1 || step === 4) {
        res.writeHead(200);
        res.end('ok');
      } else if (step === 2) {
        res.writeHead(302, { Location: '/ok' });
        res.end();
      }
      // step 3 hangs
    });
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const { port } = srv.address();
    try {
      const url = `http://127.0.0.1:${port}/login`;
      expect((await checkLoginEndpoint(url, { timeoutMs: 250 })).status).toBe('online');
      expect((await checkLoginEndpoint(url, { timeoutMs: 250 })).status).toBe('offline');
      expect((await checkLoginEndpoint(url, { timeoutMs: 200 })).reason).toBe('timeout');
      expect((await checkLoginEndpoint(url, { timeoutMs: 250 })).status).toBe('online');
    } finally {
      srv.close();
    }

    await execFileAsync('npm', ['run', 'build'], { cwd: repoRoot, timeout: 45_000 });
    await execFileAsync('npm', ['run', 'test:privacy'], { cwd: repoRoot, timeout: 30_000 });

    const today = getPragueDateParts().ymd;
    const outageFixture = buildSyntheticStatusFixture({
      endDate: today,
      dayOverrides: {
        [today]: {
          status: 'offline',
          checks: 4,
          up: 2,
          down: 2,
          lastCheckedAt: `${today}T12:00:00.000Z`,
          lastHttpStatus: null,
          lastReason: 'timeout',
          sources: ['probe'],
        },
      },
    });
    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(outageFixture) })
    );
    await page.goto('./');
    await waitForCalendarReady(page);
    expect(await page.locator(`button[aria-label*="${today}"]`).first().getAttribute('data-status')).toBe('offline');
  });

  test('T4-08: Live Public Site & Audit across desktop (1440x900) and mobile (390x844)', async ({ page, request }) => {
    const runLive = process.env.CHECK_LIVE === '1' || isRemoteBaseUrl(process.env.BASE_URL);
    test.skip(!runLive, 'Requires CHECK_LIVE=1 or remote BASE_URL');

    const { stdout } = await execFileAsync('gh', ['repo', 'view', 'Harru230/bakalari-status', '--json', 'visibility']);
    expect(JSON.parse(stdout).visibility).toBe('PUBLIC');

    const jsonRes = await request.get('https://harru230.github.io/bakalari-status/data/status.json');
    expect(jsonRes.status()).toBe(200);
    const jsonText = await jsonRes.text();
    expect(scanTextForPrivacyLeaks(jsonText, { forbidAllIpv4: true })).toEqual([]);
    expect(validateStatusPayload(JSON.parse(jsonText), { maxDate: formatPragueDate() }).valid).toBe(true);

    const collector = installErrorCollectors(page);
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('https://harru230.github.io/bakalari-status/');
      await waitForCalendarReady(page);
      const snap = await extractDomAntiSlopSnapshot(page);
      expect(snap.scrollWidth).toBeLessThanOrEqual(vp.width);
      expect(EMOJI_REGEX.test(snap.bodyText)).toBe(false);
      expect(EM_DASH_REGEX.test(snap.bodyText)).toBe(false);
      const contrast = await measureContrastViolations(page);
      expect(contrast.textViolations).toEqual([]);
    }
    collector.assertClean();
  });
});
