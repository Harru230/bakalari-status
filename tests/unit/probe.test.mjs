import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkLoginEndpoint } from '../../src/lib/probe.mjs';
import { runProbeCli } from '../../scripts/probe.mjs';
import { validateStatusDocument } from '../../src/lib/aggregate.mjs';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('checkLoginEndpoint', () => {
  let server;
  let baseUrl;
  let closedPortUrl;
  let loginHits = 0;
  let lastMethod = null;
  const openHungSockets = new Set();

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/login') {
        loginHits += 1;
        lastMethod = req.method;
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('ok');
        return;
      }
      if (req.url === '/created') {
        res.writeHead(201);
        res.end();
        return;
      }
      if (req.url === '/no-content') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === '/redirect-301') {
        res.writeHead(301, { location: '/login' });
        res.end();
        return;
      }
      if (req.url === '/redirect-302') {
        res.writeHead(302, { location: '/login' });
        res.end();
        return;
      }
      if (req.url === '/not-found') {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      if (req.url === '/server-error') {
        res.writeHead(500);
        res.end('error');
        return;
      }
      if (req.url === '/unavailable') {
        res.writeHead(503);
        res.end('unavailable');
        return;
      }
      if (req.url === '/hang') {
        openHungSockets.add(req.socket);
        req.socket.once('close', () => openHungSockets.delete(req.socket));
        return;
      }
      if (req.url === '/reset') {
        req.socket.destroy();
        return;
      }
      res.writeHead(400);
      res.end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const tempServer = http.createServer();
    await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const closedPort = tempServer.address().port;
    await new Promise((resolve) => tempServer.close(resolve));
    closedPortUrl = `http://127.0.0.1:${closedPort}/login`;
  });

  after(async () => {
    for (const socket of openHungSockets) {
      socket.destroy();
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  it('records HTTP 200 on /login via GET as online', async () => {
    loginHits = 0;
    lastMethod = null;
    const fixedNow = new Date('2026-11-23T14:00:00.000Z');
    const result = await checkLoginEndpoint(`${baseUrl}/login`, {
      now: () => fixedNow,
    });

    assert.equal(lastMethod, 'GET');
    assert.equal(loginHits, 1);
    assert.deepEqual(Object.keys(result).sort(), [
      'httpStatus',
      'latencyMs',
      'ok',
      'reason',
      'status',
      'timestamp',
    ]);
    assert.equal(result.timestamp, '2026-11-23T14:00:00.000Z');
    assert.equal(result.status, 'online');
    assert.equal(result.ok, true);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.reason, 'ok');
    assert.equal(Number.isInteger(result.latencyMs), true);
    assert.equal(result.latencyMs >= 0, true);
  });

  it('treats non-200 2xx statuses (201, 204) strictly as offline', async () => {
    for (const [pathname, expectedCode] of [
      ['/created', 201],
      ['/no-content', 204],
    ]) {
      const result = await checkLoginEndpoint(`${baseUrl}${pathname}`);
      assert.equal(result.ok, false);
      assert.equal(result.status, 'offline');
      assert.equal(result.httpStatus, expectedCode);
      assert.equal(result.reason, 'non_200');
    }
  });

  it('does not follow 301/302 redirects to /login and records them as offline', async () => {
    loginHits = 0;
    for (const [pathname, expectedCode] of [
      ['/redirect-301', 301],
      ['/redirect-302', 302],
    ]) {
      const result = await checkLoginEndpoint(`${baseUrl}${pathname}`);
      assert.equal(result.ok, false);
      assert.equal(result.status, 'offline');
      assert.equal(result.httpStatus, expectedCode);
      assert.equal(result.reason, 'non_200');
    }
    assert.equal(loginHits, 0);
  });

  it('treats 404, 500, and 503 as offline with reason non_200', async () => {
    for (const [pathname, expectedCode] of [
      ['/not-found', 404],
      ['/server-error', 500],
      ['/unavailable', 503],
    ]) {
      const result = await checkLoginEndpoint(`${baseUrl}${pathname}`);
      assert.equal(result.ok, false);
      assert.equal(result.status, 'offline');
      assert.equal(result.httpStatus, expectedCode);
      assert.equal(result.reason, 'non_200');
    }
  });

  it('classifies hung sockets as timeout after timeoutMs', async () => {
    const result = await checkLoginEndpoint(`${baseUrl}/hang`, { timeoutMs: 80 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'offline');
    assert.equal(result.httpStatus, null);
    assert.equal(result.reason, 'timeout');
    assert.equal(result.latencyMs >= 60, true);
  });

  it('classifies closed ports (ECONNREFUSED) as network_error without leaking error strings', async () => {
    const result = await checkLoginEndpoint(closedPortUrl, { timeoutMs: 2000 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'offline');
    assert.equal(result.httpStatus, null);
    assert.equal(result.reason, 'network_error');

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /127\.0\.0\.1|ECONNREFUSED|TimeoutError|location/i);
  });

  it('classifies destroyed sockets (UND_ERR_SOCKET) as network_error', async () => {
    const result = await checkLoginEndpoint(`${baseUrl}/reset`, { timeoutMs: 2000 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'offline');
    assert.equal(result.httpStatus, null);
    assert.equal(result.reason, 'network_error');
  });

  it('classifies nested cause AggregateError timeout codes as timeout', async () => {
    const inner = Object.assign(new Error('connect timeout'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    const agg = new AggregateError([inner], 'all failed');
    const top = new TypeError('fetch failed', { cause: agg });
    const result = await checkLoginEndpoint('https://bakalari.oegp.cz/login', {
      fetchImpl: async () => {
        throw top;
      },
    });
    assert.equal(result.status, 'offline');
    assert.equal(result.reason, 'timeout');
    assert.equal(result.httpStatus, null);
  });

  it('validates invalid options with RangeError/TypeError', async () => {
    await assert.rejects(
      () => checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: 0 }),
      RangeError,
    );
    await assert.rejects(
      () => checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: -5 }),
      RangeError,
    );
    await assert.rejects(
      () => checkLoginEndpoint(`${baseUrl}/login`, { timeoutMs: Number.NaN }),
      RangeError,
    );
    await assert.rejects(
      () => checkLoginEndpoint('', { timeoutMs: 100 }),
      TypeError,
    );
  });
});

describe('scripts/probe.mjs CLI', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/down') {
        res.writeHead(500);
        res.end('down');
        return;
      }
      if (req.url === '/hang') {
        return;
      }
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  it('exits 0 on offline 500 target and persists valid status.json without leaking target URL', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bakalari-probe-test-'));
    const statusFile = path.join(tmpDir, 'status.json');
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [path.join(REPO_ROOT, 'scripts', 'probe.mjs')],
        {
          env: {
            ...process.env,
            STATUS_FILE: statusFile,
            BAKALARI_STATUS_URL: `${baseUrl}/down`,
            PROBE_TIMEOUT_MS: '2000',
          },
        },
      );

      assert.match(stdout, /^\[probe\] .* status=offline http=500 latencyMs=\d+ reason=non_200/m);
      const raw = await fs.readFile(statusFile, 'utf8');
      assert.doesNotMatch(raw, /127\.0\.0\.1/);
      const doc = JSON.parse(raw);
      validateStatusDocument(doc);
      assert.equal(doc.currentStatus.status, 'offline');
      assert.equal(doc.currentStatus.httpStatus, 500);
      assert.equal(doc.currentStatus.reason, 'non_200');
      assert.equal(doc.recentChecks.length, 1);
      assert.equal(doc.recentChecks[0].source, 'probe');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('exits 0 on hung timeout via runProbeCli', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bakalari-probe-hang-'));
    const statusFile = path.join(tmpDir, 'status.json');
    const logs = [];
    try {
      const { result, document } = await runProbeCli({
        statusFile,
        targetUrl: `${baseUrl}/hang`,
        timeoutMs: 80,
        now: () => new Date('2026-11-23T14:15:00.000Z'),
        logger: { log: (line) => logs.push(line) },
      });

      assert.equal(result.status, 'offline');
      assert.equal(result.reason, 'timeout');
      assert.equal(document.currentStatus.status, 'offline');
      assert.equal(document.currentStatus.reason, 'timeout');
      assert.equal(logs.length, 1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('exits non-zero without overwriting corrupt existing status.json', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bakalari-probe-corrupt-'));
    const statusFile = path.join(tmpDir, 'status.json');
    const corruptContent = '{corrupt-json';
    await fs.writeFile(statusFile, corruptContent, 'utf8');

    try {
      await assert.rejects(
        () =>
          execFileAsync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'probe.mjs')], {
            env: {
              ...process.env,
              STATUS_FILE: statusFile,
              BAKALARI_STATUS_URL: `${baseUrl}/login`,
            },
          }),
        (err) => err.code === 1,
      );

      const afterRead = await fs.readFile(statusFile, 'utf8');
      assert.equal(afterRead, corruptContent);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
