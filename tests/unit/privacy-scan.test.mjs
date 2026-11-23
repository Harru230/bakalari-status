import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  ALLOWED_GIT_EMAILS,
  ALLOWED_GIT_NAMES,
  runPrivacyScan,
  scanDirectory,
  scanText,
} from '../../scripts/privacy-scan.mjs';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNER_PATH = path.join(REPO_ROOT, 'scripts', 'privacy-scan.mjs');

const ALLOWLIST_NAME = 'Harru230';
const ALLOWLIST_EMAIL = ['212044046+Harru230', 'users.noreply.github.com'].join('@');
const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

function buildSyntheticFixtures() {
  return {
    ghToken: ['ghp', '_', 'TESTFAKE0000000000000000000000000000'].join(''),
    googleKey: ['AI', 'za', 'SyTESTFAKE000000000000000000000000000'].join(''),
    pemHeader: ['-----BE', 'GIN RSA PRI', 'VATE KEY-----'].join(''),
    bearer: ['Bea', 'rer ', 'syntheticTestTokenValue12345'].join(''),
    botToken: ['123456789', ':', 'AA', 'TestFakeBotToken0000000000000000000'].join(''),
    envPass: ['BAK', 'PASS'].join('_') + '=superSecretValue123',
    genericSecret: ['MY_APP', 'SECRET'].join('_') + '=superSecretToken987654',
    rfc192: ['192', '168', '54', '2'].join('.'),
    rfc10: ['10', '0', '0', '1'].join('.'),
    rfc172: ['172', '16', '0', '5'].join('.'),
    schoolIp: ['193', '41', '155', '4'].join('.'),
    userPath: ['/Us', 'ers/', 'sampledev', '/project'].join(''),
    badEmail: ['dev', '@', 'example.com'].join(''),
    badOegp: ['delta', '.', 'oe', 'gp', '.cz'].join(''),
    badRepo: ['Har', 'ru230', '/', 'oe', 'gp'].join(''),
    personalName: ['ad', 'am', 'pi', 'pal'].join(''),
    schoolHubTerm: ['sch', 'ool-', 'hub'].join(''),
    eduvTerm: ['edu', 'vidual'].join(''),
    class4a: ['class ', '4', 'A'].join(''),
    rocketEmoji: String.fromCodePoint(0x1f680),
    checkSymbol: '\u2714',
  };
}

async function initTempRepo(name = ALLOWLIST_NAME, email = ALLOWLIST_EMAIL) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bakalari-privacy-unit-'));
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', '--local', 'user.name', name], { cwd: dir });
  await execFileAsync('git', ['config', '--local', 'user.email', email], { cwd: dir });
  return dir;
}

async function gitCommitAll(cwd, message) {
  await execFileAsync('git', ['add', '-A'], { cwd });
  await execFileAsync('git', ['commit', '-m', message], { cwd });
}

async function runCli(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [SCANNER_PATH, ...args], {
      cwd,
      timeout: 20_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

describe('privacy-scan unit tests', () => {
  it('exports expected allowlists and keeps scanner and test source self-clean', async () => {
    assert.equal(ALLOWED_GIT_NAMES.has(ALLOWLIST_NAME), true);
    assert.equal(ALLOWED_GIT_NAMES.has(BOT_NAME), true);
    assert.equal(ALLOWED_GIT_EMAILS.has(ALLOWLIST_EMAIL), true);
    assert.equal(ALLOWED_GIT_EMAILS.has(BOT_EMAIL), true);

    const scannerSource = await fs.readFile(SCANNER_PATH, 'utf8');
    const testSource = await fs.readFile(fileURLToPath(import.meta.url), 'utf8');
    assert.deepEqual(scanText(scannerSource, { strictPictograph: true }), []);
    assert.deepEqual(scanText(testSource, { strictPictograph: false }), []);
  });

  it('passes cleanly on valid temp repo without dist/ and prints PASS (clean)', async () => {
    const dir = await initTempRepo();
    try {
      await fs.writeFile(
        path.join(dir, 'README.md'),
        `Status monitor for https://bakalari.${['oe', 'gp', '.cz'].join('')}/login (${ALLOWLIST_NAME}/bakalari-status)\n`,
        'utf8',
      );
      await fs.mkdir(path.join(dir, 'data'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'data', 'status.json'),
        JSON.stringify({ schemaVersion: 1, target: `https://bakalari.${['oe', 'gp', '.cz'].join('')}/login` }),
        'utf8',
      );
      await gitCommitAll(dir, 'chore: clean baseline');

      const res = await runPrivacyScan({ rootDir: dir });
      assert.equal(res.ok, true);
      assert.equal(res.violations.length, 0);
      assert.equal(res.stats.trackedFiles, 2);
      assert.equal(res.stats.commits, 1);
      assert.equal(res.stats.distStatus, 'skipped (not present)');

      const cli = await runCli(['--root', dir], dir);
      assert.equal(cli.code, 0);
      assert.match(cli.stdout, /^Privacy scan PASS \(clean\): scanned 2 tracked files, 1 commits, and 0 dist files/m);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('fails with --require-dist when dist/ is missing or empty', async () => {
    const dir = await initTempRepo();
    try {
      await fs.writeFile(path.join(dir, 'README.md'), 'Clean\n', 'utf8');
      await gitCommitAll(dir, 'chore: clean init');

      const missingRes = await runPrivacyScan({ rootDir: dir, requireDist: true });
      assert.equal(missingRes.ok, false);
      assert.equal(missingRes.violations.some((v) => v.rule === 'missing_dist_dir'), true);

      await fs.mkdir(path.join(dir, 'dist'), { recursive: true });
      const emptyRes = await runPrivacyScan({ rootDir: dir, requireDist: true });
      assert.equal(emptyRes.ok, false);
      assert.equal(emptyRes.violations.some((v) => v.rule === 'empty_dist_dir'), true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('enforces match-level allowlisting so same-line leaks are never masked', () => {
    const fx = buildSyntheticFixtures();
    const cleanLine = [
      ALLOWLIST_NAME,
      ALLOWLIST_EMAIL,
      BOT_NAME,
      BOT_EMAIL,
      `https://bakalari.${['oe', 'gp', '.cz'].join('')}/login`,
      `${ALLOWLIST_NAME}/bakalari-status`,
      'https://harru230.github.io/bakalari-status/',
    ].join(' ');
    assert.deepEqual(scanText(cleanLine), []);

    const mixedDomain = `https://bakalari.${['oe', 'gp', '.cz'].join('')}/login and ${fx.badOegp}`;
    assert.equal(scanText(mixedDomain).some((h) => h.rule === 'non_allowlisted_oegp_domain'), true);

    const mixedEmail = `${ALLOWLIST_EMAIL} ${fx.badEmail}`;
    assert.equal(scanText(mixedEmail).some((h) => h.rule === 'non_allowlisted_email'), true);

    const mixedRepo = `${ALLOWLIST_NAME}/bakalari-status ${fx.badRepo}`;
    assert.equal(scanText(mixedRepo).some((h) => h.rule === 'non_allowlisted_repo'), true);

    const mixedColorAndSection = `#4a4a4a ${fx.class4a}`;
    assert.equal(scanText(mixedColorAndSection).some((h) => h.rule === 'class_section'), true);
  });

  it('catches working tree secrets and prints sanitized stderr without raw secret values', async () => {
    const fx = buildSyntheticFixtures();
    const secretCases = [
      fx.ghToken,
      fx.googleKey,
      fx.pemHeader,
      fx.bearer,
      fx.botToken,
      fx.envPass,
      fx.genericSecret,
      fx.userPath,
      fx.personalName,
      fx.schoolHubTerm,
      fx.eduvTerm,
      fx.badRepo,
    ];

    for (const secretValue of secretCases) {
      const dir = await initTempRepo();
      try {
        await fs.writeFile(path.join(dir, 'leak.txt'), `value=${secretValue}\n`, 'utf8');
        await gitCommitAll(dir, 'chore: add test file');

        const cli = await runCli([], dir);
        assert.equal(cli.code, 1, `Expected failure for ${secretValue}`);
        assert.match(cli.stderr, /\[tracked\] leak\.txt:1:/);
        assert.equal(cli.stderr.includes(secretValue), false, 'stderr must never echo raw secret value');
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }

    const envDir = await initTempRepo();
    try {
      await fs.writeFile(path.join(envDir, '.env.local'), 'PORT=3000\n', 'utf8');
      await gitCommitAll(envDir, 'chore: add env file');
      const res = await runPrivacyScan({ rootDir: envDir });
      assert.equal(res.ok, false);
      assert.equal(res.violations.some((v) => v.rule === 'forbidden_secret_file'), true);
    } finally {
      await fs.rm(envDir, { recursive: true, force: true });
    }
  });

  it('detects secret deleted in HEAD that remains in git commit diff history', async () => {
    const fx = buildSyntheticFixtures();
    const dir = await initTempRepo();
    try {
      await fs.writeFile(path.join(dir, 'secret.txt'), `${fx.ghToken}\n`, 'utf8');
      await gitCommitAll(dir, 'feat: add secret');
      await fs.unlink(path.join(dir, 'secret.txt'));
      await gitCommitAll(dir, 'chore: delete secret');

      const res = await runPrivacyScan({ rootDir: dir });
      assert.equal(res.ok, false);
      assert.equal(
        res.violations.some((v) => v.scope === 'git-history' && v.rule === 'github_token'),
        true,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects non-allowlisted git author/committer metadata and emojis in commit messages', async () => {
    const fx = buildSyntheticFixtures();

    const badAuthorDir = await initTempRepo('Personal User', fx.badEmail);
    try {
      await fs.writeFile(path.join(badAuthorDir, 'README.md'), 'Hello\n', 'utf8');
      await gitCommitAll(badAuthorDir, 'chore: commit with personal email');
      const res = await runPrivacyScan({ rootDir: badAuthorDir });
      assert.equal(res.ok, false);
      assert.equal(
        res.violations.some((v) => v.scope === 'git-metadata' && v.rule === 'disallowed_git_author_name'),
        true,
      );
      assert.equal(
        res.violations.some((v) => v.scope === 'git-metadata' && v.rule === 'disallowed_git_author_email'),
        true,
      );
    } finally {
      await fs.rm(badAuthorDir, { recursive: true, force: true });
    }

    const badMsgDir = await initTempRepo();
    try {
      await fs.writeFile(path.join(badMsgDir, 'README.md'), 'Hello\n', 'utf8');
      await gitCommitAll(badMsgDir, `chore: launch ${fx.rocketEmoji}`);
      const res = await runPrivacyScan({ rootDir: badMsgDir });
      assert.equal(res.ok, false);
      assert.equal(
        res.violations.some((v) => v.scope === 'git-metadata' && v.rule === 'ai_slop_emoji'),
        true,
      );
    } finally {
      await fs.rm(badMsgDir, { recursive: true, force: true });
    }
  });

  it('rejects RFC1918 IPs, school IP, JS token, and status.json IPv4 literals inside dist/', async () => {
    const fx = buildSyntheticFixtures();
    const cases = [
      { file: 'assets/app.js', content: `const h="${fx.rfc192}";`, rule: 'rfc1918_ip' },
      { file: 'assets/app.js', content: `const h="${fx.rfc10}";`, rule: 'rfc1918_ip' },
      { file: 'assets/app.js', content: `const h="${fx.rfc172}";`, rule: 'rfc1918_ip' },
      { file: 'assets/app.js', content: `const h="${fx.schoolIp}";`, rule: 'school_ip' },
      { file: 'assets/app.js', content: `const t="${fx.ghToken}";`, rule: 'github_token' },
      { file: 'data/status.json', content: '{"ip":"8.8.8.8"}', rule: 'ipv4_literal' },
    ];

    for (const tc of cases) {
      const dir = await initTempRepo();
      try {
        await fs.writeFile(path.join(dir, 'README.md'), 'Clean\n', 'utf8');
        await gitCommitAll(dir, 'chore: init');
        const target = path.join(dir, 'dist', tc.file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, tc.content, 'utf8');

        const res = await runPrivacyScan({ rootDir: dir, requireDist: true });
        assert.equal(res.ok, false);
        assert.equal(
          res.violations.some((v) => v.scope === 'dist' && v.rule === tc.rule),
          true,
          `Expected dist violation ${tc.rule} for ${tc.file}`,
        );
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('enforces AI-slop emoji and strict pictograph rules without false-positiving on test regexes', () => {
    const fx = buildSyntheticFixtures();
    assert.equal(
      scanText(`Hello ${fx.rocketEmoji}`, { strictPictograph: false }).some((h) => h.rule === 'ai_slop_emoji'),
      true,
    );
    assert.equal(
      scanText(`const ok = "${fx.checkSymbol}";`, { strictPictograph: true }).some(
        (h) => h.rule === 'pictograph_or_unicode_symbol',
      ),
      true,
    );
    assert.deepEqual(scanText(`const re = /[${fx.checkSymbol}]/;`, { strictPictograph: false }), []);
  });

  it('catches class section variants while ignoring hex colors, SRI integrity hashes, and git SHAs', () => {
    const cleanVariants = [
      'color: #4a4a4a; background: #4a5;',
      '"integrity": "sha512-MzCVoWtcg4Pm2B3je5mMvYMvj3MmBKw+fU7vbsJc9/iT8ip6/eYIHo/Dsm/mr+wsHB6SEyJDuxB09Yy6r/8+4A=="',
      'const sha = "f6ee697a1ee11ae8b0ff64a0dbc11581a0f51054";',
      'url("data:image/png;base64,iVBORw0KGgoAAA+4A==");',
    ];
    for (const line of cleanVariants) {
      assert.deepEqual(scanText(line), [], `Unexpected match on: ${line}`);
    }

    const leakyVariants = [
      ['class ', '4', 'A'].join(''),
      ['4', 'a'].join(''),
      ['4', '.', 'A'].join(''),
      ['class-', '4', 'A'].join(''),
    ];
    for (const line of leakyVariants) {
      assert.equal(
        scanText(line).some((h) => h.rule === 'class_section'),
        true,
        `Expected class_section match on: ${line}`,
      );
    }
  });

  it('safely skips binary files containing NUL bytes in dist/ and git working tree', async () => {
    const dir = await initTempRepo();
    try {
      const binBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]);
      await fs.writeFile(path.join(dir, 'asset.bin'), binBuf);
      await gitCommitAll(dir, 'chore: add binary');

      await fs.mkdir(path.join(dir, 'dist'), { recursive: true });
      await fs.writeFile(path.join(dir, 'dist', 'blob.bin'), binBuf);

      const dirScan = await scanDirectory(path.join(dir, 'dist'));
      assert.equal(dirScan.fileCount, 1);
      assert.deepEqual(dirScan.violations, []);

      const res = await runPrivacyScan({ rootDir: dir, requireDist: true });
      assert.equal(res.ok, true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
