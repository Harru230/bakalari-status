import { expect } from '@playwright/test';
import {
  compositeOver,
  contrastRatio,
  parseCssColor,
} from './contracts.mjs';

export const MONTH_HEADING_REGEX =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/;

export function installErrorCollectors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const httpErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText || 'failed'})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      httpErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  return {
    consoleErrors,
    pageErrors,
    failedRequests,
    httpErrors,
    assertClean() {
      expect(pageErrors, `Uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
      expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
      expect(failedRequests, `Failed requests: ${failedRequests.join(' | ')}`).toEqual([]);
      expect(httpErrors, `HTTP >=400 responses: ${httpErrors.join(' | ')}`).toEqual([]);
    },
  };
}

export function getMonthHeadingLocator(page) {
  return page
    .locator('main h2, main h3, main [role="heading"], main [data-calendar-heading], h2, h3')
    .filter({ hasText: MONTH_HEADING_REGEX })
    .first();
}

export function getNavButtons(page) {
  return {
    prev: page.getByRole('button', { name: /prev(ious)?(\s+month)?/i }).first(),
    next: page.getByRole('button', { name: /next(\s+month)?/i }).first(),
    today: page.getByRole('button', { name: /today|current\s+month/i }).first(),
    retry: page.getByRole('button', { name: /retry|try again|reload/i }).first(),
  };
}

export async function waitForCalendarReady(page) {
  const heading = getMonthHeadingLocator(page);
  await expect(heading).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('button[data-status]').first()).toBeVisible({ timeout: 10_000 });
  return heading;
}

export function parseMonthHeading(text) {
  const match = (text || '').trim().match(MONTH_HEADING_REGEX);
  if (!match) {
    throw new Error(`Unexpected month heading format: "${text}"`);
  }
  const [monthName, yearStr] = match[0].split(/\s+/);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return { year: Number(yearStr), month: months.indexOf(monthName) + 1 };
}

export async function navigateToMonth(page, targetYear, targetMonth) {
  const heading = getMonthHeadingLocator(page);
  const { prev, next } = getNavButtons(page);

  for (let i = 0; i < 36; i += 1) {
    const currentText = (await heading.innerText()).trim();
    const { year, month } = parseMonthHeading(currentText);
    const diff = (targetYear - year) * 12 + (targetMonth - month);
    if (diff === 0) return currentText;
    const btn = diff < 0 ? prev : next;
    const isDisabled = await btn.isDisabled();
    if (isDisabled) {
      throw new Error(
        `Cannot navigate to ${targetYear}-${String(targetMonth).padStart(2, '0')}: button disabled at ${currentText}`
      );
    }
    await btn.click();
  }
  throw new Error(`Exceeded max navigation steps trying to reach ${targetYear}-${targetMonth}`);
}

export async function extractWeekdayHeaders(page) {
  return page.evaluate(() => {
    const dayRegex = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i;
    let els = Array.from(document.querySelectorAll('[role="columnheader"], th')).filter((el) =>
      dayRegex.test((el.textContent || '').trim())
    );
    if (els.length !== 7) {
      els = Array.from(document.querySelectorAll('main *')).filter((el) => {
        if (el.children.length > 0) return false;
        const txt = (el.textContent || '').trim();
        const rect = el.getBoundingClientRect();
        return dayRegex.test(txt) && rect.width > 0 && rect.height > 0;
      });
    }
    return els.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        text: (el.textContent || '').trim(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
  });
}

export async function extractDomAntiSlopSnapshot(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        return false;
      }
      if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };

    const htmlLang = document.documentElement.getAttribute('lang');
    const title = document.title;
    const bodyText = document.body?.innerText || '';
    const svgTexts = Array.from(document.querySelectorAll('svg text')).map((n) => n.textContent || '');
    const ariaLabels = Array.from(document.querySelectorAll('[aria-label]')).map(
      (el) => el.getAttribute('aria-label') || ''
    );

    const headersCount = document.querySelectorAll('header').length;
    const mainsCount = document.querySelectorAll('main').length;
    const footersCount = document.querySelectorAll('footer').length;

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .filter(isVisible)
      .map((el) => ({
        level: Number(el.tagName.slice(1)),
        text: (el.textContent || '').trim(),
      }));

    const h1 = document.querySelector('h1');
    const h1Style = h1 ? getComputedStyle(h1) : null;

    const numericNodes = Array.from(
      document.querySelectorAll(
        'button[data-status], button[data-status] *, [aria-live="polite"], [aria-live="polite"] *, [data-tabular]'
      )
    ).filter((el) => isVisible(el) && /\d/.test(el.textContent || ''));
    const numericStyles = numericNodes.slice(0, 40).map((el) => {
      const s = getComputedStyle(el);
      return {
        fontVariantNumeric: s.fontVariantNumeric,
        fontFeatureSettings: s.fontFeatureSettings,
      };
    });

    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);

    const viewportMeta =
      document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';

    // Check above-h1 eyebrow pill badges and tracked caps <= 15px
    const h1Rect = h1 ? h1.getBoundingClientRect() : null;
    const eyebrowPills = [];
    const trackedCapsLabels = [];
    const middleDotStrings = [];
    const heavyShadows = [];
    const pulsingDots = [];
    const transitionAllEls = [];

    for (const el of document.querySelectorAll('*')) {
      if (!isVisible(el)) continue;
      const s = getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      if (s.transitionProperty === 'all' && parseFloat(s.transitionDuration) > 0) {
        transitionAllEls.push(el.tagName.toLowerCase());
      }

      if (s.boxShadow && s.boxShadow !== 'none') {
        // Check blur radius >= 16px on non-focus shadows
        const parts = s.boxShadow.match(/\d+(?:\.\d+)?px/g) || [];
        const blur = parts.length >= 3 ? parseFloat(parts[2]) : 0;
        if (blur >= 16) {
          heavyShadows.push({ tag: el.tagName.toLowerCase(), boxShadow: s.boxShadow });
        }
      }

      // Pulsing decorative dot check: tiny circle with animation
      if (
        rect.width <= 20 &&
        rect.height <= 20 &&
        parseFloat(s.borderRadius) >= 4 &&
        s.animationName &&
        s.animationName !== 'none'
      ) {
        pulsingDots.push({ tag: el.tagName.toLowerCase(), animationName: s.animationName });
      }

      // Direct text checks
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent || '')
        .join('')
        .trim();

      if (directText) {
        if (/\S+\s*[·•]\s*\S+/.test(directText)) {
          middleDotStrings.push(directText);
        }

        const fontSize = parseFloat(s.fontSize);
        const letterSpacing = s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing);
        if (
          s.textTransform === 'uppercase' &&
          fontSize <= 15 &&
          letterSpacing >= 1.2 &&
          !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i.test(directText)
        ) {
          trackedCapsLabels.push({ text: directText, fontSize, letterSpacing });
        }

        if (
          h1Rect &&
          rect.bottom <= h1Rect.top + 4 &&
          el !== h1 &&
          !el.closest('nav') &&
          el.tagName !== 'A' &&
          el.tagName !== 'BUTTON' &&
          parseFloat(s.borderRadius) >= 8 &&
          directText.length <= 40 &&
          s.backgroundColor !== 'rgba(0, 0, 0, 0)'
        ) {
          eyebrowPills.push(directText);
        }
      }
    }

    // Card-in-card check (excluding small day cells < 100x100)
    const cardLike = Array.from(document.querySelectorAll('main section, main article, main div')).filter((el) => {
      if (!isVisible(el)) return false;
      const s = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const pad = parseFloat(s.paddingTop) + parseFloat(s.paddingLeft);
      const hasBorder = parseFloat(s.borderTopWidth) > 0 && s.borderTopColor !== 'rgba(0, 0, 0, 0)';
      const hasRadius = parseFloat(s.borderRadius) >= 6;
      const hasBg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      return rect.width >= 180 && rect.height >= 120 && pad >= 16 && hasRadius && (hasBorder || hasBg);
    });
    const nestedCards = [];
    for (const outer of cardLike) {
      for (const inner of cardLike) {
        if (outer !== inner && outer.contains(inner)) {
          const outerBg = getComputedStyle(outer).backgroundColor;
          const innerBg = getComputedStyle(inner).backgroundColor;
          const innerHasBorder = parseFloat(getComputedStyle(inner).borderTopWidth) > 0;
          if (innerHasBorder && innerBg !== outerBg) {
            nestedCards.push(`${outer.tagName} > ${inner.tagName}`);
          }
        }
      }
    }

    // Stylesheet inspection for 100vw / 100vh / transition: all
    const stylesheetTraps = [];
    const scanRuleList = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules) {
          scanRuleList(rule.cssRules);
        } else if (rule.cssText) {
          const txt = rule.cssText;
          if (/\b100vw\b/i.test(txt) || /\b100vh\b/i.test(txt)) {
            stylesheetTraps.push(txt.slice(0, 120));
          }
          if (/transition(?:-property)?\s*:\s*all\b/i.test(txt)) {
            stylesheetTraps.push(txt.slice(0, 120));
          }
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        if (sheet.cssRules) scanRuleList(sheet.cssRules);
      } catch {
        // Ignore cross-origin sheets if any
      }
    }

    return {
      htmlLang,
      title,
      bodyText,
      svgTexts,
      ariaLabels,
      landmarks: { headersCount, mainsCount, footersCount },
      headings,
      h1LetterSpacing: h1Style ? h1Style.letterSpacing : null,
      h1FontSize: h1Style ? parseFloat(h1Style.fontSize) : null,
      numericStyles,
      canvas: {
        htmlBg: htmlStyle.backgroundColor,
        htmlBgImage: htmlStyle.backgroundImage,
        htmlOverflowX: htmlStyle.overflowX,
        bodyBg: bodyStyle.backgroundColor,
        bodyBgImage: bodyStyle.backgroundImage,
        bodyOverflowX: bodyStyle.overflowX,
      },
      viewportMeta,
      eyebrowPills,
      trackedCapsLabels,
      middleDotStrings,
      heavyShadows,
      pulsingDots,
      transitionAllEls,
      nestedCards,
      stylesheetTraps,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

export async function measureContrastViolations(page) {
  const samples = await page.evaluate(() => {
    const isVisible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };

    const getBgChain = (el) => {
      const chain = [];
      let curr = el;
      while (curr && curr.nodeType === 1) {
        const s = getComputedStyle(curr);
        chain.push({ bg: s.backgroundColor, opacity: parseFloat(s.opacity) });
        curr = curr.parentElement;
      }
      return chain.reverse();
    };

    const textSamples = [];
    for (const el of document.querySelectorAll('*')) {
      if (!isVisible(el)) continue;
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0
      );
      if (!hasDirectText) continue;
      const s = getComputedStyle(el);
      textSamples.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 40),
        color: s.color,
        fontSize: parseFloat(s.fontSize),
        fontWeight: parseInt(s.fontWeight, 10) || 400,
        bgChain: getBgChain(el),
      });
    }

    const svgSamples = [];
    for (const btn of document.querySelectorAll('button[data-status="online"], button[data-status="offline"]')) {
      if (!isVisible(btn)) continue;
      const svg = btn.querySelector('svg');
      if (!svg) continue;
      const shapes = svg.querySelectorAll('path, line, polyline, circle, rect, polygon');
      const bgChain = getBgChain(btn);
      for (const shape of shapes) {
        const s = getComputedStyle(shape);
        const stroke = s.stroke && s.stroke !== 'none' ? s.stroke : null;
        const fill = s.fill && s.fill !== 'none' ? s.fill : null;
        if (stroke) {
          svgSamples.push({
            status: btn.getAttribute('data-status'),
            color: stroke,
            bgChain,
          });
        } else if (fill) {
          svgSamples.push({
            status: btn.getAttribute('data-status'),
            color: fill,
            bgChain,
          });
        }
      }
    }

    const borderSamples = [];
    for (const ctrl of document.querySelectorAll('button, a[href]')) {
      if (!isVisible(ctrl)) continue;
      if (ctrl.disabled || ctrl.getAttribute('aria-disabled') === 'true') continue;
      const s = getComputedStyle(ctrl);
      const borderWidth = parseFloat(s.borderTopWidth);
      const borderStyle = s.borderTopStyle;
      if (
        borderWidth >= 1 &&
        borderStyle !== 'none' &&
        s.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
        s.borderTopColor !== 'transparent'
      ) {
        borderSamples.push({
          label: (ctrl.getAttribute('aria-label') || ctrl.textContent || '').trim().slice(0, 30),
          color: s.borderTopColor,
          ctrlBg: s.backgroundColor,
          ctrlOpacity: parseFloat(s.opacity),
          parentBgChain: getBgChain(ctrl.parentElement || document.body),
        });
      }
    }

    return { textSamples, svgSamples, borderSamples };
  });

  const resolveBg = (chain) => {
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of chain) {
      const parsed = parseCssColor(layer.bg);
      if (parsed && parsed.a > 0) {
        acc = compositeOver({ ...parsed, a: parsed.a * (layer.opacity ?? 1) }, acc);
      }
    }
    return acc;
  };

  const textViolations = [];
  for (const item of samples.textSamples) {
    const isLarge = item.fontSize >= 24 || (item.fontWeight >= 700 && item.fontSize >= 18.67);
    const minRatio = isLarge ? 3.0 : 4.5;
    const fg = parseCssColor(item.color);
    if (!fg) {
      textViolations.push({ ...item, reason: 'unparseable_color', ratio: 0, minRatio });
      continue;
    }
    if (fg.a === 0) continue;
    const bg = resolveBg(item.bgChain);
    const ratio = contrastRatio(fg, bg);
    if (ratio < minRatio) {
      textViolations.push({ ...item, ratio: Number(ratio.toFixed(2)), minRatio });
    }
  }

  const svgViolations = [];
  for (const item of samples.svgSamples) {
    const fg = parseCssColor(item.color);
    if (!fg) {
      svgViolations.push({ status: item.status, color: item.color, reason: 'unparseable_color', ratio: 0 });
      continue;
    }
    if (fg.a === 0) continue;
    const bg = resolveBg(item.bgChain);
    const ratio = contrastRatio(fg, bg);
    if (ratio < 3.0) {
      svgViolations.push({ status: item.status, color: item.color, ratio: Number(ratio.toFixed(2)) });
    }
  }

  const borderViolations = [];
  for (const item of samples.borderSamples) {
    const borderFg = parseCssColor(item.color);
    if (!borderFg) {
      borderViolations.push({ label: item.label, color: item.color, reason: 'unparseable_color', ratio: 0 });
      continue;
    }
    if (borderFg.a === 0) continue;
    const parentBg = resolveBg(item.parentBgChain);
    const borderContrastVsParent = contrastRatio(borderFg, parentBg);
    const ctrlBgParsed = parseCssColor(item.ctrlBg);
    const effectiveCtrlBg =
      ctrlBgParsed && ctrlBgParsed.a > 0
        ? compositeOver({ ...ctrlBgParsed, a: ctrlBgParsed.a * (item.ctrlOpacity ?? 1) }, parentBg)
        : parentBg;
    const bgContrastVsParent = contrastRatio(effectiveCtrlBg, parentBg);
    const effectiveContrast = Math.max(borderContrastVsParent, bgContrastVsParent);
    if (effectiveContrast < 3.0) {
      borderViolations.push({
        label: item.label,
        color: item.color,
        ctrlBg: item.ctrlBg,
        ratio: Number(effectiveContrast.toFixed(2)),
      });
    }
  }

  return {
    textCount: samples.textSamples.length,
    svgCount: samples.svgSamples.length,
    borderCount: samples.borderSamples.length,
    textViolations,
    svgViolations,
    borderViolations,
  };
}

export async function checkActiveFocusRing(page) {
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      return { focused: false };
    }
    const s = getComputedStyle(el);
    const chain = [];
    let curr = el.parentElement || document.body;
    while (curr && curr.nodeType === 1) {
      chain.push(getComputedStyle(curr).backgroundColor);
      curr = curr.parentElement;
    }
    return {
      focused: true,
      tag: el.tagName.toLowerCase(),
      text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
      outlineStyle: s.outlineStyle,
      outlineWidth: parseFloat(s.outlineWidth) || 0,
      outlineColor: s.outlineColor,
      boxShadow: s.boxShadow,
      bgChain: chain.reverse(),
    };
  });

  if (!info.focused) return { ok: false, reason: 'No element focused', info };

  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (const bgStr of info.bgChain) {
    const parsed = parseCssColor(bgStr);
    if (parsed && parsed.a > 0) bg = compositeOver(parsed, bg);
  }

  const outlineParsed = parseCssColor(info.outlineColor);
  const hasOutline =
    info.outlineStyle !== 'none' &&
    info.outlineWidth >= 1 &&
    Boolean(outlineParsed && outlineParsed.a > 0);

  let ringContrast = 0;
  if (hasOutline) {
    ringContrast = contrastRatio(outlineParsed, bg);
  } else if (info.boxShadow && info.boxShadow !== 'none') {
    const colorMatches =
      info.boxShadow.match(/(?:oklch|oklab|rgba?)\([^)]+\)|color\([^)]+\)|#[0-9a-f]{3,8}/gi) || [];
    for (const matchStr of colorMatches) {
      const c = parseCssColor(matchStr);
      if (c && c.a > 0) {
        ringContrast = Math.max(ringContrast, contrastRatio(c, bg));
      }
    }
  }

  const hasRing = (hasOutline || (info.boxShadow && info.boxShadow !== 'none')) && ringContrast >= 3.0;
  return {
    ok: hasRing,
    ringContrast: Number(ringContrast.toFixed(2)),
    info,
  };
}
