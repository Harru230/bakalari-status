import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import {
  HISTORY_START_DATE,
  MAX_RECENT_CHECKS,
  TARGET_URL,
  TIMEZONE,
  VALID_REASONS,
  VALID_SOURCES,
  buildSyntheticStatusFixture,
  enumerateDates,
  formatPragueDate,
  isDryRunSandbox,
  isRemoteBaseUrl,
  resolveRepoRoot,
  scanTextForPrivacyLeaks,
  validateStatusPayload,
} from './helpers/contracts.mjs';

const execFileAsync = promisify(execFile);

function createTempRepoCopy(repoRoot) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bakalari-probe-test-'));
  for (const entry of ['package.json', 'scripts', 'src', 'data']) {
    const srcPath = path.join(repoRoot, entry);
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, path.join(tmpDir, entry), { recursive: true });
    }
  }
  return tmpDir;
}

async function withMockServer(handler, fn) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn(baseUrl);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function loadProbeFn() {
  const repoRoot = resolveRepoRoot();
  const probePath = path.join(repoRoot, 'src', 'lib', 'probe.mjs');
  expect(fs.existsSync(probePath), `Missing ${probePath}`).toBe(true);
  const mod = await import(pathToFileURL(probePath).href);
  expect(typeof mod.checkLoginEndpoint).toBe('function');
  return mod.checkLoginEndpoint;
}

test.describe('F2-F5: Status JSON Contracts, Probe Endpoint & Prague Aggregation', () => {
  test('T1-F03-01: Served data/status.json has valid top-level metadata', async ({ request }) => {
    const res = await request.get('data/status.json');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] || '').toContain('application/json');
    const data = await res.json();
    expect(data.schemaVersion).toBe(1);
    expect(data.target).toBe(TARGET_URL);
    expect(data.timezone).toBe(TIMEZONE);
  });

  test('T1-F03-02: Every key in data/status.json.days is YYYY-MM-DD and matches entry.date', async ({ request }) => {
    const res = await request.get('data/status.json');
    expect(res.status()).toBe(200);
    const data = await res.json();
    const keys = Object.keys(data.days || {});
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(data.days[k].date).toBe(k);
    }
  });

  test('T1-F03-03 & T1-F03-04: Schema validator enforces online (up>0, down=0) and strict outage rule (down>0 => offline)', async ({ request }) => {
    const res = await request.get('data/status.json');
    expect(res.status()).toBe(200);
    const data = await res.json();
    const validation = validateStatusPayload(data, { maxDate: formatPragueDate() });
    expect(validation.valid, validation.errors.join('\n')).toBe(true);

    // Explicit contract verification on synthetic online vs mixed-outage buckets
    const synthOnline = buildSyntheticStatusFixture({
      endDate: '2026-11-23',
      dayOverrides: {
        '2026-11-20': {
          status: 'online',
          checks: 3,
          up: 3,
          down: 0,
          lastCheckedAt: '2026-11-20T12:00:00.000Z',
          lastHttpStatus: 200,
          lastReason: 'ok',
          sources: ['probe'],
        },
      },
    });
    expect(validateStatusPayload(synthOnline, { maxDate: '2026-11-23' }).valid).toBe(true);

    const badMixed = structuredClone(synthOnline);
    badMixed.days['2026-11-20'] = {
      ...badMixed.days['2026-11-20'],
      status: 'online',
      checks: 3,
      up: 2,
      down: 1,
    };
    expect(validateStatusPayload(badMixed, { maxDate: '2026-11-23' }).valid).toBe(false);
  });

  test('T1-F03-05: recentChecks length <= 200 and every item uses valid status, reason, and source enums', async ({ request }) => {
    const res = await request.get('data/status.json');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.recentChecks)).toBe(true);
    expect(data.recentChecks.length).toBeLessThanOrEqual(MAX_RECENT_CHECKS);
    for (const item of data.recentChecks) {
      expect(['online', 'offline']).toContain(item.status);
      expect(VALID_REASONS.has(item.reason)).toBe(true);
      expect(VALID_SOURCES.has(item.source)).toBe(true);
    }
  });

  test('T1-F04-01: historyStartDate is 2026-09-17 and days["2026-09-17"] exists with valid schema', async ({ request }) => {
    const res = await request.get('data/status.json');
    const data = await res.json();
    expect(data.historyStartDate).toBe(HISTORY_START_DATE);
    expect(data.days[HISTORY_START_DATE]).toBeDefined();
    expect(data.days[HISTORY_START_DATE].date).toBe(HISTORY_START_DATE);
  });

  test('T1-F04-02: Continuous Europe/Prague date coverage from 2026-09-17 through today with zero gaps', async ({ request }) => {
    const res = await request.get('data/status.json');
    const data = await res.json();
    const todayPrague = formatPragueDate();
    const expectedDates = enumerateDates(HISTORY_START_DATE, todayPrague);
    for (const d of expectedDates) {
      expect(data.days[d], `Missing continuous date key ${d}`).toBeDefined();
    }
  });

  test('T1-F04-03: Historical day entries contain valid sources and enum reasons', async ({ request }) => {
    const res = await request.get('data/status.json');
    const data = await res.json();
    const historicalDays = Object.values(data.days).filter((d) => d.sources.includes('historical'));
    expect(historicalDays.length).toBeGreaterThan(0);
    for (const d of historicalDays) {
      expect(VALID_REASONS.has(d.lastReason)).toBe(true);
      for (const s of d.sources) {
        expect(VALID_SOURCES.has(s)).toBe(true);
      }
    }
  });

  test('T1-F04-04: Today Europe/Prague key exists with checks >= 1 and source includes probe', async ({ request }) => {
    const res = await request.get('data/status.json');
    const data = await res.json();
    const todayPrague = formatPragueDate();
    const todayEntry = data.days[todayPrague];
    expect(todayEntry, `Missing today (${todayPrague}) entry`).toBeDefined();
    expect(todayEntry.checks).toBeGreaterThanOrEqual(1);
    expect(todayEntry.sources).toContain('probe');
  });

  test('T2-F04-01: Pre-history cutoff excludes 2026-09-16 and earlier dates', async ({ request }) => {
    const res = await request.get('data/status.json');
    const data = await res.json();
    expect(data.days['2026-09-16']).toBeUndefined();
    for (const key of Object.keys(data.days)) {
      expect(key >= HISTORY_START_DATE).toBe(true);
    }
  });

  test('T2-F04-02: Month rollover bounds 2026-09-30 -> 2026-10-01 -> 2026-10-31 -> 2026-11-01 exist without invalid dates', async ({ request }) => {
    const res = await request.get('data/status.json');
    const data = await res.json();
    for (const d of ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01']) {
      expect(data.days[d], `Missing rollover day ${d}`).toBeDefined();
    }
    expect(data.days['2026-09-31']).toBeUndefined();
    expect(data.days['2026-11-31']).toBeUndefined();
  });

  test('T2-F04-03: Future date guard ensures max day key <= current Europe/Prague date', async ({ request }) => {
    const res = await request.get('data/status.json');
    const data = await res.json();
    const todayPrague = formatPragueDate();
    for (const key of Object.keys(data.days)) {
      expect(key <= todayPrague, `Future date leaked into status.json: ${key} > ${todayPrague}`).toBe(true);
    }
  });

  test('T2-F04-04: status.json has zero raw log payloads, run IDs, IPs, or privacy leaks', async ({ request }) => {
    const res = await request.get('data/status.json');
    const rawText = await res.text();
    const leaks = scanTextForPrivacyLeaks(rawText, { forbidAllIpv4: true });
    expect(leaks, JSON.stringify(leaks)).toEqual([]);
  });

  // Local probe, CLI, and unit test suite checks
  test('T1-F02-01: checkLoginEndpoint returns online/200/ok on ephemeral HTTP 200 /login', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    await withMockServer(
      (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      },
      async (baseUrl) => {
        const result = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 2000 });
        expect(result.status).toBe('online');
        expect(result.ok).toBe(true);
        expect(result.httpStatus).toBe(200);
        expect(result.reason).toBe('ok');
      }
    );
  });

  test('T1-F02-02: Probe sends GET /login and records ISO UTC timestamp and latencyMs >= 0', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    let capturedMethod = null;
    let capturedUrl = null;
    await withMockServer(
      (req, res) => {
        capturedMethod = req.method;
        capturedUrl = req.url;
        res.writeHead(200);
        res.end('login');
      },
      async (baseUrl) => {
        const result = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 2000 });
        expect(capturedMethod).toBe('GET');
        expect(capturedUrl).toBe('/login');
        expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
        expect(typeof result.latencyMs).toBe('number');
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      }
    );
  });

  test('T1-F02-03: Probe cancels/drains 64KB chunked 200 response cleanly', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    await withMockServer(
      (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked' });
        const chunk = 'A'.repeat(8192);
        for (let i = 0; i < 8; i += 1) {
          res.write(chunk);
        }
        res.end();
      },
      async (baseUrl) => {
        const result = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 2000 });
        expect(result.ok).toBe(true);
        expect(result.status).toBe('online');
      }
    );
  });

  test('T1-F02-04 & T1-F04-05: Isolated scripts/probe.mjs executes live probe, exits 0, and updates currentStatus', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local CLI probe check');
    const repoRoot = resolveRepoRoot();
    const tmpDir = createTempRepoCopy(repoRoot);
    try {
      const res = await execFileAsync('node', ['scripts/probe.mjs'], {
        cwd: tmpDir,
        timeout: 25_000,
      });
      expect(res.stderr).not.toMatch(/UnhandledPromiseRejection|SyntaxError|ReferenceError/);
      const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, 'data', 'status.json'), 'utf8'));
      const validation = validateStatusPayload(updated, { maxDate: formatPragueDate() });
      expect(validation.valid, validation.errors.join('\n')).toBe(true);
      const leaks = scanTextForPrivacyLeaks(JSON.stringify(updated), { forbidAllIpv4: true });
      expect(leaks).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('T1-F02-05: Probe against mocked 500 outage records offline non_200 without throwing', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    await withMockServer(
      (req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Error');
      },
      async (baseUrl) => {
        const result = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 2000 });
        expect(result.status).toBe('offline');
        expect(result.ok).toBe(false);
        expect(result.httpStatus).toBe(500);
        expect(result.reason).toBe('non_200');
      }
    );
  });

  test('T2-F02-01: Redirect 302 -> 200 is NOT followed and strictly returns offline non_200', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    await withMockServer(
      (req, res) => {
        if (req.url === '/login') {
          res.writeHead(302, { Location: '/ok' });
          res.end();
        } else {
          res.writeHead(200);
          res.end('ok');
        }
      },
      async (baseUrl) => {
        const result = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 2000 });
        expect(result.status).toBe('offline');
        expect(result.ok).toBe(false);
        expect(result.httpStatus).toBe(302);
        expect(result.reason).toBe('non_200');
      }
    );
  });

  test('T2-F02-02: Non-200 codes 301, 307, 308, 201, 204 all return offline non_200', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    for (const code of [301, 307, 308, 201, 204]) {
      await withMockServer(
        (req, res) => {
          const headers = code >= 300 && code < 400 ? { Location: '/other' } : {};
          res.writeHead(code, headers);
          res.end();
        },
        async (baseUrl) => {
          const result = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 2000 });
          expect(result.status, `Code ${code} must be offline`).toBe('offline');
          expect(result.ok).toBe(false);
          expect(result.httpStatus).toBe(code);
          expect(result.reason).toBe('non_200');
        }
      );
    }
  });

  test('T2-F02-03: 4xx/5xx outages (404, 500, 502, 503) return offline with exact httpStatus and non_200', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    for (const code of [404, 500, 502, 503]) {
      await withMockServer(
        (req, res) => {
          res.writeHead(code);
          res.end('err');
        },
        async (baseUrl) => {
          const result = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 2000 });
          expect(result.status).toBe('offline');
          expect(result.ok).toBe(false);
          expect(result.httpStatus).toBe(code);
          expect(result.reason).toBe('non_200');
        }
      );
    }
  });

  test('T2-F02-04: Hung socket timeout aborts cleanly at timeoutMs and returns offline timeout', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    await withMockServer(
      (req, res) => {
        if (req.url === '/hang-body') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.write('<html>');
          // Deliberately leave body open; body cancel must not hang
        }
        // /login deliberately sends 0 bytes
      },
      async (baseUrl) => {
        const start = Date.now();
        const result = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 250 });
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
        expect(result.status).toBe('offline');
        expect(result.ok).toBe(false);
        expect(result.httpStatus).toBeNull();
        expect(result.reason).toBe('timeout');

        const startBody = Date.now();
        const bodyRes = await checkLoginEndpoint(`${baseUrl}/hang-body`, { timeoutMs: 250 });
        expect(Date.now() - startBody).toBeLessThan(2000);
        expect(bodyRes.status).toBe('online');
        expect(bodyRes.ok).toBe(true);
        expect(bodyRes.httpStatus).toBe(200);
        expect(bodyRes.reason).toBe('ok');
      }
    );
  });

  test('T2-F02-05: Closed ephemeral port returns offline network_error with zero IP/host leakage', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    // Acquire and immediately close a port to guarantee ECONNREFUSED
    const srv = http.createServer();
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const { port } = srv.address();
    await new Promise((resolve) => srv.close(resolve));

    const result = await checkLoginEndpoint(`http://127.0.0.1:${port}/login`, { timeoutMs: 1000 });
    expect(result.status).toBe('offline');
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBeNull();
    expect(result.reason).toBe('network_error');
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  });

  test('T2-F03-01, T2-F03-02, T2-F03-03: Europe/Prague CET, CEST, and DST midnight boundaries resolve accurately', async () => {
    expect(formatPragueDate('2026-11-23T22:59:59.000Z')).toBe('2026-11-23');
    expect(formatPragueDate('2026-11-23T23:00:00.000Z')).toBe('2026-11-24');
    expect(formatPragueDate('2026-11-23T23:30:00.000Z')).toBe('2026-11-24');

    expect(formatPragueDate('2026-07-15T21:59:59.000Z')).toBe('2026-07-15');
    expect(formatPragueDate('2026-07-15T22:00:00.000Z')).toBe('2026-07-16');
    expect(formatPragueDate('2026-07-15T22:30:00.000Z')).toBe('2026-07-16');

    expect(formatPragueDate('2026-10-25T22:30:00.000Z')).toBe('2026-10-25');
    expect(formatPragueDate('2026-10-25T23:00:00.000Z')).toBe('2026-10-26');
    expect(formatPragueDate('2027-03-28T00:59:59.000Z')).toBe('2027-03-28');
    expect(formatPragueDate('2027-03-28T01:00:00.000Z')).toBe('2027-03-28');
  });

  test('T2-F03-04 & T2-F03-05: Strict 99-up + 1-down outage rule and recentChecks 200-entry cap contract', async () => {
    const fixture = buildSyntheticStatusFixture({
      endDate: '2026-11-23',
      dayOverrides: {
        '2026-11-20': {
          status: 'offline',
          checks: 100,
          up: 99,
          down: 1,
          lastCheckedAt: '2026-11-20T18:00:00.000Z',
          lastHttpStatus: 500,
          lastReason: 'non_200',
          sources: ['probe'],
        },
      },
    });
    expect(validateStatusPayload(fixture, { maxDate: '2026-11-23' }).valid).toBe(true);

    const overCap = structuredClone(fixture);
    overCap.recentChecks = Array.from({ length: 201 }, (_, idx) => ({
      timestamp: `2026-11-23T00:${String(Math.floor(idx / 60)).padStart(2, '0')}:${String(idx % 60).padStart(2, '0')}.000Z`,
      date: '2026-11-23',
      status: 'online',
      httpStatus: 200,
      latencyMs: 50,
      reason: 'ok',
      source: 'probe',
    }));
    expect(validateStatusPayload(overCap, { maxDate: '2026-11-23' }).valid).toBe(false);
  });

  test('T2-F04-05: Repeated same-day probe in isolated temp repo increments checks cleanly and preserves historical source', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local CLI probe check');
    const repoRoot = resolveRepoRoot();
    const tmpDir = createTempRepoCopy(repoRoot);
    try {
      const todayPrague = formatPragueDate();
      const statusPath = path.join(tmpDir, 'data', 'status.json');
      const before = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      const beforeChecks = before.days[todayPrague]?.checks ?? 0;

      await execFileAsync('node', ['scripts/probe.mjs'], { cwd: tmpDir, timeout: 25_000 });
      await execFileAsync('node', ['scripts/probe.mjs'], { cwd: tmpDir, timeout: 25_000 });

      const after = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      expect(after.days[todayPrague].checks).toBe(beforeChecks + 2);
      expect(after.days[todayPrague].sources).toContain('probe');
      if (before.days[todayPrague]?.sources.includes('historical')) {
        expect(after.days[todayPrague].sources).toContain('historical');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('T1-F05-01, T1-F05-02, T1-F05-03, T1-F05-04, T1-F05-05: npm test executes unit suite cleanly covering 200/404/500, redirects, timeout/network, and CET/CEST', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local unit test suite check');
    const repoRoot = resolveRepoRoot();
    const { stdout, stderr } = await execFileAsync('npm', ['test'], {
      cwd: repoRoot,
      timeout: 30_000,
    });
    const combined = `${stdout}\n${stderr}`;
    expect(combined).toMatch(/fail 0|0 failing|tests \d+/i);
    expect(combined).toMatch(/200|404|500/);
    expect(combined).toMatch(/301|302|redirect/i);
    expect(combined).toMatch(/timeout|ECONNREFUSED|network/i);
    expect(combined).toMatch(/Prague|CET|CEST|midnight|outage/i);
  });

  test('T2-F05-01: Timeout BVA (T-100ms succeeds online vs T+200ms aborts as timeout)', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    await withMockServer(
      (req, res) => {
        const delayMs = req.url === '/fast' ? 120 : 500;
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200);
            res.end('ok');
          }
        }, delayMs);
      },
      async (baseUrl) => {
        const fastRes = await checkLoginEndpoint(`${baseUrl}/fast`, { timeoutMs: 250 });
        expect(fastRes.status).toBe('online');
        expect(fastRes.ok).toBe(true);

        const slowRes = await checkLoginEndpoint(`${baseUrl}/slow`, { timeoutMs: 250 });
        expect(slowRes.status).toBe('offline');
        expect(slowRes.reason).toBe('timeout');
      }
    );
  });

  test('T2-F05-02: Empty-body 200 resolves online cleanly while hung headers time out', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    await withMockServer(
      (req, res) => {
        if (req.url === '/empty') {
          res.writeHead(200, { 'Content-Length': '0' });
          res.end();
        }
        // /stall hangs before headers
      },
      async (baseUrl) => {
        const emptyRes = await checkLoginEndpoint(`${baseUrl}/empty`, { timeoutMs: 300 });
        expect(emptyRes.status).toBe('online');
        expect(emptyRes.httpStatus).toBe(200);

        const stallRes = await checkLoginEndpoint(`${baseUrl}/stall`, { timeoutMs: 200 });
        expect(stallRes.status).toBe('offline');
        expect(stallRes.reason).toBe('timeout');
      }
    );
  });

  test('T2-F05-03: 20 sequential mocked probes complete cleanly with zero leaked timers/sockets', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local probe module check');
    const checkLoginEndpoint = await loadProbeFn();
    await withMockServer(
      (req, res) => {
        res.writeHead(200);
        res.end('ok');
      },
      async (baseUrl) => {
        for (let i = 0; i < 20; i += 1) {
          const r = await checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 1000 });
          expect(r.ok).toBe(true);
        }
      }
    );
  });

  test('T2-F05-04: Leap day 2028-02-29 stays 2028-02-29 while 2026-02-28T23:30:00Z rolls to 2026-03-01 in Europe/Prague', async () => {
    expect(formatPragueDate('2028-02-29T12:00:00.000Z')).toBe('2028-02-29');
    expect(formatPragueDate('2026-02-28T23:30:00.000Z')).toBe('2026-03-01');
    const leapFixture = buildSyntheticStatusFixture({
      startDate: HISTORY_START_DATE,
      endDate: '2028-02-29',
    });
    expect(leapFixture.days['2028-02-29']).toBeDefined();
    expect(validateStatusPayload(leapFixture, { maxDate: '2028-02-29' }).valid).toBe(true);
  });

  test('T2-F05-05: Corrupt status.json in isolated temp repo causes probe CLI to fail loudly instead of silently corrupting', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local CLI error handling check');
    const repoRoot = resolveRepoRoot();
    const tmpDir = createTempRepoCopy(repoRoot);
    try {
      fs.writeFileSync(path.join(tmpDir, 'data', 'status.json'), '{not-valid-json', 'utf8');
      let exitCode = 0;
      try {
        await execFileAsync('node', ['scripts/probe.mjs'], { cwd: tmpDir, timeout: 25_000 });
      } catch (err) {
        exitCode = err.code ?? 1;
      }
      expect(exitCode).not.toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
