import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encryptJson } from '../src/lib/vault.mjs';
import { stripClassTeachers } from '../src/lib/teachers.mjs';
import { DEFAULT_CLASS_ORDER } from './import-classes.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const IMPORTS_DIR = path.join(ROOT_DIR, 'imports');
const MASTER_PATH = path.join(IMPORTS_DIR, 'master-school-timetables.json');
const TEACHERS_DIR_PATH = path.join(IMPORTS_DIR, 'teachers-directory.json');
const PUBLIC_CLASSES_PATH = path.join(ROOT_DIR, 'data', 'classes.json');
const TEACHERS_VAULT_PATH = path.join(ROOT_DIR, 'data', 'teachers.enc.json');

function loadLocalEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const eq = s.indexOf('=');
    out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function writeAtomicJson(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fsp.rename(tmpPath, filePath);
}

async function promptPassphrase() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await rl.question('New vault passphrase: ');
    return ans.trim();
  } finally {
    rl.close();
  }
}

function updateLocalEnvVaultKey(newPass) {
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf8').split('\n').filter((l) => !l.startsWith('TIMETABLE_VAULT_KEY='))
    : [];
  const filtered = lines.filter((l, i) => !(i === lines.length - 1 && l === ''));
  filtered.push(`TIMETABLE_VAULT_KEY=${newPass}`);
  fs.writeFileSync(ENV_PATH, `${filtered.join('\n')}\n`, 'utf8');
}

async function main() {
  const rotate = process.argv.includes('--rotate');
  const localEnv = loadLocalEnv();
  let passphrase = (process.env.TIMETABLE_VAULT_KEY || localEnv.TIMETABLE_VAULT_KEY || '').trim();

  if (rotate) {
    const entered = await promptPassphrase();
    if (!entered) {
      console.error('Passphrase cannot be empty.');
      process.exitCode = 1;
      return;
    }
    passphrase = entered;
    updateLocalEnvVaultKey(passphrase);
  }

  if (!passphrase) {
    console.error('Missing TIMETABLE_VAULT_KEY env var or .env entry.');
    process.exitCode = 1;
    return;
  }

  const masterDoc = JSON.parse(await fsp.readFile(MASTER_PATH, 'utf8'));
  const teachersDir = JSON.parse(await fsp.readFile(TEACHERS_DIR_PATH, 'utf8'));
  const updatedAt = new Date().toISOString();

  const order = Array.isArray(masterDoc.order) && masterDoc.order.length > 0
    ? masterDoc.order
    : DEFAULT_CLASS_ORDER;

  const publicClassesDoc = {
    schemaVersion: 1,
    updatedAt,
    order,
    classes: stripClassTeachers(masterDoc.classes || {}),
  };

  const privateTeachersDoc = {
    schemaVersion: 1,
    updatedAt,
    order,
    teachers: teachersDir,
    classLessonsWithTeachers: masterDoc.classes || {},
  };

  const encryptedEnvelope = await encryptJson(privateTeachersDoc, passphrase);

  await writeAtomicJson(PUBLIC_CLASSES_PATH, publicClassesDoc);
  await writeAtomicJson(TEACHERS_VAULT_PATH, encryptedEnvelope);

  console.log(
    `[vault] built public classes.json (${Object.keys(publicClassesDoc.classes).length} classes, 0 teacher fields) and encrypted teachers.enc.json`,
  );

  if (rotate) {
    try {
      execFileSync('gh', ['secret', 'set', 'TIMETABLE_VAULT_KEY', '-R', 'Harru230/bakalari-status'], {
        input: passphrase,
        stdio: ['pipe', 'inherit', 'inherit'],
      });
      console.log('[vault] updated GitHub secret TIMETABLE_VAULT_KEY.');
    } catch {
      console.log('[vault] note: update GitHub secret TIMETABLE_VAULT_KEY manually if needed.');
    }
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(`[vault] failed: ${err?.message || 'unexpected error'}`);
    process.exitCode = 1;
  });
}
