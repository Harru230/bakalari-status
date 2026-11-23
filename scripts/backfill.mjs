import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TARGET,
  createEmptyStatusDocument,
  mergeChecksIntoDocument,
  sanitizeCheck,
  validateStatusDocument,
} from '../src/lib/aggregate.mjs';
import { SCHOOL_TIMEZONE } from '../src/lib/timezone.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STATUS_FILE = path.join(REPO_ROOT, 'data', 'status.json');

export function parseBackfillArgs(argv) {
  const args = {
    inputPath: null,
    useStdin: false,
    outPath: DEFAULT_STATUS_FILE,
    target: DEFAULT_TARGET,
    timezone: SCHOOL_TIMEZONE,
    replaceHistorical: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--input requires a file path or "-"');
      }
      if (value === '-') {
        args.useStdin = true;
      } else {
        args.inputPath = value;
      }
      i += 1;
    } else if (token === '--stdin') {
      args.useStdin = true;
    } else if (token === '--out') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--out requires a file path');
      }
      args.outPath = value;
      i += 1;
    } else if (token === '--target') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--target requires a URL');
      }
      args.target = value;
      i += 1;
    } else if (token === '--timezone') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--timezone requires an IANA timezone');
      }
      args.timezone = value;
      i += 1;
    } else if (token === '--replace-historical') {
      args.replaceHistorical = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.useStdin && !args.inputPath) {
    throw new Error('Either --input <path> or --stdin is required');
  }

  return args;
}

async function readStdinText(stdin = process.stdin) {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadExistingStatus(outPath, { target, timezone, now }) {
  let raw;
  try {
    raw = await fs.readFile(outPath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return createEmptyStatusDocument({ target, timezone, now });
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

export async function runBackfill({
  inputPath = null,
  useStdin = false,
  stdin = process.stdin,
  outPath = DEFAULT_STATUS_FILE,
  target = DEFAULT_TARGET,
  timezone = SCHOOL_TIMEZONE,
  replaceHistorical = false,
  now = () => new Date(),
  logger = console,
} = {}) {
  const rawText = useStdin
    ? await readStdinText(stdin)
    : await fs.readFile(inputPath, 'utf8');

  let rawChecks;
  try {
    rawChecks = JSON.parse(rawText);
  } catch {
    throw new Error('Backfill input must be valid JSON');
  }

  if (!Array.isArray(rawChecks)) {
    throw new Error('Backfill input must be a JSON array');
  }

  const sanitizedChecks = rawChecks.map((item) => sanitizeCheck(item));
  const existingDoc = await loadExistingStatus(outPath, { target, timezone, now });

  let nextDoc;
  if (replaceHistorical) {
    const retainedProbes = existingDoc.recentChecks.filter((entry) => entry.source === 'probe');
    nextDoc = createEmptyStatusDocument({ target, timezone, now });
    nextDoc = mergeChecksIntoDocument(nextDoc, sanitizedChecks, { now });
    if (retainedProbes.length > 0) {
      nextDoc = mergeChecksIntoDocument(nextDoc, retainedProbes, { now });
    }
  } else {
    nextDoc = mergeChecksIntoDocument(existingDoc, sanitizedChecks, { now });
  }

  validateStatusDocument(nextDoc);
  await writeJsonAtomically(outPath, nextDoc);

  logger.log(
    `[backfill] imported=${sanitizedChecks.length} days=${Object.keys(nextDoc.days).length} start=${nextDoc.historyStartDate}`,
  );

  return nextDoc;
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const parsedArgs = parseBackfillArgs(process.argv.slice(2));
    await runBackfill(parsedArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill execution failed';
    console.error(`[backfill] error: ${message}`);
    process.exitCode = 1;
  }
}
