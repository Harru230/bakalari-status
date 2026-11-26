import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker, { getPragueHour, runScheduledTrigger } from '../../worker/src/index.js';

describe('Cloudflare Worker cron trigger', () => {
  it('maps UTC instants to Europe/Prague 24-hour clock across CET and CEST', () => {
    assert.equal(getPragueHour('2026-11-26T05:00:00Z'), '06');
    assert.equal(getPragueHour('2026-07-15T04:00:00Z'), '06');
    assert.equal(getPragueHour('2026-11-26T14:00:00Z'), '15');
  });

  it('dispatches only status-pages.yml outside 06:xx Europe/Prague', async () => {
    const calls = [];
    const mockFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 204 };
    };

    const result = await runScheduledTrigger(
      '2026-11-26T14:00:00Z',
      { GH_DISPATCH_TOKEN: 'mock-tok' },
      mockFetch,
    );

    assert.equal(result.pragueHour, '15');
    assert.deepEqual(result.dispatched, ['status-pages.yml']);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://api.github.com/repos/Harru230/bakalari-status/actions/workflows/status-pages.yml/dispatches',
    );
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, JSON.stringify({ ref: 'main' }));
  });

  it('dispatches both status-pages.yml and timetable.yml at 06:00 CET and 06:00 CEST', async () => {
    for (const utcIso of ['2026-11-26T05:00:00Z', '2026-07-15T04:00:00Z']) {
      const dispatchedUrls = [];
      const mockFetch = async (url) => {
        dispatchedUrls.push(url);
        return { ok: true, status: 204 };
      };

      const result = await runScheduledTrigger(
        utcIso,
        { GH_DISPATCH_TOKEN: 'mock-tok' },
        mockFetch,
      );

      assert.equal(result.pragueHour, '06');
      assert.deepEqual(result.dispatched, ['status-pages.yml', 'timetable.yml']);
      assert.equal(dispatchedUrls.length, 2);
      assert.ok(dispatchedUrls[0].endsWith('/status-pages.yml/dispatches'));
      assert.ok(dispatchedUrls[1].endsWith('/timetable.yml/dispatches'));
    }
  });

  it('rejects cleanly when GH_DISPATCH_TOKEN is missing or GitHub returns an error', async () => {
    await assert.rejects(
      () => runScheduledTrigger('2026-11-26T14:00:00Z', {}, async () => ({ ok: true, status: 204 })),
      /Missing GH_DISPATCH_TOKEN/,
    );

    for (const errStatus of [403, 500]) {
      await assert.rejects(
        () =>
          runScheduledTrigger(
            '2026-11-26T14:00:00Z',
            { GH_DISPATCH_TOKEN: 'mock-tok' },
            async () => ({ ok: false, status: errStatus }),
          ),
        new RegExp(`HTTP ${errStatus}`),
      );
    }
  });

  it('returns HTTP 200 on fetch() without triggering workflow dispatches', async () => {
    const res = await worker.fetch();
    assert.equal(res.status, 200);
    assert.match(await res.text(), /ok/);
  });
});
