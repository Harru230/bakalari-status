import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMPORTS_DIR = path.join(ROOT_DIR, 'imports');
const PUBLIC_TT_DIR = path.join(ROOT_DIR, 'public', 'timetables');
const CLASSES_JSON_PATH = path.join(ROOT_DIR, 'data', 'classes.json');

const GRADE_SECTIONS = [
  [6, ['A', 'B']],
  [5, ['A', 'B', 'C']],
  [4, ['A', 'B']],
  [3, ['A', 'B', 'C']],
  [2, ['A', 'B', 'C']],
  [1, ['A', 'B', 'C']],
];

export const DEFAULT_CLASS_ORDER = GRADE_SECTIONS.flatMap(([grade, secs]) =>
  secs.map((sec) => `${grade}.${sec}`),
);

const ALLOWED_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.json']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function detectClassIdFromFilename(filename) {
  const stem = path.basename(filename, path.extname(filename));
  const match = stem.match(/(?:^|[^0-9])([1-6])[\s._-]*([A-Ca-c])(?![A-Za-z0-9])/);
  if (!match) return null;
  const grade = Number(match[1]);
  const section = match[2].toUpperCase();
  const canonical = `${grade}.${section}`;
  return DEFAULT_CLASS_ORDER.includes(canonical) ? canonical : null;
}

function classSlug(classId) {
  return classId.replace('.', '');
}

function sanitizeImageCopy(srcPath, destPath, ext) {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sips')) {
    const format = ext === '.png' ? 'png' : 'jpeg';
    execFileSync('/usr/bin/sips', ['-s', 'format', format, srcPath, '--out', destPath], {
      stdio: 'ignore',
    });
    return;
  }
  fs.copyFileSync(srcPath, destPath);
}

async function loadExistingClassesDoc() {
  try {
    const raw = await fsp.readFile(CLASSES_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.classes) {
      return parsed;
    }
  } catch {
    // start fresh
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    order: DEFAULT_CLASS_ORDER,
    classes: {},
  };
}

async function main() {
  const shouldPublish = process.argv.includes('--publish');
  await fsp.mkdir(IMPORTS_DIR, { recursive: true });
  await fsp.mkdir(PUBLIC_TT_DIR, { recursive: true });

  const doc = await loadExistingClassesDoc();
  doc.order = DEFAULT_CLASS_ORDER;

  const entries = await fsp.readdir(IMPORTS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && ALLOWED_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  let importedCount = 0;
  const skipped = [];

  for (const name of files) {
    const classId = detectClassIdFromFilename(name);
    if (!classId) {
      skipped.push(name);
      continue;
    }

    const ext = path.extname(name).toLowerCase();
    const srcPath = path.join(IMPORTS_DIR, name);
    const slug = classSlug(classId);
    const existing = doc.classes[classId] || {};

    if (ext === '.json') {
      const parsed = JSON.parse(await fsp.readFile(srcPath, 'utf8'));
      doc.classes[classId] = {
        ...existing,
        className: classId,
        updatedAt: new Date().toISOString(),
        permanent: parsed.permanent || parsed,
      };
      importedCount += 1;
      console.log(`[import] ${classId} <- structured JSON (${name})`);
      continue;
    }

    const outExt = IMAGE_EXTS.has(ext) ? (ext === '.png' ? '.png' : '.jpg') : '.pdf';
    const outName = `${slug}${outExt}`;
    const destPath = path.join(PUBLIC_TT_DIR, outName);

    // Remove older media extensions for the same class so dist stays clean
    for (const oldExt of ['.pdf', '.png', '.jpg']) {
      const candidate = path.join(PUBLIC_TT_DIR, `${slug}${oldExt}`);
      if (candidate !== destPath && fs.existsSync(candidate)) {
        await fsp.unlink(candidate);
      }
    }

    if (outExt === '.pdf') {
      await fsp.copyFile(srcPath, destPath);
    } else {
      sanitizeImageCopy(srcPath, destPath, outExt);
    }

    doc.classes[classId] = {
      ...existing,
      className: classId,
      updatedAt: new Date().toISOString(),
      file: `timetables/${outName}`,
      fileType: outExt === '.pdf' ? 'pdf' : 'image',
    };
    importedCount += 1;
    console.log(`[import] ${classId} -> public/timetables/${outName}`);
  }

  doc.updatedAt = new Date().toISOString();
  const tmpPath = `${CLASSES_JSON_PATH}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  await fsp.rename(tmpPath, CLASSES_JSON_PATH);

  if (skipped.length > 0) {
    console.log(
      `[import] skipped ${skipped.length} file(s) without class code (name files like 6A.pdf, 5B.jpg, 1C.png): ${skipped.join(', ')}`,
    );
  }
  console.log(
    `[import] done: processed ${importedCount} file(s) from imports/, total static classes configured: ${Object.keys(doc.classes).length}`,
  );

  if (shouldPublish) {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT_DIR, stdio: 'inherit' });
    execFileSync('npm', ['run', 'test:privacy', '--', '--require-dist'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    const status = execFileSync('git', ['status', '--porcelain', 'data/classes.json', 'public/timetables'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    }).trim();
    if (!status) {
      console.log('[publish] no new class timetable changes to commit.');
      return;
    }
    execFileSync('git', ['add', 'data/classes.json', 'public/timetables'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    execFileSync('git', ['commit', '-m', 'chore(timetable): update static class timetables'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    execFileSync('npm', ['run', 'test:privacy', '--', '--require-dist'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    execFileSync('git', ['pull', '--rebase', 'origin', 'main'], { cwd: ROOT_DIR, stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', 'main'], { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('[publish] pushed to GitHub Pages.');
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  void main();
}
