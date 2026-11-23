export const SCHOOL_TIMEZONE = 'Europe/Prague';

const PRAGUE_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHOOL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// hourCycle 'h23' prevents ICU from formatting midnight as 24:00:00.
const PRAGUE_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHOOL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsToRecord(parts) {
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      out[part.type] = part.value;
    }
  }
  return out;
}

export function toDate(input) {
  if (input instanceof Date) {
    const ms = input.getTime();
    if (!Number.isFinite(ms)) {
      throw new RangeError('Invalid timestamp');
    }
    return new Date(ms);
  }
  if (typeof input === 'string') {
    if (input.trim() === '') {
      throw new RangeError('Invalid timestamp');
    }
    const parsed = new Date(input);
    if (!Number.isFinite(parsed.getTime())) {
      throw new RangeError('Invalid timestamp');
    }
    return parsed;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new RangeError('Invalid timestamp');
    }
    const parsed = new Date(input);
    if (!Number.isFinite(parsed.getTime())) {
      throw new RangeError('Invalid timestamp');
    }
    return parsed;
  }
  throw new RangeError('Invalid timestamp');
}

export function toPragueDateKey(input) {
  const date = toDate(input);
  const { year, month, day } = partsToRecord(PRAGUE_DATE_FORMATTER.formatToParts(date));
  return `${year}-${month}-${day}`;
}

export function getPragueTodayKey(now = new Date()) {
  return toPragueDateKey(now);
}

export function formatPragueDateTime(input) {
  const date = toDate(input);
  const { year, month, day, hour, minute, second, timeZoneName } = partsToRecord(
    PRAGUE_DATETIME_FORMATTER.formatToParts(date),
  );
  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${timeZoneName}`;
}

export function parseDateKey(dateKey) {
  if (typeof dateKey !== 'string') {
    throw new RangeError('Invalid date key');
  }
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    throw new RangeError('Invalid date key');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    throw new RangeError('Invalid calendar date key');
  }
  return { year, month, day };
}

export function compareDateKeys(a, b) {
  parseDateKey(a);
  parseDateKey(b);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function enumerateDateKeys(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  if (startDateKey > endDateKey) {
    return [];
  }
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  const keys = [];
  while (cursor.getTime() <= endMs) {
    const y = String(cursor.getUTCFullYear()).padStart(4, '0');
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    keys.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}
