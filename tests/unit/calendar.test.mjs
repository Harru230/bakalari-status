import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  clampMonth,
  computeOverallStats,
  formatMonthHeading,
  getCalendarBounds,
  getDaysInMonth,
  getMondayFirstOffset,
  parseMonthKey,
  pickInitialSelectedDate,
  stepMonth,
} from '../../src/lib/calendar.mjs';

const EMOJI_PATTERN = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

describe('calendar.mjs', () => {
  it('calculates Monday-first offsets and month lengths including leap years', () => {
    assert.deepEqual(WEEKDAY_LABELS, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

    // Sep 2026 starts on Tuesday (offset 1) and has 30 days
    assert.equal(getMondayFirstOffset(2026, 9), 1);
    assert.equal(getDaysInMonth(2026, 9), 30);

    // Oct 2026 starts on Thursday (offset 3) and has 31 days
    assert.equal(getMondayFirstOffset(2026, 10), 3);
    assert.equal(getDaysInMonth(2026, 10), 31);

    // Nov 2026 starts on Sunday (offset 6) and has 30 days
    assert.equal(getMondayFirstOffset(2026, 11), 6);
    assert.equal(getDaysInMonth(2026, 11), 30);

    // Leap years vs non-leap years
    assert.equal(getDaysInMonth(2027, 2), 28);
    assert.equal(getDaysInMonth(2028, 2), 29);
    assert.equal(getDaysInMonth(2100, 2), 28);
  });

  it('navigates across year boundaries and clamps within data bounds', () => {
    assert.deepEqual(addMonths({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
    assert.deepEqual(addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
    assert.deepEqual(parseMonthKey('2026-09'), { year: 2026, month: 9 });
    assert.equal(formatMonthHeading(2026, 11), 'November 2026');

    const statusDoc = {
      historyStartDate: '2026-09-17',
      days: {
        '2026-09-17': { status: 'offline', checks: 2, up: 1, down: 1 },
        '2026-11-23': { status: 'offline', checks: 3, up: 2, down: 1 },
      },
    };
    const now = new Date('2026-11-23T14:00:00.000Z');
    const bounds = getCalendarBounds(statusDoc, now);

    assert.equal(bounds.todayKey, '2026-11-23');
    assert.deepEqual(bounds.minMonth, { year: 2026, month: 9 });
    assert.deepEqual(bounds.maxMonth, { year: 2026, month: 11 });
    assert.equal(bounds.hasData, true);

    assert.deepEqual(clampMonth({ year: 2025, month: 12 }, bounds), { year: 2026, month: 9 });
    assert.deepEqual(clampMonth({ year: 2027, month: 2 }, bounds), { year: 2026, month: 11 });

    assert.deepEqual(stepMonth({ year: 2026, month: 9 }, -1, bounds), {
      year: 2026,
      month: 9,
      canPrev: false,
      canNext: true,
    });
    assert.deepEqual(stepMonth({ year: 2026, month: 11 }, 1, bounds), {
      year: 2026,
      month: 11,
      canPrev: true,
      canNext: false,
    });

    // Extreme year boundaries (1970-01 stepping back, 9999-12 stepping forward) clamp without throwing
    const extremeBounds = {
      minMonth: { year: 1970, month: 1 },
      maxMonth: { year: 9999, month: 12 },
    };
    assert.deepEqual(stepMonth({ year: 1970, month: 1 }, -1, extremeBounds), {
      year: 1970,
      month: 1,
      canPrev: false,
      canNext: true,
    });
    assert.deepEqual(stepMonth({ year: 9999, month: 12 }, 1, extremeBounds), {
      year: 9999,
      month: 12,
      canPrev: true,
      canNext: false,
    });
    assert.deepEqual(stepMonth({ year: 1970, month: 1 }, -1, bounds), {
      year: 2026,
      month: 9,
      canPrev: false,
      canNext: true,
    });
    assert.deepEqual(stepMonth({ year: 9999, month: 12 }, 1, bounds), {
      year: 2026,
      month: 11,
      canPrev: true,
      canNext: false,
    });
  });

  it('aligns today matching and month rollovers strictly to Europe/Prague (CET and CEST)', () => {
    const statusDoc = {
      historyStartDate: '2026-07-01',
      days: {
        '2026-07-16': { status: 'online', checks: 2, up: 2, down: 0 },
        '2026-11-24': { status: 'online', checks: 1, up: 1, down: 0 },
      },
    };

    // 23:30 UTC on Nov 23 is 00:30 CET on Nov 24 in Prague
    const cetRollover = new Date('2026-11-23T23:30:00.000Z');
    const novGrid = buildMonthGrid({ year: 2026, month: 11, statusDoc, now: cetRollover });
    const nov24 = novGrid.days.find((d) => d.dateKey === '2026-11-24');
    assert.equal(nov24?.isToday, true);
    assert.equal(nov24?.status, 'online');
    assert.match(nov24?.ariaLabel ?? '', /today/i);

    // 23:30 UTC on Nov 30 is 00:30 CET on Dec 1 in Prague
    const monthRollover = new Date('2026-11-30T23:30:00.000Z');
    const decBounds = getCalendarBounds(statusDoc, monthRollover);
    assert.equal(decBounds.todayKey, '2026-12-01');
    assert.deepEqual(decBounds.maxMonth, { year: 2026, month: 12 });

    // 22:30 UTC on Jul 15 is 00:30 CEST on Jul 16 in Prague
    const cestRollover = new Date('2026-07-15T22:30:00.000Z');
    const julGrid = buildMonthGrid({ year: 2026, month: 7, statusDoc, now: cestRollover });
    const jul16 = julGrid.days.find((d) => d.dateKey === '2026-07-16');
    assert.equal(jul16?.isToday, true);
  });

  it('derives pre-history, mixed-outage, empty-data states and clean labels without emojis or em dashes', () => {
    const statusDoc = {
      historyStartDate: '2026-09-17',
      days: {
        '2026-09-17': {
          date: '2026-09-17',
          status: 'offline',
          checks: 2,
          up: 1,
          down: 1,
          lastCheckedAt: '2026-09-17T18:00:00.000Z',
          lastHttpStatus: 200,
          lastReason: 'ok',
          sources: ['historical'],
        },
        '2026-09-18': {
          date: '2026-09-18',
          status: 'online',
          checks: 4,
          up: 4,
          down: 0,
          lastCheckedAt: '2026-09-18T18:00:00.000Z',
          lastHttpStatus: 200,
          lastReason: 'ok',
          sources: ['historical'],
        },
      },
    };

    const sepGrid = buildMonthGrid({
      year: 2026,
      month: 9,
      statusDoc,
      now: new Date('2026-09-20T12:00:00.000Z'),
    });

    assert.equal(sepGrid.leadingEmptyCount, 1);
    assert.equal(sepGrid.days.length, 30);
    assert.equal((sepGrid.leadingEmptyCount + sepGrid.days.length + sepGrid.trailingEmptyCount) % 7, 0);

    const sep16 = sepGrid.days[15];
    assert.equal(sep16.dateKey, '2026-09-16');
    assert.equal(sep16.status, 'unmonitored');
    assert.equal(sep16.isPreHistory, true);
    assert.match(sep16.ariaLabel, /before monitoring started/i);

    const sep17 = sepGrid.days[16];
    assert.equal(sep17.status, 'offline');
    assert.match(sep17.ariaLabel, /^2026-09-17: Offline/);

    const sep25 = sepGrid.days[24];
    assert.equal(sep25.isFuture, true);
    assert.equal(sep25.status, 'unmonitored');
    assert.match(sep25.ariaLabel, /future date/i);

    for (const d of sepGrid.days) {
      assert.equal(EMOJI_PATTERN.test(d.ariaLabel), false);
      assert.equal(d.ariaLabel.includes('\u2014'), false);
      assert.equal(d.ariaLabel.includes(' -- '), false);
    }

    assert.equal(sepGrid.summary.monitoredDays, 2);
    assert.equal(sepGrid.summary.onlineDays, 1);
    assert.equal(sepGrid.summary.offlineDays, 1);
    assert.equal(sepGrid.summary.totalChecks, 6);

    const stats = computeOverallStats(statusDoc);
    assert.equal(stats.totalDays, 2);
    assert.equal(stats.maxOfflineStreak.days, 1);
    assert.equal(stats.currentStreak.status, 'online');
    assert.equal(stats.currentStreak.days, 1);

    assert.equal(pickInitialSelectedDate(sepGrid, '2026-09-20'), '2026-09-18');

    // Empty status doc
    const emptyDoc = { historyStartDate: '2026-09-17', days: {} };
    const emptyBounds = getCalendarBounds(emptyDoc, new Date('2026-11-23T12:00:00.000Z'));
    assert.equal(emptyBounds.hasData, false);
    const emptyGrid = buildMonthGrid({
      year: 2026,
      month: 11,
      statusDoc: emptyDoc,
      now: new Date('2026-11-23T12:00:00.000Z'),
    });
    assert.equal(emptyGrid.summary.monitoredDays, 0);
    assert.ok(emptyGrid.days.every((d) => d.status === 'unmonitored'));
  });

  it('derives total checks from up + down when checks is omitted in buildMonthGrid and computeOverallStats', () => {
    const partialDoc = {
      historyStartDate: '2026-11-18',
      days: {
        '2026-11-18': {
          up: 99,
          down: 1,
          lastReason: 'ok',
          lastHttpStatus: 200,
        },
        '2026-11-19': {
          up: 5,
          down: 0,
          lastReason: 'ok',
          lastHttpStatus: 200,
        },
      },
    };

    const grid = buildMonthGrid({
      year: 2026,
      month: 11,
      statusDoc: partialDoc,
      now: new Date('2026-11-19T12:00:00.000Z'),
    });

    const nov18 = grid.days.find((d) => d.dateKey === '2026-11-18');
    const nov19 = grid.days.find((d) => d.dateKey === '2026-11-19');
    assert.equal(nov18?.status, 'offline');
    assert.equal(nov18?.checks, 100);
    assert.equal(nov18?.up, 99);
    assert.equal(nov18?.down, 1);
    assert.equal(nov19?.status, 'online');
    assert.equal(nov19?.checks, 5);
    assert.equal(grid.summary.totalChecks, 105);
    assert.equal(grid.summary.totalUp, 104);
    assert.equal(grid.summary.totalDown, 1);

    const stats = computeOverallStats(partialDoc);
    assert.equal(stats.totalDays, 2);
    assert.equal(stats.onlineDays, 1);
    assert.equal(stats.offlineDays, 1);
    assert.equal(stats.totalChecks, 105);
    assert.equal(stats.totalUp, 104);
    assert.equal(stats.totalDown, 1);
  });
});
