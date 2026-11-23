import {
  SCHOOL_TIMEZONE,
  compareDateKeys,
  parseDateKey,
  toDate,
  toPragueDateKey,
} from './timezone.mjs';

export const SCHEMA_VERSION = 1;
export const DEFAULT_TARGET = 'https://bakalari.oegp.cz/login';
export const DEFAULT_TIMEZONE = SCHOOL_TIMEZONE;
export const MAX_RECENT_CHECKS = 200;

export const VALID_STATUSES = new Set(['online', 'offline']);
export const VALID_REASONS = new Set(['ok', 'non_200', 'timeout', 'network_error']);
export const VALID_SOURCES = new Set(['historical', 'probe']);
export const SOURCE_ORDER = ['historical', 'probe'];

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'target',
  'timezone',
  'generatedAt',
  'historyStartDate',
  'currentStatus',
  'days',
  'recentChecks',
];

const CURRENT_STATUS_KEYS = ['status', 'checkedAt', 'httpStatus', 'latencyMs', 'reason'];

const DAY_KEYS = [
  'date',
  'status',
  'checks',
  'up',
  'down',
  'lastCheckedAt',
  'lastHttpStatus',
  'lastReason',
  'sources',
];

const CHECK_KEYS = ['timestamp', 'date', 'status', 'httpStatus', 'latencyMs', 'reason', 'source'];
const STRICT_INPUT_CHECK_KEYS = new Set([
  'timestamp',
  'status',
  'httpStatus',
  'latencyMs',
  'reason',
  'source',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertExactKeys(obj, expectedKeys, label) {
  const actual = Object.keys(obj);
  if (actual.length !== expectedKeys.length) {
    throw new Error(`${label} has unexpected keys`);
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(obj, key)) {
      throw new Error(`${label} is missing key ${key}`);
    }
  }
}

function normalizeIsoUtc(input, label, requireUtcString = false) {
  if (requireUtcString) {
    if (typeof input !== 'string' || !ISO_UTC_PATTERN.test(input)) {
      throw new Error(`${label} must be an ISO-8601 UTC string`);
    }
  }
  return toDate(input).toISOString();
}

function canonicalizeSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('sources must be a non-empty array');
  }
  const set = new Set();
  for (const src of sources) {
    if (!VALID_SOURCES.has(src)) {
      throw new Error(`Invalid source: ${String(src)}`);
    }
    set.add(src);
  }
  return SOURCE_ORDER.filter((src) => set.has(src));
}

export function normalizeCheck(raw, options = {}) {
  if (!isPlainObject(raw)) {
    throw new TypeError('Check must be a plain object');
  }
  const { strictKeys = false } = options;

  if (strictKeys) {
    for (const key of Object.keys(raw)) {
      if (!STRICT_INPUT_CHECK_KEYS.has(key)) {
        throw new Error(`Check contains unexpected key: ${key}`);
      }
    }
  }

  const timestamp = normalizeIsoUtc(raw.timestamp, 'timestamp', strictKeys);
  const date = toPragueDateKey(timestamp);

  if (raw.date !== undefined && raw.date !== date) {
    throw new Error(`Check date ${String(raw.date)} does not match ${date}`);
  }

  if (!VALID_STATUSES.has(raw.status)) {
    throw new Error(`Invalid status: ${String(raw.status)}`);
  }

  if (!VALID_REASONS.has(raw.reason)) {
    throw new Error(`Invalid reason: ${String(raw.reason)}`);
  }

  if (raw.status === 'online' && raw.reason !== 'ok') {
    throw new Error('Online check must have reason "ok"');
  }
  if (raw.status === 'offline' && raw.reason === 'ok') {
    throw new Error('Offline check cannot have reason "ok"');
  }

  let httpStatus = null;
  if (raw.httpStatus !== null && raw.httpStatus !== undefined) {
    if (!Number.isInteger(raw.httpStatus) || raw.httpStatus < 100 || raw.httpStatus > 599) {
      throw new Error(`Invalid httpStatus: ${String(raw.httpStatus)}`);
    }
    httpStatus = raw.httpStatus;
  } else if (strictKeys && raw.httpStatus === undefined) {
    throw new Error('Check is missing httpStatus');
  }

  if (raw.status === 'online' && httpStatus !== 200) {
    throw new Error('Online check must have httpStatus 200');
  }
  if (raw.reason === 'non_200' && httpStatus === 200) {
    throw new Error('non_200 check cannot have httpStatus 200');
  }
  if ((raw.reason === 'timeout' || raw.reason === 'network_error') && httpStatus !== null) {
    throw new Error(`${raw.reason} check must have httpStatus null`);
  }

  if (!VALID_SOURCES.has(raw.source)) {
    throw new Error(`Invalid source: ${String(raw.source)}`);
  }

  let latencyMs = null;
  if (raw.latencyMs === null || (raw.latencyMs === undefined && !strictKeys)) {
    if (raw.source === 'probe') {
      throw new Error('Probe check requires integer latencyMs >= 0');
    }
  } else if (typeof raw.latencyMs === 'number' && Number.isFinite(raw.latencyMs) && raw.latencyMs >= 0) {
    latencyMs = Math.round(raw.latencyMs);
  } else {
    throw new Error(`Invalid latencyMs: ${String(raw.latencyMs)}`);
  }

  return {
    timestamp,
    date,
    status: raw.status,
    httpStatus,
    latencyMs,
    reason: raw.reason,
    source: raw.source,
  };
}

export const sanitizeCheck = (raw) => normalizeCheck(raw, { strictKeys: true });

export function createEmptyStatusDocument({
  target = DEFAULT_TARGET,
  timezone = DEFAULT_TIMEZONE,
  now = () => new Date(),
} = {}) {
  if (target !== DEFAULT_TARGET) {
    throw new Error(`Unsupported target: ${String(target)}`);
  }
  if (timezone !== DEFAULT_TIMEZONE) {
    throw new Error(`Unsupported timezone: ${String(timezone)}`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    target,
    timezone,
    generatedAt: toDate(now()).toISOString(),
    historyStartDate: null,
    currentStatus: null,
    days: {},
    recentChecks: [],
  };
}

export const createEmptyStatus = createEmptyStatusDocument;

function cloneDocument(doc) {
  const days = {};
  for (const key of Object.keys(doc.days ?? {})) {
    const day = doc.days[key];
    days[key] = {
      ...day,
      sources: [...day.sources],
    };
  }
  return {
    schemaVersion: doc.schemaVersion,
    target: doc.target,
    timezone: doc.timezone,
    generatedAt: doc.generatedAt,
    historyStartDate: doc.historyStartDate,
    currentStatus: doc.currentStatus ? { ...doc.currentStatus } : null,
    days,
    recentChecks: (doc.recentChecks ?? []).map((entry) => ({ ...entry })),
  };
}

export function validateStatusDocument(doc) {
  if (!isPlainObject(doc)) {
    throw new Error('Status document must be a plain object');
  }
  assertExactKeys(doc, TOP_LEVEL_KEYS, 'Status document');

  if (doc.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(doc.schemaVersion)}`);
  }
  if (doc.target !== DEFAULT_TARGET) {
    throw new Error(`Invalid target: ${String(doc.target)}`);
  }
  if (doc.timezone !== DEFAULT_TIMEZONE) {
    throw new Error(`Invalid timezone: ${String(doc.timezone)}`);
  }
  normalizeIsoUtc(doc.generatedAt, 'generatedAt', true);

  if (!isPlainObject(doc.days)) {
    throw new Error('days must be a plain object');
  }
  const dayKeys = Object.keys(doc.days);
  for (let i = 0; i < dayKeys.length; i += 1) {
    const key = dayKeys[i];
    parseDateKey(key);
    if (i > 0 && compareDateKeys(dayKeys[i - 1], key) >= 0) {
      throw new Error('days keys must be strictly sorted ascending');
    }

    const day = doc.days[key];
    if (!isPlainObject(day)) {
      throw new Error(`Day ${key} must be a plain object`);
    }
    assertExactKeys(day, DAY_KEYS, `days[${key}]`);

    if (day.date !== key) {
      throw new Error(`days[${key}].date mismatch`);
    }
    if (!Number.isInteger(day.checks) || day.checks <= 0) {
      throw new Error(`days[${key}].checks must be a positive integer`);
    }
    if (!Number.isInteger(day.up) || day.up < 0) {
      throw new Error(`days[${key}].up must be a non-negative integer`);
    }
    if (!Number.isInteger(day.down) || day.down < 0) {
      throw new Error(`days[${key}].down must be a non-negative integer`);
    }
    if (day.checks !== day.up + day.down) {
      throw new Error(`days[${key}] checks !== up + down`);
    }
    const expectedStatus = day.down > 0 ? 'offline' : 'online';
    if (day.status !== expectedStatus) {
      throw new Error(`days[${key}].status must be ${expectedStatus}`);
    }

    const lastCheckedAt = normalizeIsoUtc(day.lastCheckedAt, `days[${key}].lastCheckedAt`, true);
    if (toPragueDateKey(lastCheckedAt) !== key) {
      throw new Error(`days[${key}].lastCheckedAt does not fall on ${key}`);
    }

    if (day.lastHttpStatus !== null) {
      if (!Number.isInteger(day.lastHttpStatus) || day.lastHttpStatus < 100 || day.lastHttpStatus > 599) {
        throw new Error(`days[${key}].lastHttpStatus is invalid`);
      }
    }
    if (!VALID_REASONS.has(day.lastReason)) {
      throw new Error(`days[${key}].lastReason is invalid`);
    }
    const canonical = canonicalizeSources(day.sources);
    if (
      canonical.length !== day.sources.length ||
      canonical.some((src, idx) => src !== day.sources[idx])
    ) {
      throw new Error(`days[${key}].sources must be canonical`);
    }
  }

  if (dayKeys.length === 0) {
    if (doc.historyStartDate !== null) {
      throw new Error('Empty document must have historyStartDate null');
    }
  } else if (doc.historyStartDate !== dayKeys[0]) {
    throw new Error('historyStartDate must match earliest day key');
  }

  if (!Array.isArray(doc.recentChecks)) {
    throw new Error('recentChecks must be an array');
  }
  if (doc.recentChecks.length > MAX_RECENT_CHECKS) {
    throw new Error(`recentChecks exceeds max ${MAX_RECENT_CHECKS}`);
  }

  for (let i = 0; i < doc.recentChecks.length; i += 1) {
    const entry = doc.recentChecks[i];
    if (!isPlainObject(entry)) {
      throw new Error(`recentChecks[${i}] must be a plain object`);
    }
    assertExactKeys(entry, CHECK_KEYS, `recentChecks[${i}]`);
    normalizeCheck(entry);
    if (i > 0) {
      const prevMs = Date.parse(doc.recentChecks[i - 1].timestamp);
      const currMs = Date.parse(entry.timestamp);
      if (prevMs < currMs) {
        throw new Error('recentChecks must be sorted newest-first');
      }
    }
  }

  if (doc.currentStatus === null) {
    if (dayKeys.length > 0 || doc.recentChecks.length > 0) {
      throw new Error('Non-empty document must have currentStatus');
    }
  } else {
    if (!isPlainObject(doc.currentStatus)) {
      throw new Error('currentStatus must be a plain object');
    }
    assertExactKeys(doc.currentStatus, CURRENT_STATUS_KEYS, 'currentStatus');
    if (!VALID_STATUSES.has(doc.currentStatus.status)) {
      throw new Error('currentStatus.status is invalid');
    }
    normalizeIsoUtc(doc.currentStatus.checkedAt, 'currentStatus.checkedAt', true);
    if (doc.currentStatus.httpStatus !== null) {
      if (
        !Number.isInteger(doc.currentStatus.httpStatus) ||
        doc.currentStatus.httpStatus < 100 ||
        doc.currentStatus.httpStatus > 599
      ) {
        throw new Error('currentStatus.httpStatus is invalid');
      }
    }
    if (doc.currentStatus.latencyMs !== null) {
      if (!Number.isInteger(doc.currentStatus.latencyMs) || doc.currentStatus.latencyMs < 0) {
        throw new Error('currentStatus.latencyMs is invalid');
      }
    }
    if (!VALID_REASONS.has(doc.currentStatus.reason)) {
      throw new Error('currentStatus.reason is invalid');
    }
    if (doc.currentStatus.status === 'online' && doc.currentStatus.reason !== 'ok') {
      throw new Error('currentStatus online must have reason ok');
    }
    if (doc.currentStatus.status === 'offline' && doc.currentStatus.reason === 'ok') {
      throw new Error('currentStatus offline cannot have reason ok');
    }
  }

  return true;
}

export function mergeChecksIntoDocument(doc, checks, { now = () => new Date() } = {}) {
  if (!Array.isArray(checks)) {
    throw new TypeError('checks must be an array');
  }
  validateStatusDocument(doc);

  const next = cloneDocument(doc);
  const seenTimestamps = new Set(next.recentChecks.map((entry) => entry.timestamp));

  // Snapshot pre-existing historical day boundaries so repeated backfill runs remain
  // idempotent even for older days whose checks rotated out of the 200-entry window.
  const priorHistoricalLastMs = new Map();
  for (const [dateKey, day] of Object.entries(next.days)) {
    if (day.sources.includes('historical')) {
      priorHistoricalLastMs.set(dateKey, Date.parse(day.lastCheckedAt));
    }
  }

  for (const rawCheck of checks) {
    const check = normalizeCheck(rawCheck);
    const checkMs = Date.parse(check.timestamp);

    if (seenTimestamps.has(check.timestamp)) {
      continue;
    }
    if (check.source === 'historical') {
      const priorCutoff = priorHistoricalLastMs.get(check.date);
      if (priorCutoff !== undefined && checkMs <= priorCutoff) {
        continue;
      }
    }

    seenTimestamps.add(check.timestamp);

    const existingDay = next.days[check.date];
    if (!existingDay) {
      next.days[check.date] = {
        date: check.date,
        status: check.status,
        checks: 1,
        up: check.status === 'online' ? 1 : 0,
        down: check.status === 'offline' ? 1 : 0,
        lastCheckedAt: check.timestamp,
        lastHttpStatus: check.httpStatus,
        lastReason: check.reason,
        sources: [check.source],
      };
    } else {
      existingDay.checks += 1;
      if (check.status === 'online') {
        existingDay.up += 1;
      } else {
        existingDay.down += 1;
      }
      existingDay.status = existingDay.down > 0 ? 'offline' : 'online';
      existingDay.sources = canonicalizeSources([...existingDay.sources, check.source]);

      if (checkMs >= Date.parse(existingDay.lastCheckedAt)) {
        existingDay.lastCheckedAt = check.timestamp;
        existingDay.lastHttpStatus = check.httpStatus;
        existingDay.lastReason = check.reason;
      }
    }

    if (!next.currentStatus || checkMs >= Date.parse(next.currentStatus.checkedAt)) {
      next.currentStatus = {
        status: check.status,
        checkedAt: check.timestamp,
        httpStatus: check.httpStatus,
        latencyMs: check.latencyMs,
        reason: check.reason,
      };
    }

    next.recentChecks.push(check);
  }

  const sortedDays = {};
  const dayKeys = Object.keys(next.days).sort(compareDateKeys);
  for (const key of dayKeys) {
    sortedDays[key] = next.days[key];
  }
  next.days = sortedDays;
  next.historyStartDate = dayKeys.length > 0 ? dayKeys[0] : null;

  next.recentChecks.sort((a, b) => {
    const diff = Date.parse(b.timestamp) - Date.parse(a.timestamp);
    return diff !== 0 ? diff : b.timestamp.localeCompare(a.timestamp);
  });
  if (next.recentChecks.length > MAX_RECENT_CHECKS) {
    next.recentChecks = next.recentChecks.slice(0, MAX_RECENT_CHECKS);
  }

  next.generatedAt = toDate(now()).toISOString();
  validateStatusDocument(next);
  return next;
}

export function mergeCheckIntoDocument(doc, check, options = {}) {
  return mergeChecksIntoDocument(doc, [check], options);
}

export const mergeChecks = mergeChecksIntoDocument;
export const recordCheck = mergeCheckIntoDocument;
