import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEmptyStatusDocument,
  mergeCheckIntoDocument,
  validateStatusDocument,
} from '../src/lib/aggregate.mjs';
import {
  DEFAULT_TARGET_URL,
  DEFAULT_TIMEOUT_MS,
  checkLoginEndpoint,
} from '../src/lib/probe.mjs';
import { SCHOOL_TIMEZONE } from '../src/lib/timezone.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STATUS_FILE = path.join(REPO_ROOT, 'data', 'status.json');

async function loadStatusDocument(statusFile, now) {
  let raw;
  try {
    raw = await fs.readFile(statusFile, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return createEmptyStatusDocument({
        target: DEFAULT_TARGET_URL,
        timezone: SCHOOL_TIMEZONE,
        now,
      });
    }
    throw new Error('Unable to read existing status file');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Existing status file contains invalid JSON');
  }

  validateStatusDocument(parsed);
  return parsed;
}

async function writeJsonAtomically(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  try {
    await fs.writeFile(tmpFile, payload, 'utf8');
    await fs.rename(tmpFile, filePath);
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {});
    throw err;
  }
}

export async function runProbeCli(options = {}) {
  const statusFile = options.statusFile ?? (process.env.STATUS_FILE || DEFAULT_STATUS_FILE);
  const targetUrl = options.targetUrl ?? (process.env.BAKALARI_STATUS_URL || DEFAULT_TARGET_URL);
  const rawTimeout =
    options.timeoutMs ??
    (process.env.PROBE_TIMEOUT_MS !== undefined && process.env.PROBE_TIMEOUT_MS !== ''
      ? Number(process.env.PROBE_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;

  const existingDoc = await loadStatusDocument(statusFile, now);
  const result = await checkLoginEndpoint(targetUrl, {
    timeoutMs: rawTimeout,
    fetchImpl,
    now,
  });

  const nextDoc = mergeCheckIntoDocument(
    existingDoc,
    {
      timestamp: result.timestamp,
      status: result.status,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      reason: result.reason,
      source: 'probe',
    },
    { now },
  );

  validateStatusDocument(nextDoc);
  await writeJsonAtomically(statusFile, nextDoc);

  logger.log(
    `[probe] ${result.timestamp} status=${result.status} http=${result.httpStatus} latencyMs=${result.latencyMs} reason=${result.reason}`,
  );

  return { result, document: nextDoc };
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runProbeCli().catch((err) => {
    const message = err instanceof Error ? err.message : 'Probe execution failed';
    console.error(`[probe] error: ${message}`);
    process.exitCode = 1;
  });
}
