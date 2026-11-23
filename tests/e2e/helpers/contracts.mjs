import fs from 'node:fs';
import path from 'node:path';

export const HISTORY_START_DATE = '2026-09-17';
export const TARGET_URL = 'https://bakalari.oegp.cz/login';
export const TIMEZONE = 'Europe/Prague';
export const MAX_RECENT_CHECKS = 200;

export const VALID_STATUSES = new Set(['online', 'offline']);
export const VALID_REASONS = new Set(['ok', 'non_200', 'timeout', 'network_error']);
export const VALID_SOURCES = new Set(['historical', 'probe']);

export const ALLOWED_GIT_NAMES = new Set(['Harru230', 'github-actions[bot]']);
export const ALLOWED_GIT_EMAILS = new Set([
  '212044046+Harru230@users.noreply.github.com',
  '41898282+github-actions[bot]@users.noreply.github.com',
]);
export const ALLOWED_GIT_IDENTITIES = new Set([
  ...ALLOWED_GIT_NAMES,
  ...ALLOWED_GIT_EMAILS,
]);

export const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
export const EM_DASH_REGEX = /\u2014/;
export const UNICODE_CHECK_CROSS_REGEX = /[✓✔✗✘✕✖]/;

export const BANNED_BUZZWORDS = [
  'seamless',
  'robust',
  'revolutionary',
  'cutting-edge',
  'game-changing',
  'synergy',
  'holistic',
  'elevate',
  'streamline',
  'next-generation',
  'unleash',
  'delve',
  'tapestry',
  'bespoke',
];

const PRAGUE_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const PRAGUE_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const MONTH_NAMES = [
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

export function formatPragueDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${String(input)}`);
  }
  return PRAGUE_DATE_FORMATTER.format(date);
}

export function getPragueDateParts(input = new Date()) {
  const ymd = formatPragueDate(input);
  const [year, month, day] = ymd.split('-').map(Number);
  return { year, month, day, ymd };
}

export function formatPragueTimeParts(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = PRAGUE_DATETIME_FORMATTER.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    ymd: `${map.year}-${map.month}-${map.day}`,
    hhmm: `${map.hour}:${map.minute}`,
    hhmmss: `${map.hour}:${map.minute}:${map.second}`,
  };
}

export function parseYmd(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`Invalid YYYY-MM-DD date: ${String(ymd)}`);
  }
  const [year, month, day] = ymd.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Non-existent calendar date: ${ymd}`);
  }
  return { year, month, day };
}

export function addDaysToYmd(ymd, deltaDays) {
  const { year, month, day } = parseYmd(ymd);
  const nextMs = Date.UTC(year, month - 1, day, 12, 0, 0) + deltaDays * 86_400_000;
  const d = new Date(nextMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dayStr}`;
}

export function enumerateDates(startYmd, endYmd) {
  parseYmd(startYmd);
  parseYmd(endYmd);
  if (startYmd > endYmd) return [];
  const dates = [];
  let cursor = startYmd;
  while (cursor <= endYmd) {
    dates.push(cursor);
    cursor = addDaysToYmd(cursor, 1);
  }
  return dates;
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function mondayFirstOffset(year, month) {
  const utcDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (utcDay + 6) % 7;
}

export function monthHeadingLabel(year, month) {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function monthDiff(fromYear, fromMonth, toYear, toMonth) {
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function parseCssNumberOrPercent(token, percentScale = 1) {
  if (typeof token !== 'string') return NaN;
  const t = token.trim().toLowerCase();
  if (t === 'none') return 0;
  const match = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?$/i);
  if (!match) return NaN;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return NaN;
  return match[2] === '%' ? (num / 100) * percentScale : num;
}

function parseCssAngleDegrees(token) {
  if (typeof token !== 'string') return NaN;
  const t = token.trim().toLowerCase();
  if (t === 'none') return 0;
  const match = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i);
  if (!match) return NaN;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return NaN;
  const unit = (match[2] || 'deg').toLowerCase();
  if (unit === 'deg') return num;
  if (unit === 'rad') return (num * 180) / Math.PI;
  if (unit === 'grad') return num * 0.9;
  if (unit === 'turn') return num * 360;
  return NaN;
}

function parseCssAlpha(alphaPart) {
  if (alphaPart === undefined) return 1;
  const val = parseCssNumberOrPercent(alphaPart, 1);
  if (Number.isNaN(val)) return NaN;
  return clamp01(val);
}

function linearSrgbToByte(cLin) {
  const c = clamp01(cLin);
  const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, clamp01(srgb) * 255));
}

function oklabToClampedSrgb(L, a, b, alpha) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return {
    r: linearSrgbToByte(rLin),
    g: linearSrgbToByte(gLin),
    b: linearSrgbToByte(bLin),
    a: clamp01(alpha),
  };
}

function splitSpaceColorArgs(inner) {
  const slashParts = inner.split('/');
  if (slashParts.length > 2) return null;
  const coords = slashParts[0].trim().split(/\s+/).filter(Boolean);
  const alpha = slashParts.length === 2 ? parseCssAlpha(slashParts[1]) : 1;
  if (Number.isNaN(alpha)) return null;
  return { coords, alpha };
}

export function parseCssColor(value) {
  if (!value || typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (raw === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    if (!/^[0-9a-f]+$/i.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)
        ? null
        : { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)
        ? null
        : { r, g, b, a };
    }
    return null;
  }

  const oklchMatch = raw.match(/^oklch\((.+)\)$/);
  if (oklchMatch) {
    const parsed = splitSpaceColorArgs(oklchMatch[1].trim());
    if (!parsed || parsed.coords.length !== 3) return null;
    const L = parseCssNumberOrPercent(parsed.coords[0], 1);
    const C = Math.max(0, parseCssNumberOrPercent(parsed.coords[1], 0.4));
    const hDeg = parseCssAngleDegrees(parsed.coords[2]);
    if ([L, C, hDeg, parsed.alpha].some((n) => Number.isNaN(n))) return null;
    const hRad = (hDeg * Math.PI) / 180;
    return oklabToClampedSrgb(clamp01(L), C * Math.cos(hRad), C * Math.sin(hRad), parsed.alpha);
  }

  const oklabMatch = raw.match(/^oklab\((.+)\)$/);
  if (oklabMatch) {
    const parsed = splitSpaceColorArgs(oklabMatch[1].trim());
    if (!parsed || parsed.coords.length !== 3) return null;
    const L = parseCssNumberOrPercent(parsed.coords[0], 1);
    const a = parseCssNumberOrPercent(parsed.coords[1], 0.4);
    const b = parseCssNumberOrPercent(parsed.coords[2], 0.4);
    if ([L, a, b, parsed.alpha].some((n) => Number.isNaN(n))) return null;
    return oklabToClampedSrgb(clamp01(L), a, b, parsed.alpha);
  }

  const colorFnMatch = raw.match(/^color\((.+)\)$/);
  if (colorFnMatch) {
    const parsed = splitSpaceColorArgs(colorFnMatch[1].trim());
    if (!parsed || parsed.coords.length !== 4 || parsed.coords[0] !== 'srgb') return null;
    const r = parseCssNumberOrPercent(parsed.coords[1], 1);
    const g = parseCssNumberOrPercent(parsed.coords[2], 1);
    const b = parseCssNumberOrPercent(parsed.coords[3], 1);
    if ([r, g, b, parsed.alpha].some((n) => Number.isNaN(n))) return null;
    return {
      r: clamp01(r) * 255,
      g: clamp01(g) * 255,
      b: clamp01(b) * 255,
      a: parsed.alpha,
    };
  }

  const fnMatch = raw.match(/^rgba?\((.+)\)$/);
  if (!fnMatch) return null;
  const inner = fnMatch[1].trim();

  let parts;
  let alpha = 1;
  if (inner.includes(',')) {
    parts = inner.split(',').map((s) => s.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    if (parts.length === 4) {
      alpha = parseCssAlpha(parts[3]);
    }
  } else {
    const slashSplit = splitSpaceColorArgs(inner);
    if (!slashSplit || slashSplit.coords.length !== 3) return null;
    parts = slashSplit.coords;
    alpha = slashSplit.alpha;
  }

  const r = parseCssNumberOrPercent(parts[0], 255);
  const g = parseCssNumberOrPercent(parts[1], 255);
  const b = parseCssNumberOrPercent(parts[2], 255);
  if ([r, g, b, alpha].some((n) => Number.isNaN(n))) return null;
  return {
    r: Math.min(255, Math.max(0, r)),
    g: Math.min(255, Math.max(0, g)),
    b: Math.min(255, Math.max(0, b)),
    a: clamp01(alpha),
  };
}

export function compositeOver(fg, bg) {
  const a = fg.a ?? 1;
  if (a >= 1) {
    return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  }
  const bgA = bg.a ?? 1;
  const outA = a + bgA * (1 - a);
  if (outA === 0) return { r: 255, g: 255, b: 255, a: 0 };
  return {
    r: (fg.r * a + bg.r * bgA * (1 - a)) / outA,
    g: (fg.g * a + bg.g * bgA * (1 - a)) / outA,
    b: (fg.b * a + bg.b * bgA * (1 - a)) / outA,
    a: outA,
  };
}

export function relativeLuminance(rgb) {
  const c = typeof rgb === 'string' ? parseCssColor(rgb) : rgb;
  if (!c) throw new Error(`Invalid color for luminance: ${String(rgb)}`);
  const linearize = (v) => {
    const srgb = v / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(c.r) + 0.7152 * linearize(c.g) + 0.0722 * linearize(c.b);
}

export function contrastRatio(fgInput, bgInput) {
  const fgParsed = typeof fgInput === 'string' ? parseCssColor(fgInput) : fgInput;
  const bgParsed = typeof bgInput === 'string' ? parseCssColor(bgInput) : bgInput;
  if (!fgParsed || !bgParsed) {
    throw new Error(`Unable to parse colors for contrast: ${String(fgInput)} vs ${String(bgInput)}`);
  }
  const opaqueBg = bgParsed.a < 1 ? compositeOver(bgParsed, { r: 255, g: 255, b: 255, a: 1 }) : bgParsed;
  const effectiveFg = fgParsed.a < 1 ? compositeOver(fgParsed, opaqueBg) : fgParsed;
  const l1 = relativeLuminance(effectiveFg);
  const l2 = relativeLuminance(opaqueBg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function isLightNeutralColor(colorInput) {
  const c = typeof colorInput === 'string' ? parseCssColor(colorInput) : colorInput;
  if (!c || c.a === 0) return false;
  const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  const lum = relativeLuminance(c);
  return spread <= 24 && lum >= 0.72;
}

export function hasDisallowedGradient(backgroundImage) {
  if (!backgroundImage || backgroundImage === 'none') return false;
  return /(linear-gradient|radial-gradient|conic-gradient)/i.test(backgroundImage);
}

function isIsoUtcString(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function validateStatusPayload(payload, options = {}) {
  const {
    requireContinuous = true,
    expectedStartDate = HISTORY_START_DATE,
    maxDate = formatPragueDate(),
    allowEmptyDays = false,
  } = options;

  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Payload must be a JSON object'] };
  }

  const allowedTopKeys = new Set([
    'schemaVersion',
    'target',
    'timezone',
    'generatedAt',
    'historyStartDate',
    'currentStatus',
    'days',
    'recentChecks',
  ]);
  for (const k of Object.keys(payload)) {
    if (!allowedTopKeys.has(k)) {
      errors.push(`Unexpected top-level key: ${k}`);
    }
  }
  for (const req of allowedTopKeys) {
    if (!(req in payload)) {
      errors.push(`Missing top-level key: ${req}`);
    }
  }

  if (payload.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1, got ${String(payload.schemaVersion)}`);
  }
  if (payload.target !== TARGET_URL) {
    errors.push(`target must be ${TARGET_URL}, got ${String(payload.target)}`);
  }
  if (payload.timezone !== TIMEZONE) {
    errors.push(`timezone must be ${TIMEZONE}, got ${String(payload.timezone)}`);
  }
  if (payload.historyStartDate !== expectedStartDate) {
    errors.push(`historyStartDate must be ${expectedStartDate}, got ${String(payload.historyStartDate)}`);
  }
  if (!isIsoUtcString(payload.generatedAt)) {
    errors.push(`generatedAt must be ISO UTC timestamp, got ${String(payload.generatedAt)}`);
  }

  const cs = payload.currentStatus;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) {
    errors.push('currentStatus must be an object');
  } else {
    const allowedCsKeys = new Set(['status', 'checkedAt', 'httpStatus', 'latencyMs', 'reason']);
    for (const k of Object.keys(cs)) {
      if (!allowedCsKeys.has(k)) errors.push(`Unexpected currentStatus key: ${k}`);
    }
    if (!VALID_STATUSES.has(cs.status)) errors.push(`Invalid currentStatus.status: ${String(cs.status)}`);
    if (!isIsoUtcString(cs.checkedAt)) errors.push(`Invalid currentStatus.checkedAt: ${String(cs.checkedAt)}`);
    if (cs.httpStatus !== null && (!Number.isInteger(cs.httpStatus) || cs.httpStatus < 100 || cs.httpStatus > 599)) {
      errors.push(`Invalid currentStatus.httpStatus: ${String(cs.httpStatus)}`);
    }
    if (typeof cs.latencyMs !== 'number' || !Number.isFinite(cs.latencyMs) || cs.latencyMs < 0) {
      errors.push(`Invalid currentStatus.latencyMs: ${String(cs.latencyMs)}`);
    }
    if (!VALID_REASONS.has(cs.reason)) errors.push(`Invalid currentStatus.reason: ${String(cs.reason)}`);
    if (cs.status === 'online' && (cs.httpStatus !== 200 || cs.reason !== 'ok')) {
      errors.push('currentStatus.status === "online" requires httpStatus === 200 and reason === "ok"');
    }
    if (cs.status === 'offline' && cs.httpStatus === 200) {
      errors.push('currentStatus.status === "offline" cannot have httpStatus === 200');
    }
    if (cs.status === 'offline' && cs.reason === 'ok') {
      errors.push('currentStatus.status === "offline" cannot have reason === "ok"');
    }
    if (cs.reason === 'non_200' && cs.httpStatus === 200) {
      errors.push('currentStatus.reason === "non_200" cannot have httpStatus === 200');
    }
    if ((cs.reason === 'timeout' || cs.reason === 'network_error') && cs.httpStatus !== null) {
      errors.push(`currentStatus.reason === "${cs.reason}" requires httpStatus === null`);
    }
  }

  const days = payload.days;
  if (!days || typeof days !== 'object' || Array.isArray(days)) {
    errors.push('days must be an object');
  } else {
    const dayKeys = Object.keys(days).sort();
    if (!allowEmptyDays && dayKeys.length === 0) {
      errors.push('days must not be empty');
    }
    const allowedDayKeys = new Set([
      'date',
      'status',
      'checks',
      'up',
      'down',
      'lastCheckedAt',
      'lastHttpStatus',
      'lastReason',
      'sources',
    ]);
    for (const key of dayKeys) {
      try {
        parseYmd(key);
      } catch (err) {
        errors.push(`Invalid day key "${key}": ${err.message}`);
        continue;
      }
      if (key < expectedStartDate) {
        errors.push(`Day key ${key} precedes historyStartDate ${expectedStartDate}`);
      }
      if (maxDate && key > maxDate) {
        errors.push(`Day key ${key} exceeds maxDate ${maxDate}`);
      }

      const d = days[key];
      if (!d || typeof d !== 'object' || Array.isArray(d)) {
        errors.push(`days[${key}] must be an object`);
        continue;
      }
      for (const dk of Object.keys(d)) {
        if (!allowedDayKeys.has(dk)) errors.push(`Unexpected key days[${key}].${dk}`);
      }
      if (d.date !== key) errors.push(`days[${key}].date mismatch: ${String(d.date)}`);
      if (!VALID_STATUSES.has(d.status)) errors.push(`Invalid days[${key}].status: ${String(d.status)}`);
      if (!Number.isInteger(d.checks) || d.checks < 1) errors.push(`Invalid days[${key}].checks: ${String(d.checks)}`);
      if (!Number.isInteger(d.up) || d.up < 0) errors.push(`Invalid days[${key}].up: ${String(d.up)}`);
      if (!Number.isInteger(d.down) || d.down < 0) errors.push(`Invalid days[${key}].down: ${String(d.down)}`);
      if (d.checks !== d.up + d.down) {
        errors.push(`days[${key}].checks (${d.checks}) !== up (${d.up}) + down (${d.down})`);
      }
      const expectedDayStatus = d.down > 0 ? 'offline' : 'online';
      if (d.status !== expectedDayStatus) {
        errors.push(`Strict outage rule violated on ${key}: expected ${expectedDayStatus}, got ${d.status}`);
      }
      if (!isIsoUtcString(d.lastCheckedAt)) {
        errors.push(`Invalid days[${key}].lastCheckedAt: ${String(d.lastCheckedAt)}`);
      } else {
        const lastCheckedYmd = formatPragueDate(new Date(d.lastCheckedAt));
        if (lastCheckedYmd !== key) {
          errors.push(`days[${key}].lastCheckedAt (${lastCheckedYmd}) does not match day key ${key}`);
        }
      }
      if (
        d.lastHttpStatus !== null &&
        (!Number.isInteger(d.lastHttpStatus) || d.lastHttpStatus < 100 || d.lastHttpStatus > 599)
      ) {
        errors.push(`Invalid days[${key}].lastHttpStatus: ${String(d.lastHttpStatus)}`);
      }
      if (!VALID_REASONS.has(d.lastReason)) {
        errors.push(`Invalid days[${key}].lastReason: ${String(d.lastReason)}`);
      }
      if (!Array.isArray(d.sources) || d.sources.length === 0 || d.sources.some((s) => !VALID_SOURCES.has(s))) {
        errors.push(`Invalid days[${key}].sources: ${JSON.stringify(d.sources)}`);
      }
    }

    if (requireContinuous && !allowEmptyDays && maxDate && maxDate >= expectedStartDate) {
      const expectedDates = enumerateDates(expectedStartDate, maxDate);
      for (const expectedDate of expectedDates) {
        if (!(expectedDate in days)) {
          errors.push(`Missing continuous date entry for ${expectedDate}`);
        }
      }
    }
  }

  if (!Array.isArray(payload.recentChecks)) {
    errors.push('recentChecks must be an array');
  } else {
    if (payload.recentChecks.length > MAX_RECENT_CHECKS) {
      errors.push(`recentChecks length ${payload.recentChecks.length} exceeds ${MAX_RECENT_CHECKS}`);
    }
    const allowedCheckKeys = new Set([
      'timestamp',
      'date',
      'status',
      'httpStatus',
      'latencyMs',
      'reason',
      'source',
    ]);
    payload.recentChecks.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`recentChecks[${idx}] must be an object`);
        return;
      }
      for (const ek of Object.keys(entry)) {
        if (!allowedCheckKeys.has(ek)) errors.push(`Unexpected recentChecks[${idx}].${ek}`);
      }
      if (!isIsoUtcString(entry.timestamp)) {
        errors.push(`Invalid recentChecks[${idx}].timestamp`);
      } else {
        const expectedYmd = formatPragueDate(new Date(entry.timestamp));
        if (entry.date !== expectedYmd) {
          errors.push(`recentChecks[${idx}].date (${entry.date}) !== Prague date (${expectedYmd})`);
        }
      }
      if (!VALID_STATUSES.has(entry.status)) errors.push(`Invalid recentChecks[${idx}].status`);
      if (
        entry.httpStatus !== null &&
        (!Number.isInteger(entry.httpStatus) || entry.httpStatus < 100 || entry.httpStatus > 599)
      ) {
        errors.push(`Invalid recentChecks[${idx}].httpStatus`);
      }
      const validNumericLatency =
        typeof entry.latencyMs === 'number' && Number.isFinite(entry.latencyMs) && entry.latencyMs >= 0;
      const isHistoricalNull = entry.source === 'historical' && entry.latencyMs === null;
      if (!validNumericLatency && !isHistoricalNull) {
        errors.push(`Invalid recentChecks[${idx}].latencyMs`);
      }
      if (!VALID_REASONS.has(entry.reason)) errors.push(`Invalid recentChecks[${idx}].reason`);
      if (!VALID_SOURCES.has(entry.source)) errors.push(`Invalid recentChecks[${idx}].source`);
      if (entry.status === 'online' && (entry.reason !== 'ok' || entry.httpStatus !== 200)) {
        errors.push(`recentChecks[${idx}] online check requires httpStatus === 200 and reason === "ok"`);
      }
      if (entry.status === 'offline' && entry.reason === 'ok') {
        errors.push(`recentChecks[${idx}] offline check cannot have reason === "ok"`);
      }
      if (entry.status === 'offline' && entry.httpStatus === 200) {
        errors.push(`recentChecks[${idx}] offline check cannot have httpStatus === 200`);
      }
      if (entry.reason === 'non_200' && entry.httpStatus === 200) {
        errors.push(`recentChecks[${idx}] non_200 check cannot have httpStatus === 200`);
      }
      if ((entry.reason === 'timeout' || entry.reason === 'network_error') && entry.httpStatus !== null) {
        errors.push(`recentChecks[${idx}] ${entry.reason} check requires httpStatus === null`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function buildSyntheticStatusFixture(options = {}) {
  const {
    startDate = HISTORY_START_DATE,
    endDate = formatPragueDate(),
    emptyDays = false,
    mixedDayDate = null,
    currentStatusOverride = null,
    dayOverrides = {},
    generatedAt = `${endDate}T12:00:00.000Z`,
  } = options;

  const days = {};
  const recentChecks = [];

  if (!emptyDays && endDate >= startDate) {
    const allDates = enumerateDates(startDate, endDate);
    allDates.forEach((ymd, idx) => {
      const isMixed = mixedDayDate === ymd;
      const isPeriodicOutage = idx % 7 === 3;
      const isStartDay = ymd === startDate;
      const isEndDay = ymd === endDate;

      let entry;
      if (isMixed) {
        entry = {
          date: ymd,
          status: 'offline',
          checks: 5,
          up: 4,
          down: 1,
          lastCheckedAt: `${ymd}T11:30:00.000Z`,
          lastHttpStatus: null,
          lastReason: 'timeout',
          sources: ['historical', 'probe'],
        };
      } else if (isPeriodicOutage || isEndDay) {
        entry = {
          date: ymd,
          status: 'offline',
          checks: 3,
          up: 2,
          down: 1,
          lastCheckedAt: `${ymd}T11:30:00.000Z`,
          lastHttpStatus: null,
          lastReason: 'timeout',
          sources: isEndDay ? ['probe'] : ['historical'],
        };
      } else {
        entry = {
          date: ymd,
          status: 'online',
          checks: 4,
          up: 4,
          down: 0,
          lastCheckedAt: `${ymd}T11:30:00.000Z`,
          lastHttpStatus: 200,
          lastReason: 'ok',
          sources: isStartDay ? ['historical'] : ['historical'],
        };
      }

      if (dayOverrides[ymd]) {
        entry = { ...entry, ...dayOverrides[ymd], date: ymd };
      }
      days[ymd] = entry;
    });

    const tailDates = allDates.slice(-5);
    tailDates.forEach((ymd) => {
      const d = days[ymd];
      recentChecks.push({
        timestamp: d.lastCheckedAt,
        date: ymd,
        status: d.status,
        httpStatus: d.lastHttpStatus,
        latencyMs: d.status === 'online' ? 142 : 12005,
        reason: d.lastReason,
        source: d.sources.includes('probe') ? 'probe' : 'historical',
      });
    });
  }

  const latestDay = !emptyDays ? days[endDate] : null;
  const currentStatus = currentStatusOverride || {
    status: latestDay ? latestDay.status : 'offline',
    checkedAt: latestDay ? latestDay.lastCheckedAt : generatedAt,
    httpStatus: latestDay ? latestDay.lastHttpStatus : null,
    latencyMs: latestDay?.status === 'online' ? 142 : 12005,
    reason: latestDay ? latestDay.lastReason : 'timeout',
  };

  return {
    schemaVersion: 1,
    target: TARGET_URL,
    timezone: TIMEZONE,
    generatedAt,
    historyStartDate: HISTORY_START_DATE,
    currentStatus,
    days,
    recentChecks,
  };
}

export function buildSyntheticSecretFixtures() {
  return {
    githubPat: ['ghp', '_', 'TESTFAKE0000000000000000000000000000'].join(''),
    googleApiKey: ['AIza', 'SyTESTFAKE000000000000000000000000000'].join(''),
    pemHeader: ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join(''),
    bearerToken: ['Bearer', ' ', 'syntheticTestTokenValue12345'].join(''),
    rfc1918_192: ['192', '168', '0', '1'].join('.'),
    rfc1918_10: ['10', '0', '0', '1'].join('.'),
    rfc1918_172: ['172', '16', '5', '4'].join('.'),
    badSubdomain: ['internal', '.', 'oegp', '.', 'cz'].join(''),
    badRootDomain: ['oegp', '.', 'cz'].join(''),
    badSchoolIp: ['193', '41', '10', '20'].join('.'),
    badRepo: ['Harru230', '/', 'private-sandbox-repo'].join(''),
    badEmail: ['dev', '@', 'example.com'].join(''),
    badEnvPass: ['BAK', '_', 'PASS', '=testvalue123'].join(''),
    badBotToken: ['123456789', ':', 'AA', 'TestFakeBotToken0000000000000000000'].join(''),
  };
}

export function scanTextForPrivacyLeaks(text, options = {}) {
  const {
    forbidAllIpv4 = false,
    allowLocalPaths = false,
  } = options;

  const findings = [];
  if (typeof text !== 'string' || text.length === 0) {
    return findings;
  }

  const secretPatterns = [
    { name: 'github_token', regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
    { name: 'google_api_key', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
    { name: 'private_key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { name: 'bearer_token', regex: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi },
    { name: 'bot_token_shape', regex: /\b\d{8,11}:AA[0-9A-Za-z_-]{30,40}\b/g },
    {
      name: 'secret_env_name',
      regex: new RegExp(
        `\\b(?:${[
          ['BAK', 'USER'].join('_'),
          ['BAK', 'PASS'].join('_'),
          ['TELEGRAM', 'BOT', 'TOKEN'].join('_'),
          ['FIREBASE', 'TOKEN'].join('_'),
        ].join('|')})\\b`,
        'g'
      ),
    },
  ];

  for (const { name, regex } of secretPatterns) {
    const matches = text.match(regex);
    if (matches) {
      findings.push({ type: name, matches: [...new Set(matches)] });
    }
  }

  const rfc1918Matches = text.match(
    /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g
  );
  if (rfc1918Matches) {
    findings.push({ type: 'rfc1918_ip', matches: [...new Set(rfc1918Matches)] });
  }

  const schoolIpMatches = text.match(/\b193\.41\.\d{1,3}\.\d{1,3}\b/g);
  if (schoolIpMatches) {
    findings.push({ type: 'school_ip', matches: [...new Set(schoolIpMatches)] });
  }

  if (forbidAllIpv4) {
    const ipv4Matches = text.match(/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g);
    if (ipv4Matches) {
      findings.push({ type: 'ipv4_literal', matches: [...new Set(ipv4Matches)] });
    }
  }

  if (!allowLocalPaths) {
    const localPaths = [
      ...(text.match(/\/(?:Users|home)\/[A-Za-z0-9._-]+/g) || []),
      ...(text.match(/[A-Z]:\\Users\\[A-Za-z0-9._-]+/gi) || []),
    ];
    if (localPaths.length > 0) {
      findings.push({ type: 'local_user_path', matches: [...new Set(localPaths)] });
    }
  }

  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const disallowedEmails = emails.filter((e) => !ALLOWED_GIT_EMAILS.has(e));
  if (disallowedEmails.length > 0) {
    findings.push({ type: 'non_allowlisted_email', matches: [...new Set(disallowedEmails)] });
  }

  const oegpDomains = text.match(/\b(?:[a-z0-9-]+\.)*oegp\.cz\b/gi) || [];
  const disallowedDomains = oegpDomains.filter((d) => d.toLowerCase() !== 'bakalari.oegp.cz');
  if (disallowedDomains.length > 0) {
    findings.push({ type: 'non_allowlisted_oegp_domain', matches: [...new Set(disallowedDomains)] });
  }

  const repos = text.match(/\bHarru230\/([A-Za-z0-9._-]+)\b/g) || [];
  const disallowedRepos = repos.filter((r) => r.replace(/\.git$/i, '') !== 'Harru230/bakalari-status');
  if (disallowedRepos.length > 0) {
    findings.push({ type: 'non_allowlisted_repo', matches: [...new Set(disallowedRepos)] });
  }

  return findings;
}

export function isRemoteBaseUrl(baseURL) {
  if (!baseURL) return false;
  return !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseURL);
}

export function isDryRunSandbox() {
  return process.env.E2E_DRY_RUN === '1';
}

export function resolveRepoRoot() {
  return path.resolve(process.cwd());
}

export function readJsonSafe(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
