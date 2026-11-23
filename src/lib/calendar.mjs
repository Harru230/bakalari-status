import {
  compareDateKeys,
  getPragueTodayKey,
  parseDateKey,
} from './timezone.mjs';

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MONTH_NAMES = [
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

export const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const WEEKDAY_LONG_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function assertValidYearMonth(year, month) {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new RangeError('Invalid year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('Invalid month');
  }
}

export function formatDateKey(year, month, day) {
  assertValidYearMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > getDaysInMonth(year, month)) {
    throw new RangeError('Invalid day for month');
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseMonthKey(monthKey) {
  if (typeof monthKey !== 'string') {
    throw new RangeError('Invalid month key');
  }
  const match = MONTH_KEY_PATTERN.exec(monthKey);
  if (!match) {
    throw new RangeError('Invalid month key');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  assertValidYearMonth(year, month);
  return { year, month };
}

export function formatMonthHeading(year, month) {
  assertValidYearMonth(year, month);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function formatEnglishDate(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

export function formatEnglishFullDate(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAY_LONG_NAMES[utcDay]}, ${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

export function formatShortDate(dateKey) {
  const { month, day } = parseDateKey(dateKey);
  return `${MONTH_SHORT_NAMES[month - 1]} ${day}`;
}

export function getDaysInMonth(year, month) {
  assertValidYearMonth(year, month);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function getMondayFirstOffset(year, month) {
  assertValidYearMonth(year, month);
  const sundayFirst = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

export function monthIndex({ year, month }) {
  assertValidYearMonth(year, month);
  return year * 12 + (month - 1);
}

export function compareMonths(a, b) {
  const idxA = monthIndex(a);
  const idxB = monthIndex(b);
  if (idxA < idxB) return -1;
  if (idxA > idxB) return 1;
  return 0;
}

export function addMonths({ year, month }, delta) {
  assertValidYearMonth(year, month);
  if (!Number.isInteger(delta)) {
    throw new RangeError('Invalid month delta');
  }
  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = ((total % 12) + 12) % 12 + 1;
  return { year: nextYear, month: nextMonth };
}

export function addDaysToDateKey(dateKey, deltaDays) {
  const { year, month, day } = parseDateKey(dateKey);
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
  const y = String(utc.getUTCFullYear()).padStart(4, '0');
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getPragueTodayParts(now = new Date()) {
  const dateKey = getPragueTodayKey(now);
  const { year, month, day } = parseDateKey(dateKey);
  return { dateKey, year, month, day };
}

function tryParseDateKey(value) {
  if (typeof value !== 'string') return null;
  try {
    return { dateKey: value, ...parseDateKey(value) };
  } catch {
    return null;
  }
}

export function getCalendarBounds(statusDoc, now = new Date()) {
  const todayParts = getPragueTodayParts(now);
  const todayMonth = { year: todayParts.year, month: todayParts.month };

  const daysMap = statusDoc && typeof statusDoc.days === 'object' && statusDoc.days !== null
    ? statusDoc.days
    : {};
  const validDayKeys = Object.keys(daysMap)
    .filter((key) => tryParseDateKey(key) !== null)
    .sort(compareDateKeys);

  const hasData = validDayKeys.length > 0;
  const parsedHistoryStart = tryParseDateKey(statusDoc?.historyStartDate);
  const earliestDayKey = validDayKeys[0] ?? null;

  let historyStartDate = null;
  if (parsedHistoryStart && earliestDayKey) {
    historyStartDate = compareDateKeys(parsedHistoryStart.dateKey, earliestDayKey) <= 0
      ? parsedHistoryStart.dateKey
      : earliestDayKey;
  } else if (parsedHistoryStart) {
    historyStartDate = parsedHistoryStart.dateKey;
  } else if (earliestDayKey) {
    historyStartDate = earliestDayKey;
  }

  const minAnchor = historyStartDate ?? todayParts.dateKey;
  const minParsed = parseDateKey(minAnchor);
  const minMonth = { year: minParsed.year, month: minParsed.month };

  let maxMonth = todayMonth;
  if (validDayKeys.length > 0) {
    const latestParsed = parseDateKey(validDayKeys[validDayKeys.length - 1]);
    const latestMonth = { year: latestParsed.year, month: latestParsed.month };
    if (compareMonths(latestMonth, maxMonth) > 0) {
      maxMonth = latestMonth;
    }
  }

  if (compareMonths(minMonth, maxMonth) > 0) {
    return {
      todayKey: todayParts.dateKey,
      todayMonth,
      historyStartDate,
      minMonth: maxMonth,
      maxMonth,
      hasData,
    };
  }

  return {
    todayKey: todayParts.dateKey,
    todayMonth,
    historyStartDate,
    minMonth,
    maxMonth,
    hasData,
  };
}

export function clampMonth(monthObj, bounds) {
  if (
    !monthObj ||
    !Number.isInteger(monthObj.year) ||
    !Number.isInteger(monthObj.month) ||
    monthObj.month < 1 ||
    monthObj.month > 12
  ) {
    throw new RangeError('Invalid month object');
  }
  const idx = monthObj.year * 12 + (monthObj.month - 1);
  const minIdx = monthIndex(bounds.minMonth);
  const maxIdx = monthIndex(bounds.maxMonth);
  if (idx < minIdx) {
    return { year: bounds.minMonth.year, month: bounds.minMonth.month };
  }
  if (idx > maxIdx) {
    return { year: bounds.maxMonth.year, month: bounds.maxMonth.month };
  }
  return { year: monthObj.year, month: monthObj.month };
}

export function canGoPrev(monthObj, bounds) {
  return compareMonths(monthObj, bounds.minMonth) > 0;
}

export function canGoNext(monthObj, bounds) {
  return compareMonths(monthObj, bounds.maxMonth) < 0;
}

export function stepMonth(monthObj, deltaMonths, bounds) {
  const clamped = clampMonth(addMonths(monthObj, deltaMonths), bounds);
  return {
    year: clamped.year,
    month: clamped.month,
    canPrev: canGoPrev(clamped, bounds),
    canNext: canGoNext(clamped, bounds),
  };
}

function deriveDayStatus(dayRecord) {
  if (!dayRecord || typeof dayRecord !== 'object') {
    return 'unmonitored';
  }
  const down = Number(dayRecord.down ?? 0);
  const up = Number(dayRecord.up ?? 0);
  const checks = Number(dayRecord.checks ?? (up + down));
  if (down > 0) return 'offline';
  if (up > 0) return 'online';
  if (checks > 0 && dayRecord.status === 'offline') return 'offline';
  if (checks > 0 && dayRecord.status === 'online') return 'online';
  if (dayRecord.status === 'offline' || dayRecord.status === 'online') {
    return dayRecord.status;
  }
  return 'unmonitored';
}

export function buildDayAriaLabel({
  dateKey,
  status,
  dayRecord,
  isToday = false,
  isFuture = false,
  isPreHistory = false,
}) {
  const todaySuffix = isToday ? ', today' : '';
  if (status === 'online') {
    const up = Number(dayRecord?.up ?? 0);
    const checks = Number(dayRecord?.checks ?? up);
    return `${dateKey}: Online, ${up} of ${checks} checks returned HTTP 200${todaySuffix}`;
  }
  if (status === 'offline') {
    const up = Number(dayRecord?.up ?? 0);
    const down = Number(dayRecord?.down ?? 0);
    const checks = Number(dayRecord?.checks ?? (up + down));
    return `${dateKey}: Offline, ${up} of ${checks} checks passed, ${down} down${todaySuffix}`;
  }
  if (isPreHistory) {
    return `${dateKey}: Unmonitored, before monitoring started${todaySuffix}`;
  }
  if (isFuture) {
    return `${dateKey}: Unmonitored, future date${todaySuffix}`;
  }
  return `${dateKey}: Unmonitored, no checks recorded${todaySuffix}`;
}

export function buildMonthGrid({ year, month, statusDoc, now = new Date() }) {
  assertValidYearMonth(year, month);
  const bounds = getCalendarBounds(statusDoc, now);
  const daysMap = statusDoc && typeof statusDoc.days === 'object' && statusDoc.days !== null
    ? statusDoc.days
    : {};

  const leadingEmptyCount = getMondayFirstOffset(year, month);
  const daysInMonth = getDaysInMonth(year, month);
  const trailingEmptyCount = (7 - ((leadingEmptyCount + daysInMonth) % 7)) % 7;

  const days = [];
  let monitoredDays = 0;
  let onlineDays = 0;
  let offlineDays = 0;
  let totalChecks = 0;
  let totalUp = 0;
  let totalDown = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = formatDateKey(year, month, day);
    const dayRecord = Object.prototype.hasOwnProperty.call(daysMap, dateKey) ? daysMap[dateKey] : null;
    const status = deriveDayStatus(dayRecord);
    const isToday = dateKey === bounds.todayKey;
    const isFuture = compareDateKeys(dateKey, bounds.todayKey) > 0;
    const isPreHistory = Boolean(
      bounds.historyStartDate && compareDateKeys(dateKey, bounds.historyStartDate) < 0,
    );

    const up = status === 'unmonitored' ? 0 : Number(dayRecord?.up ?? 0);
    const down = status === 'unmonitored' ? 0 : Number(dayRecord?.down ?? 0);
    const checks = status === 'unmonitored' ? 0 : Number(dayRecord?.checks ?? (up + down));

    if (status !== 'unmonitored') {
      monitoredDays += 1;
      if (status === 'online') onlineDays += 1;
      if (status === 'offline') offlineDays += 1;
      totalChecks += checks;
      totalUp += up;
      totalDown += down;
    }

    days.push({
      day,
      dateKey,
      status,
      isToday,
      isFuture,
      isPreHistory,
      checks,
      up,
      down,
      lastCheckedAt: dayRecord?.lastCheckedAt ?? null,
      lastHttpStatus: dayRecord?.lastHttpStatus ?? null,
      lastReason: dayRecord?.lastReason ?? null,
      sources: Array.isArray(dayRecord?.sources) ? [...dayRecord.sources] : [],
      ariaLabel: buildDayAriaLabel({
        dateKey,
        status,
        dayRecord,
        isToday,
        isFuture,
        isPreHistory,
      }),
    });
  }

  const currentMonthObj = { year, month };
  return {
    year,
    month,
    heading: formatMonthHeading(year, month),
    weekdays: [...WEEKDAY_LABELS],
    leadingEmptyCount,
    trailingEmptyCount,
    canPrev: canGoPrev(currentMonthObj, bounds),
    canNext: canGoNext(currentMonthObj, bounds),
    isCurrentPragueMonth: compareMonths(currentMonthObj, bounds.todayMonth) === 0,
    days,
    summary: {
      monitoredDays,
      onlineDays,
      offlineDays,
      totalChecks,
      totalUp,
      totalDown,
    },
  };
}

export function computeOverallStats(statusDoc) {
  const daysMap = statusDoc && typeof statusDoc.days === 'object' && statusDoc.days !== null
    ? statusDoc.days
    : {};
  const sortedKeys = Object.keys(daysMap)
    .filter((key) => tryParseDateKey(key) !== null)
    .sort(compareDateKeys);

  let totalDays = 0;
  let onlineDays = 0;
  let offlineDays = 0;
  let totalChecks = 0;
  let totalUp = 0;
  let totalDown = 0;

  let maxOfflineStreak = { days: 0, startDate: null, endDate: null };
  let maxOnlineStreak = { days: 0, startDate: null, endDate: null };

  let runStatus = null;
  let runDays = 0;
  let runStart = null;
  let prevKey = null;

  for (const key of sortedKeys) {
    const rec = daysMap[key];
    const status = deriveDayStatus(rec);
    if (status === 'unmonitored') continue;

    totalDays += 1;
    if (status === 'online') onlineDays += 1;
    if (status === 'offline') offlineDays += 1;

    const up = Number(rec?.up ?? 0);
    const down = Number(rec?.down ?? 0);
    totalChecks += Number(rec?.checks ?? (up + down));
    totalUp += up;
    totalDown += down;

    const isContiguous = prevKey !== null && addDaysToDateKey(prevKey, 1) === key;
    if (isContiguous && status === runStatus) {
      runDays += 1;
    } else {
      runStatus = status;
      runDays = 1;
      runStart = key;
    }
    prevKey = key;

    if (runStatus === 'offline' && runDays >= maxOfflineStreak.days) {
      maxOfflineStreak = { days: runDays, startDate: runStart, endDate: key };
    }
    if (runStatus === 'online' && runDays >= maxOnlineStreak.days) {
      maxOnlineStreak = { days: runDays, startDate: runStart, endDate: key };
    }
  }

  const currentStreak = runStatus
    ? { status: runStatus, days: runDays, startDate: runStart, endDate: prevKey }
    : { status: null, days: 0, startDate: null, endDate: null };

  return {
    totalDays,
    onlineDays,
    offlineDays,
    totalChecks,
    totalUp,
    totalDown,
    currentStreak,
    maxOfflineStreak,
    maxOnlineStreak,
  };
}

export function pickInitialSelectedDate(grid, todayKey) {
  const todayCell = grid.days.find((d) => d.dateKey === todayKey);
  if (todayCell && todayCell.status !== 'unmonitored') {
    return todayCell.dateKey;
  }
  for (let i = grid.days.length - 1; i >= 0; i -= 1) {
    if (grid.days[i].status !== 'unmonitored') {
      return grid.days[i].dateKey;
    }
  }
  if (todayCell) {
    return todayCell.dateKey;
  }
  return grid.days[0]?.dateKey ?? todayKey;
}
