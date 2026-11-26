import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ALLOWED_GIT_NAMES = new Set(['Harru230', 'github-actions[bot]']);
export const ALLOWED_GIT_EMAILS = new Set([
  '212044046+Harru230@users.noreply.github.com',
  '41898282+github-actions[bot]@users.noreply.github.com',
]);

const ALLOWLISTED_OEGP_DOMAIN = ['bakalari', 'oegp', 'cz'].join('.');
const ALLOWLISTED_REPO_SLUG = ['harru230', 'bakalari-status'].join('/');

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.wasm',
]);

const FORBIDDEN_FILENAME_RE =
  /(?:^|\/)\.env(?:\.|$)|\.pem$|\.key$|(?:credentials|service-account).*\.json$/i;

const SECRET_ENV_NAMES = [
  ['BAK', 'USER'].join('_'),
  ['BAK', 'PASS'].join('_'),
  ['BAKALARI', 'USER'].join('_'),
  ['BAKALARI', 'PASS'].join('_'),
  ['BAKALARI', 'PASSWORD'].join('_'),
  ['TELEGRAM', 'BOT', 'TOKEN'].join('_'),
  ['TELEGRAM', 'CHAT', 'ID'].join('_'),
  ['FIREBASE', 'TOKEN'].join('_'),
  ['FIREBASE', 'SERVICE', 'ACCOUNT'].join('_'),
  ['GOOGLE', 'APPLICATION', 'CREDENTIALS'].join('_'),
  ['EDUV', 'TOKEN'].join('_'),
  ['EDU', 'VIDUAL', 'TOKEN'].join('_'),
  ['MOODLE', 'TOKEN'].join('_'),
  ['MOODLE', 'WSTOKEN'].join('_'),
];

const SCHOOL_HUB_TERMS = [
  ['sch', 'ool[-_ ]?h', 'ub'].join(''),
  ['sch', 'ool-h', 'ub-cef8c'].join(''),
  ['sch', 'ool_a', 'gy'].join(''),
  ['fire', 'store'].join(''),
  ['edu', 'vidual'].join(''),
  ['quiz', 'let'].join(''),
  ['stunden', 'register'].join(''),
  ['fire', 'base(?:io|app|[-_ ]?(?:admin|project|token))'].join(''),
];

const PERSONAL_NAME_PATTERNS = [
  ['ad', 'am', 'pi', 'pal'].join(''),
  `\\b${['ad', 'am'].join('')}\\b`,
  ['p[i\\u00ed]', 'pal'].join(''),
];

const STATIC_RULES = [
  {
    rule: 'github_token',
    regex: new RegExp(
      `\\b(?:${['gh', '[pousr]_'].join('')}[A-Za-z0-9_]{20,}|${['github', 'pat_'].join('_')}[A-Za-z0-9_]{20,})\\b`,
      'g',
    ),
  },
  {
    rule: 'google_api_key',
    regex: new RegExp(`\\b${['AI', 'za'].join('')}[0-9A-Za-z_-]{30,}\\b`, 'g'),
  },
  {
    rule: 'private_key',
    regex: new RegExp(
      ['-----BE', 'GIN [A-Z0-9 ]*PRI', 'VATE KEY-----'].join(''),
      'g',
    ),
  },
  {
    rule: 'bearer_token',
    regex: new RegExp(
      `\\b${['Bea', 'rer'].join('')}\\s+[A-Za-z0-9._~+/=-]{16,}\\b`,
      'gi',
    ),
  },
  {
    rule: 'bot_token_shape',
    regex: new RegExp(
      `\\b\\d{8,11}:${['A', 'A'].join('')}[0-9A-Za-z_-]{30,45}\\b`,
      'g',
    ),
  },
  {
    rule: 'secret_env_name',
    regex: new RegExp(`\\b(?:${SECRET_ENV_NAMES.join('|')})\\b`, 'g'),
  },
  {
    rule: 'generic_env_secret_assignment',
    regex: new RegExp(
      `\\b(?:export\\s+)?(?:[A-Z][A-Z0-9_]*_)?(?:${[
        ['PASS', 'WORD'].join(''),
        ['PASS', 'WD'].join(''),
        ['SEC', 'RET'].join(''),
        ['API', 'KEY'].join('_'),
        ['ACCESS', 'TOKEN'].join('_'),
        ['REFRESH', 'TOKEN'].join('_'),
        ['PRIVATE', 'KEY'].join('_'),
        ['AUTH', 'TOKEN'].join('_'),
      ].join('|')})\\s*=\\s*(?:['"][^'"\\r\\n]{8,}['"]|[A-Za-z0-9._~+/=-]{12,})`,
      'g',
    ),
  },
  {
    rule: 'rfc1918_ip',
    regex: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
  },
  {
    rule: 'school_ip',
    regex: /\b193\.41\.\d{1,3}\.\d{1,3}\b/g,
  },
  {
    rule: 'school_hub_internal',
    regex: new RegExp(`\\b(?:${SCHOOL_HUB_TERMS.join('|')})\\b`, 'gi'),
  },
  {
    rule: 'personal_name',
    regex: new RegExp(`(?:${PERSONAL_NAME_PATTERNS.join('|')})`, 'gi'),
  },
  {
    rule: 'local_user_path',
    regex: /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\[A-Za-z0-9._-]+)/gi,
  },
  {
    rule: 'forbidden_git_remote_name',
    regex: new RegExp(`\\b${['oe', 'gp'].join('')}\\.git\\b`, 'i'),
  },
];

const IPV4_LITERAL_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const OEGP_DOMAIN_RE = new RegExp(
  `\\b(?:[a-z0-9-]+\\.)*${['oe', 'gp'].join('')}\\.cz\\b`,
  'gi',
);
const HARRU_REPO_RE = new RegExp(
  `\\b${['Har', 'ru230'].join('')}\\/([A-Za-z0-9._-]+)\\b`,
  'gi',
);

const INTEGRITY_MASK_RE = /"integrity"\s*:\s*"sha\d+-[A-Za-z0-9+/=_-]+"/g;
const BASE64_DATA_URI_MASK_RE = /data:[^;\s"']+;base64,[A-Za-z0-9+/=]+/gi;
const HEX_COLOR_MASK_RE = /#[0-9a-fA-F]{3,8}\b/g;
const GIT_SHA_MASK_RE = /\b[0-9a-f]{40}\b/gi;
const CLASS_SECTION_RE = new RegExp(
  `(?<![#0-9a-zA-Z+/\\\\.])4(?:\\.\\s*)?${['[a', 'A]'].join('')}(?![0-9a-zA-Z+/=])`,
);

const EMOJI_PRESENTATION_RE = /\p{Emoji_Presentation}/u;
const STRICT_PICTOGRAPH_RE =
  /[\p{Emoji_Presentation}\p{Extended_Pictographic}\u2713\u2714\u2717\u2718\u2715\u2716]/u;

const EMBEDDED_CRED_RE = new RegExp(
  `(?:${['gh', '[pousr]_'].join('')}|${['x-access', 'token'].join('-')}|\\/\\/[^/@\\s]+:[^/@\\s]+@)`,
  'i',
);

function testFresh(regex, line) {
  regex.lastIndex = 0;
  return regex.test(line);
}

function matchAllFresh(regex, line) {
  regex.lastIndex = 0;
  return line.match(regex) || [];
}

function isBinaryBuffer(buf) {
  const sample = buf.subarray(0, 8192);
  return sample.includes(0);
}

function isBinaryFilename(filePath) {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isStrictPictographPath(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  return (
    norm === 'index.html' ||
    norm.startsWith('src/') ||
    norm.startsWith('data/') ||
    norm.startsWith('scripts/') ||
    norm.startsWith('dist/')
  );
}

export function scanText(text, options = {}) {
  const {
    forbidAllIpv4 = false,
    strictPictograph = false,
    allowClassSection = false,
    lineOffset = 0,
  } = options;

  const findings = [];
  if (typeof text !== 'string' || text.length === 0) {
    return findings;
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const lineNumber = lineOffset + i + 1;

    for (const { rule, regex } of STATIC_RULES) {
      if (testFresh(regex, line)) {
        findings.push({ rule, line: lineNumber });
      }
    }

    if (forbidAllIpv4 && IPV4_LITERAL_RE.test(line)) {
      findings.push({ rule: 'ipv4_literal', line: lineNumber });
    }

    const emails = matchAllFresh(EMAIL_RE, line);
    if (emails.some((email) => !ALLOWED_GIT_EMAILS.has(email))) {
      findings.push({ rule: 'non_allowlisted_email', line: lineNumber });
    }

    const oegpDomains = matchAllFresh(OEGP_DOMAIN_RE, line);
    if (oegpDomains.some((domain) => domain.toLowerCase() !== ALLOWLISTED_OEGP_DOMAIN)) {
      findings.push({ rule: 'non_allowlisted_oegp_domain', line: lineNumber });
    }

    const repos = matchAllFresh(HARRU_REPO_RE, line);
    if (
      repos.some(
        (repo) => repo.replace(/\.git$/i, '').toLowerCase() !== ALLOWLISTED_REPO_SLUG,
      )
    ) {
      findings.push({ rule: 'non_allowlisted_repo', line: lineNumber });
    }

    if (!allowClassSection) {
      const maskedForSection = line
        .replace(INTEGRITY_MASK_RE, '""')
        .replace(BASE64_DATA_URI_MASK_RE, '')
        .replace(HEX_COLOR_MASK_RE, '')
        .replace(GIT_SHA_MASK_RE, '');
      if (CLASS_SECTION_RE.test(maskedForSection)) {
        findings.push({ rule: 'class_section', line: lineNumber });
      }
    }

    if (EMOJI_PRESENTATION_RE.test(line)) {
      findings.push({ rule: 'ai_slop_emoji', line: lineNumber });
    } else if (strictPictograph && STRICT_PICTOGRAPH_RE.test(line)) {
      findings.push({ rule: 'pictograph_or_unicode_symbol', line: lineNumber });
    }
  }

  return findings;
}

export async function scanDirectory(dirPath, options = {}) {
  const {
    scope = 'dist',
    strictPictograph = true,
    forbidAllIpv4OnStatusJson = true,
  } = options;

  const violations = [];
  let fileCount = 0;

  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      fileCount += 1;
      if (FORBIDDEN_FILENAME_RE.test(relPath)) {
        violations.push({
          scope,
          location: relPath,
          line: 0,
          rule: 'forbidden_secret_file',
        });
      }

      for (const hit of scanText(relPath, { strictPictograph })) {
        violations.push({
          scope,
          location: relPath,
          line: 0,
          rule: `path:${hit.rule}`,
        });
      }

      if (isBinaryFilename(relPath)) continue;
      const buf = await fsp.readFile(fullPath);
      if (isBinaryBuffer(buf)) continue;

      const text = buf.toString('utf8');
      const baseName = path.basename(relPath);
      const isStatusJson = baseName === 'status.json';
      const isTimetableDataJson = baseName === 'timetable.json' || baseName === 'classes.json';
      const hits = scanText(text, {
        forbidAllIpv4: forbidAllIpv4OnStatusJson && (isStatusJson || isTimetableDataJson),
        strictPictograph,
        allowClassSection: isTimetableDataJson,
      });
      for (const hit of hits) {
        violations.push({
          scope,
          location: relPath,
          line: hit.line,
          rule: hit.rule,
        });
      }
    }
  }

  await walk(dirPath);
  return { violations, fileCount };
}

async function execGit(args, cwd, maxBuffer = 10 * 1024 * 1024) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer,
    encoding: 'buffer',
  });
  return stdout;
}

async function scanTrackedFiles(rootDir) {
  const violations = [];
  const raw = await execGit(['ls-files', '-z'], rootDir, 20 * 1024 * 1024);
  const files = raw
    .toString('utf8')
    .split('\0')
    .filter(Boolean);

  for (const relPath of files) {
    const normPath = relPath.replace(/\\/g, '/');
    if (FORBIDDEN_FILENAME_RE.test(normPath)) {
      violations.push({
        scope: 'tracked',
        location: normPath,
        line: 0,
        rule: 'forbidden_secret_file',
      });
    }

    for (const hit of scanText(normPath, { strictPictograph: false })) {
      violations.push({
        scope: 'tracked',
        location: normPath,
        line: 0,
        rule: `path:${hit.rule}`,
      });
    }

    const absPath = path.join(rootDir, relPath);
    let stat;
    try {
      stat = await fsp.lstat(absPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (isBinaryFilename(normPath)) continue;

    const buf = await fsp.readFile(absPath);
    if (isBinaryBuffer(buf)) continue;

    const text = buf.toString('utf8');
    const baseName = path.basename(normPath);
    const isTimetableDataJson = baseName === 'timetable.json' || baseName === 'classes.json';
    const hits = scanText(text, {
      forbidAllIpv4: baseName === 'status.json' || isTimetableDataJson,
      strictPictograph: isStrictPictographPath(normPath),
      allowClassSection: isTimetableDataJson,
    });
    for (const hit of hits) {
      violations.push({
        scope: 'tracked',
        location: normPath,
        line: hit.line,
        rule: hit.rule,
      });
    }
  }

  return { violations, trackedFiles: files.length };
}

async function hasCommits(rootDir) {
  const buf = await execGit(['rev-list', '-n', '1', '--all'], rootDir);
  return buf.toString('utf8').trim().length > 0;
}

async function scanGitMetadataAndRefs(rootDir) {
  const violations = [];
  let commits = 0;

  const remoteOut = (await execGit(['remote', '-v'], rootDir)).toString('utf8');
  if (remoteOut.trim().length > 0) {
    const remoteLines = remoteOut.split(/\r?\n/);
    for (let i = 0; i < remoteLines.length; i += 1) {
      const line = remoteLines[i];
      if (!line) continue;
      if (EMBEDDED_CRED_RE.test(line)) {
        violations.push({
          scope: 'git-remote',
          location: 'git remote -v',
          line: i + 1,
          rule: 'embedded_remote_credentials',
        });
      }
      for (const hit of scanText(line)) {
        violations.push({
          scope: 'git-remote',
          location: 'git remote -v',
          line: i + 1,
          rule: hit.rule,
        });
      }
    }
  }

  const refsOut = (await execGit(['for-each-ref'], rootDir)).toString('utf8');
  if (refsOut.trim().length > 0) {
    for (const hit of scanText(refsOut)) {
      violations.push({
        scope: 'git-refs',
        location: 'git for-each-ref',
        line: hit.line,
        rule: hit.rule,
      });
    }
  }

  if (!(await hasCommits(rootDir))) {
    return { violations, commits: 0 };
  }

  const logOut = (
    await execGit(
      ['log', '--all', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e'],
      rootDir,
      50 * 1024 * 1024,
    )
  ).toString('utf8');

  const records = logOut.split('\x1e').filter((rec) => rec.trim().length > 0);
  commits = records.length;

  for (const record of records) {
    const cleanRec = record.replace(/^\r?\n+/, '');
    const parts = cleanRec.split('\0');
    if (parts.length < 6) continue;
    const [sha, an, ae, cn, ce, ...rest] = parts;
    const body = rest.join('\0');
    const shortSha = sha.slice(0, 7);

    if (!ALLOWED_GIT_NAMES.has(an)) {
      violations.push({
        scope: 'git-metadata',
        location: `commit ${shortSha}`,
        line: 0,
        rule: 'disallowed_git_author_name',
      });
    }
    if (!ALLOWED_GIT_EMAILS.has(ae)) {
      violations.push({
        scope: 'git-metadata',
        location: `commit ${shortSha}`,
        line: 0,
        rule: 'disallowed_git_author_email',
      });
    }
    if (!ALLOWED_GIT_NAMES.has(cn)) {
      violations.push({
        scope: 'git-metadata',
        location: `commit ${shortSha}`,
        line: 0,
        rule: 'disallowed_git_committer_name',
      });
    }
    if (!ALLOWED_GIT_EMAILS.has(ce)) {
      violations.push({
        scope: 'git-metadata',
        location: `commit ${shortSha}`,
        line: 0,
        rule: 'disallowed_git_committer_email',
      });
    }

    for (const hit of scanText(body, { strictPictograph: true })) {
      violations.push({
        scope: 'git-metadata',
        location: `commit ${shortSha} message`,
        line: hit.line,
        rule: hit.rule,
      });
    }
  }

  return { violations, commits };
}

function extractDiffPaths(line) {
  const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (!match) return [];
  return [match[1], match[2]];
}

async function scanGitHistoryDiffs(rootDir) {
  const violations = [];
  if (!(await hasCommits(rootDir))) {
    return violations;
  }

  const diffBuf = await execGit(
    ['log', '-p', '--all', '--no-color', '--no-textconv'],
    rootDir,
    100 * 1024 * 1024,
  );
  const diffText = diffBuf.toString('utf8');
  const lines = diffText.split(/\r?\n/);

  let currentCommit = 'unknown';
  let currentFile = 'unknown';
  let hunkLine = 0;
  let inHunk = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const commitMatch = line.match(/^commit ([0-9a-f]{7,40})\b/i);
    if (commitMatch) {
      currentCommit = commitMatch[1].slice(0, 7);
      currentFile = 'unknown';
      hunkLine = 0;
      inHunk = false;
      continue;
    }

    if (line.startsWith('diff --git ')) {
      const paths = extractDiffPaths(line);
      currentFile = paths[1] || paths[0] || 'unknown';
      hunkLine = 0;
      inHunk = false;
      for (const p of paths) {
        if (FORBIDDEN_FILENAME_RE.test(p)) {
          violations.push({
            scope: 'git-history',
            location: `commit ${currentCommit} (${p})`,
            line: 0,
            rule: 'forbidden_secret_file',
          });
        }
        for (const hit of scanText(p)) {
          violations.push({
            scope: 'git-history',
            location: `commit ${currentCommit} (${p})`,
            line: 0,
            rule: `path:${hit.rule}`,
          });
        }
      }
      continue;
    }

    if (line.startsWith('@@ ')) {
      const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      hunkLine = hunkMatch ? Number.parseInt(hunkMatch[1], 10) - 1 : 0;
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith('+') || line.startsWith('-')) {
      if (line.startsWith('+')) hunkLine += 1;
      if (isBinaryFilename(currentFile)) continue;

      const contentLine = line.slice(1);
      if (contentLine.includes('\0')) continue;

      const baseName = path.basename(currentFile);
      const isTimetableDataJson = baseName === 'timetable.json' || baseName === 'classes.json';
      const hits = scanText(contentLine, {
        forbidAllIpv4: baseName === 'status.json' || isTimetableDataJson,
        strictPictograph: isStrictPictographPath(currentFile),
        allowClassSection: isTimetableDataJson,
      });
      for (const hit of hits) {
        violations.push({
          scope: 'git-history',
          location: `commit ${currentCommit} (${currentFile})`,
          line: Math.max(hunkLine, 1),
          rule: hit.rule,
        });
      }
    }
  }

  return violations;
}

export async function runPrivacyScan(options = {}) {
  const {
    rootDir = process.cwd(),
    requireDist = false,
  } = options;

  const resolvedRoot = path.resolve(rootDir);
  const violations = [];

  const trackedResult = await scanTrackedFiles(resolvedRoot);
  violations.push(...trackedResult.violations);

  const metaResult = await scanGitMetadataAndRefs(resolvedRoot);
  violations.push(...metaResult.violations);

  const historyViolations = await scanGitHistoryDiffs(resolvedRoot);
  violations.push(...historyViolations);

  const distDir = path.join(resolvedRoot, 'dist');
  let distFiles = 0;
  let distStatus = 'skipped (not present)';

  if (fs.existsSync(distDir) && fs.statSync(distDir).isDirectory()) {
    const distResult = await scanDirectory(distDir, {
      scope: 'dist',
      strictPictograph: true,
      forbidAllIpv4OnStatusJson: true,
    });
    violations.push(...distResult.violations);
    distFiles = distResult.fileCount;
    distStatus = 'scanned';
    if (requireDist && distFiles === 0) {
      violations.push({
        scope: 'dist',
        location: 'dist',
        line: 0,
        rule: 'empty_dist_dir',
      });
    }
  } else if (requireDist) {
    distStatus = 'missing (required)';
    violations.push({
      scope: 'dist',
      location: 'dist',
      line: 0,
      rule: 'missing_dist_dir',
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    stats: {
      trackedFiles: trackedResult.trackedFiles,
      commits: metaResult.commits,
      distFiles,
      distStatus,
    },
  };
}

function parseCliArgs(argv) {
  let rootDir = process.cwd();
  let requireDist = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--require-dist') {
      requireDist = true;
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --root');
      }
      rootDir = next;
      i += 1;
    } else if (arg.startsWith('--root=')) {
      rootDir = arg.slice('--root='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { rootDir, requireDist };
}

async function main() {
  const { rootDir, requireDist } = parseCliArgs(process.argv.slice(2));
  const result = await runPrivacyScan({ rootDir, requireDist });

  if (!result.ok) {
    for (const v of result.violations) {
      console.error(`[${v.scope}] ${v.location}:${v.line}: ${v.rule}`);
    }
    console.error(`Privacy scan FAIL: ${result.violations.length} violation(s) found.`);
    process.exitCode = 1;
    return;
  }

  const { trackedFiles, commits, distFiles, distStatus } = result.stats;
  console.log(
    `Privacy scan PASS (clean): scanned ${trackedFiles} tracked files, ${commits} commits, and ${distFiles} dist files (${distStatus}).`,
  );
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(`Privacy scan ERROR: ${err?.message || 'unexpected failure'}`);
    process.exitCode = 1;
  });
}
