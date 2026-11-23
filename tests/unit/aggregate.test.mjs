import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_RECENT_CHECKS,
  createEmptyStatusDocument,
  mergeCheckIntoDocument,
  mergeChecksIntoDocument,
  normalizeCheck,
  sanitizeCheck,
  validateStatusDocument,
} from '../../src/lib/aggregate.mjs';
import {
  SCHOOL_TIMEZONE,
  compareDateKeys,
  enumerateDateKeys,
  formatPragueDateTime,
  getPragueTodayKey,
  parseDateKey,
  toDate,
  toPragueDateKey,
} from '../../src/lib/timezone.mjs';
import { runBackfill } from '../../scripts/backfill.mjs';

describe('Europe/Prague timezone helpers', () => {
  it('maps CET, CEST, DST transitions, and year boundaries accurately', () => {
    assert.equal(SCHOOL_TIMEZONE, 'Europe/Prague');
    assert.equal(toPragueDateKey('2026-03-29T00:59:59.000Z'), '2026-03-29');
    assert.equal(toPragueDateKey('2026-03-29T01:00:00.000Z'), '2026-03-29');
    assert.equal(toPragueDateKey('2026-07-15T21:59:59.999Z'), '2026-07-15');
    assert.equal(toPragueDateKey('2026-07-15T22:00:00.000Z'), '2026-07-16');
    assert.equal(toPragueDateKey('2026-07-15T22:30:00.000Z'), '2026-07-16');
    assert.equal(toPragueDateKey('2026-09-16T22:00:00.000Z'), '2026-09-17');
    assert.equal(toPragueDateKey('2026-10-25T00:59:59.000Z'), '2026-10-25');
    assert.equal(toPragueDateKey('2026-10-25T01:00:00.000Z'), '2026-10-25');
    assert.equal(toPragueDateKey('2026-11-23T22:59:59.999Z'), '2026-11-23');
    assert.equal(toPragueDateKey('2026-11-23T23:00:00.000Z'), '2026-11-24');
    assert.equal(toPragueDateKey('2026-11-23T23:30:00.000Z'), '2026-11-24');
    assert.equal(toPragueDateKey('2026-12-31T23:00:00.000Z'), '2027-01-01');
    assert.equal(getPragueTodayKey(new Date('2026-11-23T23:30:00.000Z')), '2026-11-24');
  });

  it('formats Prague datetimes with hourCycle h23 and CEST/CET labels', () => {
    assert.equal(formatPragueDateTime('2026-07-15T22:30:00.000Z'), '2026-07-16 00:30:00 CEST');
    assert.equal(formatPragueDateTime('2026-11-23T23:30:00.000Z'), '2026-11-24 00:30:00 CET');
  });

  it('validates timestamps, calendar date keys, comparisons, and enumerations', () => {
    assert.throws(() => toDate(''), RangeError);
    assert.throws(() => toDate(null), RangeError);
    assert.throws(() => toDate('not-a-date'), RangeError);
    assert.throws(() => toDate(Number.NaN), RangeError);

    assert.deepEqual(parseDateKey('2026-02-28'), { year: 2026, month: 2, day: 28 });
    assert.throws(() => parseDateKey('2026-02-30'), RangeError);
    assert.throws(() => parseDateKey('2026-13-01'), RangeError);
    assert.throws(() => parseDateKey('2026/11/23'), RangeError);

    assert.equal(compareDateKeys('2026-11-22', '2026-11-23'), -1);
    assert.equal(compareDateKeys('2026-11-23', '2026-11-23'), 0);
    assert.equal(compareDateKeys('2026-11-24', '2026-11-23'), 1);

    assert.deepEqual(enumerateDateKeys('2026-03-28', '2026-03-30'), [
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
    assert.deepEqual(enumerateDateKeys('2026-03-30', '2026-03-28'), []);
  });
});

describe('status aggregation and validation', () => {
  it('enforces the strict outage daily rule while updating latest check fields', () => {
    let doc = createEmptyStatusDocument({ now: () => new Date('2026-11-23T08:00:00.000Z') });
    doc = mergeChecksIntoDocument(
      doc,
      [
        {
          timestamp: '2026-11-23T07:00:00Z',
          status: 'offline',
          httpStatus: null,
          latencyMs: 12001,
          reason: 'timeout',
          source: 'probe',
        },
        {
          timestamp: '2026-11-23T09:00:00Z',
          status: 'online',
          httpStatus: 200,
          latencyMs: 140,
          reason: 'ok',
          source: 'probe',
        },
        {
          timestamp: '2026-11-23T10:00:00Z',
          status: 'online',
          httpStatus: 200,
          latencyMs: 110,
          reason: 'ok',
          source: 'probe',
        },
      ],
      { now: () => new Date('2026-11-23T10:00:00.000Z') },
    );

    const day = doc.days['2026-11-23'];
    assert.equal(day.checks, 3);
    assert.equal(day.up, 2);
    assert.equal(day.down, 1);
    assert.equal(day.status, 'offline');
    assert.equal(day.lastCheckedAt, '2026-11-23T10:00:00.000Z');
    assert.equal(day.lastHttpStatus, 200);
    assert.equal(day.lastReason, 'ok');
    assert.equal(doc.currentStatus.status, 'online');
  });

  it('splits cross-midnight CET checks into separate day buckets', () => {
    let doc = createEmptyStatusDocument();
    doc = mergeChecksIntoDocument(doc, [
      {
        timestamp: '2026-11-23T22:30:00.000Z',
        status: 'online',
        httpStatus: 200,
        latencyMs: 80,
        reason: 'ok',
        source: 'probe',
      },
      {
        timestamp: '2026-11-23T23:31:00.000Z',
        status: 'offline',
        httpStatus: 503,
        latencyMs: 45,
        reason: 'non_200',
        source: 'probe',
      },
    ]);

    assert.deepEqual(Object.keys(doc.days), ['2026-11-23', '2026-11-24']);
    assert.equal(doc.days['2026-11-23'].status, 'online');
    assert.equal(doc.days['2026-11-24'].status, 'offline');
  });

  it('is idempotent for duplicate timestamps inside and outside the 200-check window', () => {
    let doc = createEmptyStatusDocument();
    const firstBatch = [];
    for (let i = 0; i < 210; i += 1) {
      const ts = new Date(Date.UTC(2026, 8, 17, 10, 0, 0) + i * 3600_000).toISOString();
      firstBatch.push({
        timestamp: ts,
        status: 'online',
        httpStatus: 200,
        latencyMs: null,
        reason: 'ok',
        source: 'historical',
      });
    }

    doc = mergeChecksIntoDocument(doc, firstBatch);
    assert.equal(doc.recentChecks.length, MAX_RECENT_CHECKS);
    const initialTotal = Object.values(doc.days).reduce((sum, d) => sum + d.checks, 0);
    assert.equal(initialTotal, 210);

    // Re-ingest both an old rotated-out check and a recent check.
    doc = mergeChecksIntoDocument(doc, [firstBatch[0], firstBatch[209]]);
    const afterTotal = Object.values(doc.days).reduce((sum, d) => sum + d.checks, 0);
    assert.equal(afterTotal, 210);
    assert.equal(doc.recentChecks.length, MAX_RECENT_CHECKS);
  });

  it('canonicalizes sources regardless of merge order and rejects invalid sources', () => {
    let doc = createEmptyStatusDocument();
    doc = mergeCheckIntoDocument(doc, {
      timestamp: '2026-11-23T12:00:00Z',
      status: 'online',
      httpStatus: 200,
      latencyMs: 95,
      reason: 'ok',
      source: 'probe',
    });
    doc = mergeCheckIntoDocument(doc, {
      timestamp: '2026-11-23T10:00:00Z',
      status: 'online',
      httpStatus: 200,
      latencyMs: null,
      reason: 'ok',
      source: 'historical',
    });

    assert.deepEqual(doc.days['2026-11-23'].sources, ['historical', 'probe']);
    assert.throws(
      () =>
        normalizeCheck({
          timestamp: '2026-11-23T12:00:00Z',
          status: 'online',
          httpStatus: 200,
          latencyMs: 50,
          reason: 'ok',
          source: 'manual',
        }),
      /Invalid source/,
    );
  });

  it('sorts recentChecks newest-first, caps at 200, and preserves currentStatus against older checks', () => {
    let doc = createEmptyStatusDocument();
    doc = mergeCheckIntoDocument(doc, {
      timestamp: '2026-11-23T14:00:00.000Z',
      status: 'offline',
      httpStatus: null,
      latencyMs: 12002,
      reason: 'timeout',
      source: 'probe',
    });

    const olderChecks = [];
    for (let i = 0; i < 224; i += 1) {
      olderChecks.push({
        timestamp: new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + (223 - i) * 3600_000).toISOString(),
        status: 'online',
        httpStatus: 200,
        latencyMs: null,
        reason: 'ok',
        source: 'historical',
      });
    }

    doc = mergeChecksIntoDocument(doc, olderChecks);
    assert.equal(doc.recentChecks.length, 200);
    assert.equal(doc.recentChecks[0].timestamp, '2026-11-23T14:00:00.000Z');
    assert.equal(doc.currentStatus.checkedAt, '2026-11-23T14:00:00.000Z');
    assert.equal(doc.currentStatus.status, 'offline');
    const totalChecks = Object.values(doc.days).reduce((sum, d) => sum + d.checks, 0);
    assert.equal(totalChecks, 225);
  });

  it('strips unexpected properties in normalizeCheck and rejects them in sanitizeCheck', () => {
    const normalized = normalizeCheck({
      timestamp: '2026-11-23T12:00:00Z',
      status: 'online',
      httpStatus: 200,
      latencyMs: 55,
      reason: 'ok',
      source: 'probe',
      extraMetadata: 'should-be-stripped',
    });
    assert.equal('extraMetadata' in normalized, false);
    assert.throws(
      () =>
        sanitizeCheck({
          timestamp: '2026-11-23T12:00:00Z',
          status: 'online',
          httpStatus: 200,
          latencyMs: null,
          reason: 'ok',
          source: 'historical',
          runId: 12345,
        }),
      /unexpected key/i,
    );
  });

  it('rejects schema violations in validateStatusDocument', () => {
    const valid = mergeCheckIntoDocument(createEmptyStatusDocument(), {
      timestamp: '2026-11-23T12:00:00Z',
      status: 'online',
      httpStatus: 200,
      latencyMs: 50,
      reason: 'ok',
      source: 'probe',
    });

    const brokenTotals = structuredClone(valid);
    brokenTotals.days['2026-11-23'].up = 99;
    assert.throws(() => validateStatusDocument(brokenTotals), /checks !== up \+ down/);

    const brokenStatus = structuredClone(valid);
    brokenStatus.days['2026-11-23'].status = 'offline';
    assert.throws(() => validateStatusDocument(brokenStatus), /must be online/);
  });

  it('supports backfill CLI --replace-historical while retaining probe checks', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bakalari-backfill-test-'));
    const inputPath = path.join(tmpDir, 'input.json');
    const outPath = path.join(tmpDir, 'status.json');
    try {
      const existing = mergeCheckIntoDocument(createEmptyStatusDocument(), {
        timestamp: '2026-11-23T14:05:00.000Z',
        status: 'offline',
        httpStatus: null,
        latencyMs: 12000,
        reason: 'timeout',
        source: 'probe',
      });
      await fs.writeFile(outPath, JSON.stringify(existing, null, 2), 'utf8');

      await fs.writeFile(
        inputPath,
        JSON.stringify([
          {
            timestamp: '2026-11-22T10:00:00Z',
            status: 'online',
            httpStatus: 200,
            latencyMs: null,
            reason: 'ok',
            source: 'historical',
          },
          {
            timestamp: '2026-11-23T08:00:00Z',
            status: 'online',
            httpStatus: 200,
            latencyMs: null,
            reason: 'ok',
            source: 'historical',
          },
        ]),
        'utf8',
      );

      const logs = [];
      const doc = await runBackfill({
        inputPath,
        outPath,
        replaceHistorical: true,
        logger: { log: (line) => logs.push(line) },
      });

      assert.equal(doc.historyStartDate, '2026-11-22');
      assert.equal(doc.days['2026-11-23'].checks, 2);
      assert.deepEqual(doc.days['2026-11-23'].sources, ['historical', 'probe']);
      assert.equal(doc.currentStatus.status, 'offline');
      assert.equal(logs.length, 1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
