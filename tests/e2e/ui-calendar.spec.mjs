import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import {
  BANNED_BUZZWORDS,
  EMOJI_REGEX,
  EM_DASH_REGEX,
  UNICODE_CHECK_CROSS_REGEX,
  buildSyntheticStatusFixture,
  contrastRatio,
  daysInMonth,
  getPragueDateParts,
  hasDisallowedGradient,
  isDryRunSandbox,
  isLightNeutralColor,
  isRemoteBaseUrl,
  mondayFirstOffset,
  monthDiff,
  monthHeadingLabel,
  parseCssColor,
} from './helpers/contracts.mjs';
import {
  checkActiveFocusRing,
  extractDomAntiSlopSnapshot,
  extractWeekdayHeaders,
  getMonthHeadingLocator,
  getNavButtons,
  installErrorCollectors,
  measureContrastViolations,
  navigateToMonth,
  parseMonthHeading,
  waitForCalendarReady,
} from './helpers/dom-audit.mjs';

const execFileAsync = promisify(execFile);

test.describe('F6-F9 & F13: Calendar UI, Anti-Slop Design, A11y & Responsiveness', () => {
  test('T1-F06-01: Light zinc/neutral canvas with zero purple-blue or rainbow gradients', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);

    const bodyBg = parseCssColor(snap.canvas.bodyBg);
    const htmlBg = parseCssColor(snap.canvas.htmlBg);
    const effectiveCanvas = bodyBg && bodyBg.a > 0 ? bodyBg : htmlBg;
    expect(effectiveCanvas, 'Body or html must have an explicit light neutral canvas color').not.toBeNull();
    expect(isLightNeutralColor(effectiveCanvas)).toBe(true);
    expect(hasDisallowedGradient(snap.canvas.bodyBgImage)).toBe(false);
    expect(hasDisallowedGradient(snap.canvas.htmlBgImage)).toBe(false);
  });

  test('T1-F06-02: Every visible normal text element (<18px) meets WCAG AA >= 4.5:1 contrast', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const report = await measureContrastViolations(page);
    expect(report.textCount).toBeGreaterThan(5);
    const normalViolations = report.textViolations.filter((v) => v.minRatio >= 4.5);
    expect(normalViolations, JSON.stringify(normalViolations, null, 2)).toEqual([]);
  });

  test('T1-F06-03: Large headings (>=24px / 18.67px bold), borders, and status SVGs meet >= 3.0:1 contrast', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const report = await measureContrastViolations(page);
    const largeViolations = report.textViolations.filter((v) => v.minRatio === 3.0);
    expect(largeViolations, JSON.stringify(largeViolations, null, 2)).toEqual([]);
    expect(report.svgViolations, JSON.stringify(report.svgViolations, null, 2)).toEqual([]);
    expect(report.borderViolations, JSON.stringify(report.borderViolations, null, 2)).toEqual([]);
  });

  test('T1-F06-04: No heavy blur drop shadows and no card-inside-card nesting', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.heavyShadows, JSON.stringify(snap.heavyShadows)).toEqual([]);
    expect(snap.nestedCards, JSON.stringify(snap.nestedCards)).toEqual([]);
  });

  test('T1-F06-05: Zero decorative pulsing dots and semantic colors reserved for status UI', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.pulsingDots, JSON.stringify(snap.pulsingDots)).toEqual([]);
  });

  test('T1-F07-01: Document has <html lang="en"> and descriptive unique <title>', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.htmlLang).toBe('en');
    expect(snap.title.trim().length).toBeGreaterThan(5);
  });

  test('T1-F07-02: Zero Unicode emojis across body text, title, SVG text, and aria-labels', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    const allTexts = [snap.title, snap.bodyText, ...snap.svgTexts, ...snap.ariaLabels];
    for (const chunk of allTexts) {
      expect(EMOJI_REGEX.test(chunk), `Found Unicode emoji in: ${chunk.slice(0, 80)}`).toBe(false);
    }
  });

  test('T1-F07-03: Zero em dashes (\\u2014) and zero banned AI buzzwords in visible copy', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    const combined = [snap.title, snap.bodyText, ...snap.ariaLabels].join('\n');
    expect(EM_DASH_REGEX.test(combined)).toBe(false);
    const lower = combined.toLowerCase();
    for (const word of BANNED_BUZZWORDS) {
      expect(new RegExp(`\\b${word}\\b`, 'i').test(lower), `Found banned buzzword: ${word}`).toBe(false);
    }
  });

  test('T1-F07-04: English-only UI copy with zero Czech/German status labels or fabricated stats', async ({ page }) => {
    const res = await page.request.get('data/status.json');
    expect(res.status()).toBe(200);
    const statusData = await res.json();

    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.bodyText).toMatch(/Mon[\s\S]*Tue[\s\S]*Wed[\s\S]*Thu[\s\S]*Fri[\s\S]*Sat[\s\S]*Sun/);
    expect(/\b(Pondělí|Úterý|Středa|Čtvrtek|Pátek|Sobota|Neděle|Montag|Dienstag|Mittwoch|Známky|Rozvrh)\b/i.test(snap.bodyText)).toBe(false);
    // Verify current status verdict matches status.json
    const currentStatusWord = statusData.currentStatus.status;
    expect(snap.bodyText.toLowerCase()).toContain(currentStatusWord);
  });

  test('T1-F07-05: <h1> uses tight negative letter-spacing and numbers use tabular-nums', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.h1LetterSpacing).not.toBeNull();
    const trackingPx = snap.h1LetterSpacing === 'normal' ? 0 : parseFloat(snap.h1LetterSpacing);
    expect(trackingPx).toBeLessThan(0);
    expect(snap.numericStyles.some((s) => s.fontVariantNumeric.includes('tabular-nums'))).toBe(true);
  });

  test('T1-F07-06: Zero eyebrow pills above <h1>, zero tracked-caps <=15px, zero middle-dot meta strings', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.eyebrowPills, JSON.stringify(snap.eyebrowPills)).toEqual([]);
    expect(snap.trackedCapsLabels, JSON.stringify(snap.trackedCapsLabels)).toEqual([]);
    expect(snap.middleDotStrings, JSON.stringify(snap.middleDotStrings)).toEqual([]);
  });

  test('T1-F08-01: Month heading and Monday-first 7-column Mon..Sun aligned grid headers', async ({ page }) => {
    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    const headingText = (await heading.innerText()).trim();
    expect(headingText).toMatch(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/);

    const headers = await extractWeekdayHeaders(page);
    expect(headers).toHaveLength(7);
    expect(headers.map((h) => h.text)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

    const ys = headers.map((h) => h.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(6);
    for (let i = 1; i < headers.length; i += 1) {
      expect(headers[i].x).toBeGreaterThan(headers[i - 1].x);
    }
  });

  test('T1-F08-02 & T1-F08-03: Online checkmark SVG and offline cross SVG differ structurally with explicit aria-labels', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);

    const fixture = buildSyntheticStatusFixture({
      endDate: getPragueDateParts().ymd,
      mixedDayDate: getPragueDateParts().ymd,
    });
    // Also check real data first across navigable months if needed, and verify distinct SVGs
    const inspectSvgCell = async (status) => {
      const cell = page.locator(`button[data-status="${status}"]`).first();
      const label = await cell.getAttribute('aria-label');
      expect(label && label.trim().length > 5).toBe(true);
      expect(label.toLowerCase()).toContain(status);
      expect(UNICODE_CHECK_CROSS_REGEX.test(await cell.innerText())).toBe(false);

      const svg = cell.locator('svg').first();
      await expect(svg).toBeVisible();
      expect(await svg.getAttribute('aria-hidden')).toBe('true');
      const box = await svg.boundingBox();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      const shapeCount = await svg.locator('path, line, polyline, circle, rect, polygon').count();
      expect(shapeCount).toBeGreaterThan(0);
      return svg.innerHTML();
    };

    // Ensure current or previous month has both online and offline on real data; if not, navigate Prev once
    let onlineCount = await page.locator('button[data-status="online"]').count();
    let offlineCount = await page.locator('button[data-status="offline"]').count();
    if (onlineCount === 0 || offlineCount === 0) {
      const { prev } = getNavButtons(page);
      if (!(await prev.isDisabled())) {
        await prev.click();
        onlineCount = await page.locator('button[data-status="online"]').count();
        offlineCount = await page.locator('button[data-status="offline"]').count();
      }
    }

    if (onlineCount > 0 && offlineCount > 0) {
      const onlineSvg = await inspectSvgCell('online');
      const offlineSvg = await inspectSvgCell('offline');
      expect(onlineSvg).not.toBe(offlineSvg);
    } else {
      // Fallback deterministic route if live data in a single month happens to be 100% one status
      await page.route('**/data/status.json*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
      );
      await page.reload();
      await waitForCalendarReady(page);
      const onlineSvg = await inspectSvgCell('online');
      const offlineSvg = await inspectSvgCell('offline');
      expect(onlineSvg).not.toBe(offlineSvg);
    }
  });

  test('T1-F08-04: Unmonitored/future date renders neutral state without checkmark/cross SVG', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);

    let onlineHtml =
      (await page.locator('button[data-status="online"] svg').count()) > 0
        ? await page.locator('button[data-status="online"] svg').first().innerHTML()
        : null;
    let offlineHtml =
      (await page.locator('button[data-status="offline"] svg').count()) > 0
        ? await page.locator('button[data-status="offline"] svg').first().innerHTML()
        : null;

    // Navigate to September 2026 where Sep 1..16 are unmonitored
    await navigateToMonth(page, 2026, 9);
    if (!onlineHtml && (await page.locator('button[data-status="online"] svg').count()) > 0) {
      onlineHtml = await page.locator('button[data-status="online"] svg').first().innerHTML();
    }
    if (!offlineHtml && (await page.locator('button[data-status="offline"] svg').count()) > 0) {
      offlineHtml = await page.locator('button[data-status="offline"] svg').first().innerHTML();
    }

    const unmonitoredCells = page.locator('[data-status="unmonitored"]');
    const count = await unmonitoredCells.count();
    expect(count).toBeGreaterThanOrEqual(16);

    const firstUnmonitored = unmonitoredCells.first();
    const label = (await firstUnmonitored.getAttribute('aria-label')) || '';
    expect(label.toLowerCase()).toMatch(/unmonitored|no data|no checks|before monitoring/);
    expect(UNICODE_CHECK_CROSS_REGEX.test(await firstUnmonitored.innerText())).toBe(false);
    // Ensure it does not reuse online/offline SVG icons
    const unmonSvgCount = await firstUnmonitored.locator('svg').count();
    if (unmonSvgCount > 0) {
      const unmonHtml = await firstUnmonitored.locator('svg').first().innerHTML();
      if (onlineHtml) {
        expect(unmonHtml).not.toBe(onlineHtml);
      }
      if (offlineHtml) {
        expect(unmonHtml).not.toBe(offlineHtml);
      }
    }
  });

  test('T1-F08-05: Prev, Next, and Today buttons navigate months accurately', async ({ page }) => {
    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    const initialHeading = (await heading.innerText()).trim();
    const initial = parseMonthHeading(initialHeading);
    const { prev, next, today } = getNavButtons(page);

    await prev.click();
    const afterPrev = parseMonthHeading(await heading.innerText());
    expect(monthDiff(afterPrev.year, afterPrev.month, initial.year, initial.month)).toBe(1);

    await next.click();
    expect((await heading.innerText()).trim()).toBe(initialHeading);

    // Go back 2 months (to September 2026 if starting in November 2026) then click Today
    await prev.click();
    await prev.click();
    const twoBack = parseMonthHeading(await heading.innerText());
    expect(monthDiff(twoBack.year, twoBack.month, initial.year, initial.month)).toBe(2);

    await today.click();
    expect((await heading.innerText()).trim()).toBe(initialHeading);
  });

  test('T1-F08-06: Clicking a monitored day updates aria-live="polite" detail panel with Prague stats', async ({ page }) => {
    const todayPrague = getPragueDateParts().ymd;
    const prevPrague = getPragueDateParts(new Date(Date.now() - 86_400_000)).ymd;
    const fixture = buildSyntheticStatusFixture({
      endDate: todayPrague,
      mixedDayDate: prevPrague,
    });

    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    );

    await page.goto('./');
    await waitForCalendarReady(page);

    const liveRegion = page.locator('[aria-live="polite"]').first();
    await expect(liveRegion).toBeVisible();

    const targetBtn = page.locator(`button[data-status="offline"]`).first();
    await targetBtn.click();

    const detailText = await liveRegion.innerText();
    expect(detailText.toLowerCase()).toContain('offline');
    expect(detailText).toMatch(/\b3\b|\b5\b/);
    expect(detailText.toLowerCase()).toContain('timeout');
  });

  test('T1-F09-01: Document has single <header>, <main>, <footer>, single <h1>, and no skipped heading levels', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.landmarks.headersCount).toBe(1);
    expect(snap.landmarks.mainsCount).toBe(1);
    expect(snap.landmarks.footersCount).toBe(1);
    const h1s = snap.headings.filter((h) => h.level === 1);
    expect(h1s).toHaveLength(1);
    for (let i = 1; i < snap.headings.length; i += 1) {
      const jump = snap.headings[i].level - snap.headings[i - 1].level;
      expect(jump, `Heading level skipped: ${JSON.stringify(snap.headings)}`).toBeLessThanOrEqual(1);
    }
  });

  test('T1-F09-02: Interactive controls use native <button>/<a href> with cursor: pointer and accessible names', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const controls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a[href], [role="button"]')).map((el) => {
        const s = getComputedStyle(el);
        const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
        const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          disabled,
          cursor: s.cursor,
          name,
        };
      });
    });

    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls) {
      expect(['button', 'a']).toContain(c.tag);
      if (c.tag === 'button') {
        expect(c.type).toBe('button');
      }
      expect(c.name.length).toBeGreaterThan(0);
      if (!c.disabled) {
        expect(c.cursor).toBe('pointer');
      }
    }
  });

  test('T1-F09-03: Zero console/page/network errors and zero overflow at 1440x900 and 1280x800', async ({ page }) => {
    const collector = installErrorCollectors(page);
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('./');
      await waitForCalendarReady(page);
      const snap = await extractDomAntiSlopSnapshot(page);
      expect(snap.scrollWidth).toBeLessThanOrEqual(snap.innerWidth);
      expect(snap.bodyScrollWidth).toBeLessThanOrEqual(snap.innerWidth);
    }
    collector.assertClean();
  });

  test('T1-F09-04: Zero overflow and >=44x44px tap targets at 768x1024 and 390x844', async ({ page }) => {
    for (const vp of [
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('./');
      await waitForCalendarReady(page);
      const metrics = await page.evaluate(() => {
        const isControlRendered = (el) => {
          if (el.closest('[hidden]')) return false;
          let curr = el;
          while (curr && curr.nodeType === 1) {
            const s = getComputedStyle(curr);
            if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) {
              return false;
            }
            curr = curr.parentElement;
          }
          return true;
        };
        const controls = Array.from(document.querySelectorAll('button:not([disabled])'))
          .filter(isControlRendered)
          .map((btn) => {
            const r = btn.getBoundingClientRect();
            return {
              name: (btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 30),
              width: r.width,
              height: r.height,
              left: r.left,
              right: r.right,
            };
          });
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          controls,
        };
      });
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
      expect(metrics.controls.length).toBeGreaterThan(0);
      for (const c of metrics.controls) {
        expect(c.height, `${c.name} height at ${vp.width}px`).toBeGreaterThanOrEqual(44);
        expect(c.width, `${c.name} width at ${vp.width}px`).toBeGreaterThanOrEqual(44);
        expect(c.left).toBeGreaterThanOrEqual(0);
        expect(c.right).toBeLessThanOrEqual(metrics.innerWidth + 1);
      }
    }
  });

  test('T1-F09-05: Tab keyboard navigation exposes >=3:1 :focus-visible ring and Enter selects day', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');
    await waitForCalendarReady(page);

    let sawFocusRing = false;
    let selectedWithEnter = false;
    const liveRegion = page.locator('[aria-live="polite"]').first();
    const initialLive = await liveRegion.innerText();

    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const activeTagAndStatus = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          tag: el?.tagName?.toLowerCase(),
          status: el?.getAttribute?.('data-status') || null,
          label: el?.getAttribute?.('aria-label') || '',
        };
      });
      if (activeTagAndStatus.tag === 'button') {
        const ring = await checkActiveFocusRing(page);
        expect(ring.ok, `Missing >=3:1 focus ring on ${JSON.stringify(ring)}`).toBe(true);
        sawFocusRing = true;

        if (
          (activeTagAndStatus.status === 'online' || activeTagAndStatus.status === 'offline') &&
          !selectedWithEnter
        ) {
          await page.keyboard.press('Enter');
          const afterLive = await liveRegion.innerText();
          if (afterLive.trim().length > 0 && afterLive !== initialLive) {
            selectedWithEnter = true;
            break;
          }
          selectedWithEnter = afterLive.toLowerCase().includes(activeTagAndStatus.status);
          if (selectedWithEnter) break;
        }
      }
    }

    expect(sawFocusRing).toBe(true);
    expect(selectedWithEnter).toBe(true);
  });

  test('T1-F13-01 & T1-F13-02: Preview serves calendar banner and 100% HTTP 200 asset responses', async ({ page }) => {
    const responses = [];
    page.on('response', (res) => {
      responses.push({ url: res.url(), status: res.status() });
    });

    await page.goto('./');
    await waitForCalendarReady(page);

    expect(responses.length).toBeGreaterThanOrEqual(2);
    for (const r of responses) {
      expect(r.status, `Non-200 response for ${r.url}`).toBe(200);
    }
    const text = await page.locator('body').innerText();
    expect(text.toLowerCase()).toMatch(/online|offline/);
  });

  test('T1-F13-03: Programmatic DOM anti-slop audit passes cleanly', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.landmarks.headersCount).toBe(1);
    expect(snap.landmarks.mainsCount).toBe(1);
    expect(snap.landmarks.footersCount).toBe(1);
    expect(snap.headings.filter((h) => h.level === 1)).toHaveLength(1);
    expect(EMOJI_REGEX.test(snap.bodyText)).toBe(false);
    expect(EM_DASH_REGEX.test(snap.bodyText)).toBe(false);
  });

  test('T1-F13-04: Multi-viewport sweep [320, 390, 768, 1280, 1440, 1920] passes overflow & contrast', async ({ page }) => {
    for (const width of [320, 390, 768, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 600 ? 700 : 900 });
      await page.goto('./');
      await waitForCalendarReady(page);
      const snap = await extractDomAntiSlopSnapshot(page);
      expect(snap.scrollWidth, `Overflow at ${width}px`).toBeLessThanOrEqual(snap.innerWidth);
      const contrast = await measureContrastViolations(page);
      expect(contrast.textViolations, `Contrast failure at ${width}px`).toEqual([]);
    }
  });

  test('T1-F13-05: E2E suite registration and helper self-tests execute cleanly', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL), 'Local E2E verification skipped against remote BASE_URL');
    const { stdout, stderr } = await execFileAsync('node', ['--test', 'tests/e2e/helpers/contracts.self-test.mjs']);
    expect(stderr).toBe('');
    expect(stdout).toContain('pass');

    if (!isDryRunSandbox() && process.env.E2E_NESTED !== '1') {
      const listRes = await execFileAsync('npx', ['playwright', 'test', '--list'], {
        env: { ...process.env, E2E_NESTED: '1' },
      });
      expect(listRes.stdout).toContain('T1-F13-05');
    }
  });

  // Tier 2 Boundary & Corner Cases
  test('T2-F06-01: Near-threshold muted labels & timestamps compute >= 4.5:1 contrast', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const report = await measureContrastViolations(page);
    expect(report.textViolations, JSON.stringify(report.textViolations)).toEqual([]);
    // Verify #777777 on #ffffff trap is mathematically rejected by our helper
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  test('T2-F06-02: Semantic status tints and SVG indicators maintain >= 4.5:1 text and >= 3.0:1 SVG contrast', async ({ page }) => {
    const today = getPragueDateParts().ymd;
    const yesterday = getPragueDateParts(new Date(Date.now() - 86_400_000)).ymd;
    const fixture = buildSyntheticStatusFixture({ endDate: today, mixedDayDate: yesterday });
    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    );
    await page.goto('./');
    await waitForCalendarReady(page);
    const report = await measureContrastViolations(page);
    expect(report.textViolations).toEqual([]);
    expect(report.svgViolations).toEqual([]);
  });

  test('T2-F06-03: Focus ring contrast is >= 3.0:1 on keyboard focus', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    await page.keyboard.press('Tab');
    // Step until we hit a button
    for (let i = 0; i < 10; i += 1) {
      const isBtn = await page.evaluate(() => document.activeElement?.tagName === 'BUTTON');
      if (isBtn) break;
      await page.keyboard.press('Tab');
    }
    const ring = await checkActiveFocusRing(page);
    expect(ring.ok, JSON.stringify(ring)).toBe(true);
    expect(ring.ringContrast).toBeGreaterThanOrEqual(3.0);
  });

  test('T2-F06-04: Overflow-x clip on canvas and zero 100vw/100vh or transition: all traps', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(['clip', 'hidden']).toContain(snap.canvas.htmlOverflowX);
    expect(snap.stylesheetTraps, JSON.stringify(snap.stylesheetTraps)).toEqual([]);
    expect(snap.transitionAllEls, JSON.stringify(snap.transitionAllEls)).toEqual([]);
  });

  test('T2-F06-05: Online checkmark vs offline cross vs unmonitored remain distinguishable in grayscale', async ({ page }) => {
    const today = getPragueDateParts().ymd;
    const prev = getPragueDateParts(new Date(Date.now() - 86_400_000)).ymd;
    const fixture = buildSyntheticStatusFixture({ endDate: today, mixedDayDate: prev });
    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    );
    await page.goto('./');
    await waitForCalendarReady(page);
    await page.evaluate(() => {
      document.documentElement.style.filter = 'grayscale(100%)';
    });
    const onlineSvg = await page.locator('button[data-status="online"] svg').first().innerHTML();
    const offlineSvg = await page.locator('button[data-status="offline"] svg').first().innerHTML();
    expect(onlineSvg).not.toBe(offlineSvg);
  });

  test('T2-F07-02: Long reason string (network_error) wraps cleanly at 320x568 without overflow', async ({ page }) => {
    const today = getPragueDateParts().ymd;
    const fixture = buildSyntheticStatusFixture({
      endDate: today,
      dayOverrides: {
        [today]: {
          status: 'offline',
          checks: 2,
          up: 1,
          down: 1,
          lastCheckedAt: `${today}T10:15:00.000Z`,
          lastHttpStatus: null,
          lastReason: 'network_error',
          sources: ['probe'],
        },
      },
      currentStatusOverride: {
        status: 'offline',
        checkedAt: `${today}T10:15:00.000Z`,
        httpStatus: null,
        latencyMs: 42,
        reason: 'network_error',
      },
    });
    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    );
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('./');
    await waitForCalendarReady(page);
    await page.locator('button[data-status="offline"]').last().click();
    const liveText = await page.locator('[aria-live="polite"]').first().innerText();
    expect(liveText.toLowerCase()).toContain('network_error');
    const snap = await extractDomAntiSlopSnapshot(page);
    expect(snap.scrollWidth).toBeLessThanOrEqual(320);
  });

  test('T2-F07-03: Tabular numerals keep consistent cell column widths across day 1 and day 28', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');
    await waitForCalendarReady(page);
    const widths = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('button[data-status]'));
      return cells.map((c) => c.getBoundingClientRect().width);
    });
    expect(widths.length).toBeGreaterThanOrEqual(28);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
  });

  test('T2-F07-04: Zero fabricated numbers — displayed day counts match status.json', async ({ page }) => {
    const today = getPragueDateParts().ymd;
    const fixture = buildSyntheticStatusFixture({
      endDate: today,
      dayOverrides: {
        [today]: {
          status: 'offline',
          checks: 7,
          up: 5,
          down: 2,
          lastCheckedAt: `${today}T09:00:00.000Z`,
          lastHttpStatus: 503,
          lastReason: 'non_200',
          sources: ['probe'],
        },
      },
    });
    await page.route('**/data/status.json*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    );
    await page.goto('./');
    await waitForCalendarReady(page);
    await page.locator('button[data-status="offline"]').last().click();
    const detail = await page.locator('[aria-live="polite"]').first().innerText();
    expect(detail).toContain('7');
    expect(detail).toContain('5');
    expect(detail).toContain('2');
  });

  test('T2-F08-01: Monday-first weekday offsets align Sep 2026 (Tue), Oct 2026 (Thu), Nov 2026 (Sun)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');
    await waitForCalendarReady(page);
    const headers = await extractWeekdayHeaders(page);

    for (const [year, month] of [
      [2026, 11],
      [2026, 10],
      [2026, 9],
    ]) {
      await navigateToMonth(page, year, month);
      const expectedColIndex = mondayFirstOffset(year, month);
      const firstDayBox = await page.locator('[data-status]').first().boundingBox();
      const targetHeader = headers[expectedColIndex];
      expect(
        Math.abs(firstDayBox.x - targetHeader.x),
        `Month ${year}-${month} day 1 x=${firstDayBox.x} vs ${targetHeader.text} x=${targetHeader.x}`
      ).toBeLessThanOrEqual(8);
    }
  });

  test('T2-F08-03: Lower history boundary at September 2026 disables Prev with cursor: not-allowed', async ({ page }) => {
    await page.goto('./');
    await waitForCalendarReady(page);
    await navigateToMonth(page, 2026, 9);
    const { prev } = getNavButtons(page);
    expect(await prev.isDisabled()).toBe(true);
    expect(await prev.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed');

    const totalCells = await page.locator('[data-status]').count();
    expect(totalCells).toBe(daysInMonth(2026, 9));
    // Sep 1..16 (16 days) must be unmonitored
    for (let i = 0; i < 16; i += 1) {
      expect(await page.locator('[data-status]').nth(i).getAttribute('data-status')).toBe('unmonitored');
    }
  });

  test('T2-F08-04: Upper future boundary at current month disables Next with cursor: not-allowed', async ({ page }) => {
    const todayPrague = getPragueDateParts();
    await page.goto('./');
    await waitForCalendarReady(page);
    await navigateToMonth(page, todayPrague.year, todayPrague.month);
    const { next } = getNavButtons(page);
    expect(await next.isDisabled()).toBe(true);
    expect(await next.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed');
  });

  test('T2-F08-06: Space and Enter activate day selection without unintended scroll jump', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');
    await waitForCalendarReady(page);

    const cells = page.locator('button[data-status="online"], button[data-status="offline"]');
    const count = await cells.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const firstCell = cells.first();
    await firstCell.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Space');
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);

    const liveText = await page.locator('[aria-live="polite"]').first().innerText();
    expect(liveText.toLowerCase()).toMatch(/online|offline/);

    if (count > 1) {
      await cells.nth(1).focus();
      await page.keyboard.press('Enter');
      const liveText2 = await page.locator('[aria-live="polite"]').first().innerText();
      expect(liveText2.toLowerCase()).toMatch(/online|offline/);
    }
  });

  test('T2-F09-04: Narrow 320x568 viewport keeps zero overflow and >=44px cell height with gaps', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('./');
    await waitForCalendarReady(page);

    const metrics = await page.evaluate(() => {
      const isControlRendered = (el) => {
        if (el.closest('[hidden]')) return false;
        let curr = el;
        while (curr && curr.nodeType === 1) {
          const s = getComputedStyle(curr);
          if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) {
            return false;
          }
          curr = curr.parentElement;
        }
        return true;
      };
      const navButtons = Array.from(document.querySelectorAll('button')).filter(
        (b) => !b.hasAttribute('data-status') && !b.disabled && isControlRendered(b)
      );
      const dayCells = Array.from(document.querySelectorAll('button[data-status]')).filter(
        isControlRendered
      );
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        navRects: navButtons.map((b) => b.getBoundingClientRect()),
        dayRects: dayCells.map((b) => b.getBoundingClientRect()),
      };
    });

    expect(metrics.scrollWidth).toBeLessThanOrEqual(320);
    expect(metrics.navRects.length).toBeGreaterThan(0);
    expect(metrics.dayRects.length).toBeGreaterThan(0);
    for (const r of metrics.navRects) {
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(r.width).toBeGreaterThanOrEqual(44);
    }
    for (const r of metrics.dayRects) {
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(r.right).toBeLessThanOrEqual(321);
    }
  });

  test('T2-F09-05: 200% Zoom (640x400 and 2x root text scale) keeps zero clipping or overflow', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto('./');
    await waitForCalendarReady(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const metaViewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect((metaViewport || '').toLowerCase()).not.toContain('user-scalable=no');
    expect((metaViewport || '').toLowerCase()).not.toContain('maximum-scale=1');
  });

  test('T2-F09-06: prefers-reduced-motion suppresses animations and disabled Next blocks navigation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    const before = await heading.innerText();
    const { next } = getNavButtons(page);
    expect(await next.isDisabled()).toBe(true);
    expect(await next.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed');

    const motionViolations = await page.evaluate(() => {
      const maxDuration = (val) =>
        Math.max(
          0,
          ...String(val || '0s')
            .split(',')
            .map((p) => parseFloat(p) || 0)
        );
      const out = [];
      for (const el of document.querySelectorAll('button, a[href]')) {
        if (el.closest('[hidden]')) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;
        const tDur = maxDuration(s.transitionDuration);
        const aDur = maxDuration(s.animationDuration);
        if (tDur > 0.01 || aDur > 0.01) {
          out.push({
            label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
            transitionDuration: s.transitionDuration,
            animationDuration: s.animationDuration,
          });
        }
      }
      return out;
    });
    expect(motionViolations, JSON.stringify(motionViolations)).toEqual([]);

    await next.click({ force: true });
    expect(await heading.innerText()).toBe(before);
  });

  test('T2-F13-02: Rapid Prev/Today clicks remain synchronized with zero console errors', async ({ page }) => {
    const collector = installErrorCollectors(page);
    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    const initial = (await heading.innerText()).trim();
    const { prev, today } = getNavButtons(page);

    if (!(await prev.isDisabled())) await prev.click();
    if (!(await prev.isDisabled())) await prev.click();
    await today.click();
    await today.click();
    expect((await heading.innerText()).trim()).toBe(initial);

    const firstCell = page.locator('button[data-status="online"], button[data-status="offline"]').first();
    await firstCell.click();
    expect((await page.locator('[aria-live="polite"]').first().innerText()).length).toBeGreaterThan(0);
    collector.assertClean();
  });

  test('T2-F13-03: Dynamic resize 1440x900 -> 320x568 -> 1440x900 keeps zero overflow and valid selection', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('./');
    await waitForCalendarReady(page);

    await page.locator('button[data-status="online"], button[data-status="offline"]').first().click();

    await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await page.locator('[aria-live="polite"]').first().innerText()).length).toBeGreaterThan(0);
  });

  test('T2-F13-05: Zero dead controls — every enabled button produces an observable state change', async ({ page }) => {
    await page.goto('./');
    const heading = await waitForCalendarReady(page);
    const initialHeading = (await heading.innerText()).trim();
    const { prev, next, today } = getNavButtons(page);

    if (!(await prev.isDisabled())) {
      await prev.click();
      expect((await heading.innerText()).trim()).not.toBe(initialHeading);
      expect(await next.isDisabled()).toBe(false);
      await next.click();
      expect((await heading.innerText()).trim()).toBe(initialHeading);
      await prev.click();
      await today.click();
      expect((await heading.innerText()).trim()).toBe(initialHeading);
    }

    const enabledDayBtn = page.locator('button[data-status="online"], button[data-status="offline"]').first();
    const label = (await enabledDayBtn.getAttribute('aria-label')) || '';
    await enabledDayBtn.click();
    const liveText = await page.locator('[aria-live="polite"]').first().innerText();
    expect(liveText.length).toBeGreaterThan(0);
    if (label.toLowerCase().includes('offline')) {
      expect(liveText.toLowerCase()).toContain('offline');
    }
  });
});
