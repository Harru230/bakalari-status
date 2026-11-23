import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import {
  ALLOWED_GIT_EMAILS,
  ALLOWED_GIT_NAMES,
  buildSyntheticSecretFixtures,
  buildSyntheticStatusFixture,
  formatPragueDate,
  isDryRunSandbox,
  isRemoteBaseUrl,
  resolveRepoRoot,
  scanTextForPrivacyLeaks,
  validateStatusPayload,
} from './helpers/contracts.mjs';
import { installErrorCollectors, waitForCalendarReady } from './helpers/dom-audit.mjs';

const execFileAsync = promisify(execFile);

function initTempGitRepoWithScanner(repoRoot) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bakalari-privacy-test-'));
  fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', 'privacy-scan.mjs'),
    path.join(tmpDir, 'scripts', 'privacy-scan.mjs')
  );
  if (fs.existsSync(path.join(repoRoot, 'package.json'))) {
    fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(tmpDir, 'package.json'));
  }
  return tmpDir;
}

async function setupGitRepo(cwd, name = 'Harru230', email = '212044046+Harru230@users.noreply.github.com') {
  await execFileAsync('git', ['init'], { cwd });
  await execFileAsync('git', ['config', '--local', 'user.name', name], { cwd });
  await execFileAsync('git', ['config', '--local', 'user.email', email], { cwd });
}

async function runScannerExpectFail(cwd) {
  let exitCode = 0;
  let output = '';
  try {
    const res = await execFileAsync('node', ['scripts/privacy-scan.mjs'], { cwd, timeout: 20_000 });
    output = `${res.stdout}\n${res.stderr}`;
  } catch (err) {
    exitCode = err.code ?? 1;
    output = `${err.stdout || ''}\n${err.stderr || ''}`;
  }
  expect(exitCode, `Expected privacy-scan.mjs to fail, output: ${output}`).not.toBe(0);
  return output;
}

test.describe('F1, F10, F11, F12: Privacy, Git Hygiene, CI/CD & Live Deployment', () => {
  test('Browser DOM, status.json, and all captured JS/CSS assets contain zero privacy leaks', async ({ page }) => {
    const capturedAssets = [];
    const pendingCaptures = [];
    page.on('response', (res) => {
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (res.status() === 200 && /(javascript|ecmascript|css|json|html)/i.test(ct)) {
        pendingCaptures.push(
          res
            .text()
            .then((text) => {
              capturedAssets.push({ url: res.url(), text });
            })
            .catch(() => {
              // Ignore opaque or cancelled streams
            })
        );
      }
    });

    await page.goto('./');
    await waitForCalendarReady(page);
    await Promise.all(pendingCaptures);
    const bodyText = await page.locator('body').innerText();
    expect(scanTextForPrivacyLeaks(bodyText, { forbidAllIpv4: true })).toEqual([]);

    for (const asset of capturedAssets) {
      const leaks = scanTextForPrivacyLeaks(asset.text, {
        forbidAllIpv4: asset.url.endsWith('status.json'),
      });
      expect(leaks, `Privacy leak in ${asset.url}: ${JSON.stringify(leaks)}`).toEqual([]);
    }
  });

  // Feature 1: Repo & Git Identity Hygiene
  test('T1-F01-01: git config --local user.name is strictly Harru230', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const { stdout } = await execFileAsync('git', ['config', '--local', 'user.name'], { cwd: resolveRepoRoot() });
    expect(stdout.trim()).toBe('Harru230');
  });

  test('T1-F01-02: git config --local user.email is Harru230 noreply address', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const { stdout } = await execFileAsync('git', ['config', '--local', 'user.email'], { cwd: resolveRepoRoot() });
    expect(stdout.trim()).toBe('212044046+Harru230@users.noreply.github.com');
  });

  test('T1-F01-03: Every commit author and committer name in git log --all is allowlisted', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const { stdout } = await execFileAsync('git', ['log', '--all', '--format=%an%n%cn'], { cwd: resolveRepoRoot() });
    const names = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(ALLOWED_GIT_NAMES.has(name), `Unexpected git author/committer name: ${name}`).toBe(true);
    }
  });

  test('T1-F01-04: Every commit author and committer email in git log --all uses noreply.github.com', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const { stdout } = await execFileAsync('git', ['log', '--all', '--format=%ae%n%ce'], { cwd: resolveRepoRoot() });
    const emails = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(ALLOWED_GIT_EMAILS.has(email), `Unexpected git email: ${email}`).toBe(true);
    }
  });

  test('T1-F01-05: Tracked files include expected entrypoints and zero .env/.pem/.key secrets', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: resolveRepoRoot() });
    const files = stdout.split(/\r?\n/).filter(Boolean);
    expect(files).toContain('package.json');
    expect(files).toContain('data/status.json');
    expect(files).toContain('scripts/probe.mjs');
    expect(files).toContain('scripts/privacy-scan.mjs');
    for (const f of files) {
      expect(f).not.toMatch(/(^|\/)\.env(\.|$)|\.pem$|\.key$/i);
    }
  });

  test('T2-F01-01: Root initial commit uses Harru230 noreply identity', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const { stdout } = await execFileAsync('git', ['log', '--reverse', '--format=%an <%ae>', '-n', '1'], {
      cwd: resolveRepoRoot(),
    });
    expect(stdout.trim()).toBe('Harru230 <212044046+Harru230@users.noreply.github.com>');
  });

  test('T2-F01-02: Zero local machine filesystem paths (/Users/ or C:\\Users\\) exist in tracked files', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const repoRoot = resolveRepoRoot();
    const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
    for (const rel of stdout.split(/\r?\n/).filter(Boolean)) {
      const abs = path.join(repoRoot, rel);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
      // Exclude E2E test files' own path-regex declarations from self-matching
      if (rel.startsWith('tests/e2e/')) continue;
      const content = fs.readFileSync(abs, 'utf8');
      expect(content).not.toMatch(/\/(?:Users|home)\/[A-Za-z0-9._-]+/);
      expect(content).not.toMatch(/[A-Z]:\\Users\\[A-Za-z0-9._-]+/i);
    }
  });

  test('T2-F01-03: git remote -v contains zero embedded credentials or tokens', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const { stdout } = await execFileAsync('git', ['remote', '-v'], { cwd: resolveRepoRoot() });
    expect(stdout).not.toMatch(/gh[pousr]_|x-access-token|@.*:/i);
  });

  test('T2-F01-04: git for-each-ref branches and tags contain zero privacy leaks', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const { stdout } = await execFileAsync('git', ['for-each-ref'], { cwd: resolveRepoRoot() });
    expect(scanTextForPrivacyLeaks(stdout)).toEqual([]);
  });

  test('T2-F01-05: .gitignore excludes node_modules and dist and no stray .bak/.log files are tracked', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local git repo check');
    const repoRoot = resolveRepoRoot();
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/node_modules/);
    expect(gitignore).toMatch(/dist/);
    const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
    for (const f of stdout.split(/\r?\n/).filter(Boolean)) {
      expect(f).not.toMatch(/\.(bak|log|tmp)$/i);
    }
  });

  // Feature 10: Secret & Privacy Scanner Gate
  test('T1-F10-01: npm run test:privacy exits 0 on clean built repository', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const { stdout, stderr } = await execFileAsync('npm', ['run', 'test:privacy'], {
      cwd: resolveRepoRoot(),
      timeout: 30_000,
    });
    expect(`${stdout}\n${stderr}`.toLowerCase()).toMatch(/pass|clean|ok/);
  });

  test('T1-F10-02: Privacy scanner allows Harru230/bakalari-status and bakalari.oegp.cz/login cleanly', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const tmpDir = initTempGitRepoWithScanner(repoRoot);
    try {
      await setupGitRepo(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, 'README.md'),
        'Monitoring https://bakalari.oegp.cz/login for Harru230/bakalari-status.\n',
        'utf8'
      );
      await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
      await execFileAsync('git', ['commit', '-m', 'Clean baseline'], { cwd: tmpDir });
      await execFileAsync('node', ['scripts/privacy-scan.mjs'], { cwd: tmpDir });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('T1-F10-03: Privacy scanner rejects synthetic GitHub/Google/PEM tokens in temp repo', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const secrets = buildSyntheticSecretFixtures();
    for (const token of [secrets.githubPat, secrets.googleApiKey, secrets.pemHeader]) {
      const tmpDir = initTempGitRepoWithScanner(repoRoot);
      try {
        await setupGitRepo(tmpDir);
        fs.writeFileSync(path.join(tmpDir, 'leak.txt'), `token=${token}\n`, 'utf8');
        await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
        await execFileAsync('git', ['commit', '-m', 'Add synthetic token'], { cwd: tmpDir });
        await runScannerExpectFail(tmpDir);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  test('T1-F10-04: Privacy scanner rejects synthetic RFC1918 private IP in built dist/', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const secrets = buildSyntheticSecretFixtures();
    const tmpDir = initTempGitRepoWithScanner(repoRoot);
    try {
      await setupGitRepo(tmpDir);
      await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
      await execFileAsync('git', ['commit', '-m', 'Clean init'], { cwd: tmpDir });
      fs.mkdirSync(path.join(tmpDir, 'dist', 'assets'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'dist', 'assets', 'bundle.js'),
        `const endpoint="${secrets.rfc1918_192}";`,
        'utf8'
      );
      await runScannerExpectFail(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('T1-F10-05: Privacy scanner detects secret deleted in HEAD that remains in git history', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const secrets = buildSyntheticSecretFixtures();
    const tmpDir = initTempGitRepoWithScanner(repoRoot);
    try {
      await setupGitRepo(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'secret.txt'), `${secrets.githubPat}\n`, 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
      await execFileAsync('git', ['commit', '-m', 'Commit 1 with secret'], { cwd: tmpDir });
      fs.unlinkSync(path.join(tmpDir, 'secret.txt'));
      await execFileAsync('git', ['add', '-A'], { cwd: tmpDir });
      await execFileAsync('git', ['commit', '-m', 'Commit 2 removing secret'], { cwd: tmpDir });
      await runScannerExpectFail(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('T2-F10-01: Privacy scanner rejects synthetic class-A and class-B RFC1918 IPs in dist/', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const secrets = buildSyntheticSecretFixtures();
    for (const ip of [secrets.rfc1918_10, secrets.rfc1918_172]) {
      const tmpDir = initTempGitRepoWithScanner(repoRoot);
      try {
        await setupGitRepo(tmpDir);
        await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
        await execFileAsync('git', ['commit', '-m', 'Clean init'], { cwd: tmpDir });
        fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'dist', 'app.js'), `const host="${ip}";`, 'utf8');
        await runScannerExpectFail(tmpDir);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  test('T2-F10-02: Privacy scanner rejects Bearer token, bot token, and password env strings', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const secrets = buildSyntheticSecretFixtures();
    for (const badStr of [secrets.bearerToken, secrets.badBotToken, secrets.badEnvPass]) {
      const tmpDir = initTempGitRepoWithScanner(repoRoot);
      try {
        await setupGitRepo(tmpDir);
        fs.writeFileSync(path.join(tmpDir, 'note.txt'), badStr, 'utf8');
        await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
        await execFileAsync('git', ['commit', '-m', 'Add credential pattern'], { cwd: tmpDir });
        await runScannerExpectFail(tmpDir);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  test('T2-F10-03: Privacy scanner rejects non-allowlisted oegp subdomain or private repo reference', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const secrets = buildSyntheticSecretFixtures();
    for (const forbidden of [secrets.badSubdomain, secrets.badRepo]) {
      const tmpDir = initTempGitRepoWithScanner(repoRoot);
      try {
        await setupGitRepo(tmpDir);
        fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'data', 'status.json'), JSON.stringify({ note: forbidden }), 'utf8');
        await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
        await execFileAsync('git', ['commit', '-m', 'Add forbidden ref'], { cwd: tmpDir });
        await runScannerExpectFail(tmpDir);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  test('T2-F10-04: Privacy scanner rejects non-noreply git commit author email', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const secrets = buildSyntheticSecretFixtures();
    const tmpDir = initTempGitRepoWithScanner(repoRoot);
    try {
      await setupGitRepo(tmpDir, 'Developer', secrets.badEmail);
      fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Hello\n', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
      await execFileAsync('git', ['commit', '-m', 'Bad email commit'], { cwd: tmpDir });
      await runScannerExpectFail(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('T2-F10-05: Privacy scanner scans compiled minified JS inside dist/assets/', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local privacy scanner check');
    const repoRoot = resolveRepoRoot();
    const secrets = buildSyntheticSecretFixtures();
    const tmpDir = initTempGitRepoWithScanner(repoRoot);
    try {
      await setupGitRepo(tmpDir);
      await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
      await execFileAsync('git', ['commit', '-m', 'Clean init'], { cwd: tmpDir });
      fs.mkdirSync(path.join(tmpDir, 'dist', 'assets'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'dist', 'assets', 'index-abc123.js'),
        `(()=>{console.log("${secrets.githubPat}")})();`,
        'utf8'
      );
      await runScannerExpectFail(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Feature 11: Unified CI/CD & Pages Configuration
  test('T1-F11-01: .github/workflows/status-pages.yml configures schedule, workflow_dispatch, push, and concurrency', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local workflow file check');
    const wf = fs.readFileSync(path.join(resolveRepoRoot(), '.github', 'workflows', 'status-pages.yml'), 'utf8');
    expect(wf).toContain('11,41 * * * *');
    expect(wf).toContain('workflow_dispatch');
    expect(wf).toContain('push:');
    expect(wf).toContain('concurrency:');
  });

  test('T1-F11-02: status-pages.yml configures permissions and probe -> privacy -> build -> deploy-pages steps', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local workflow file check');
    const wf = fs.readFileSync(path.join(resolveRepoRoot(), '.github', 'workflows', 'status-pages.yml'), 'utf8');
    expect(wf).toMatch(/contents:\s*write/);
    expect(wf).toMatch(/pages:\s*write/);
    expect(wf).toMatch(/id-token:\s*write/);
    expect(wf).toContain('probe');
    expect(wf).toContain('privacy');
    expect(wf).toContain('build');
    expect(wf).toContain('actions/deploy-pages');
  });

  test('T1-F11-03: .github/workflows/ci.yml runs unit tests, build, privacy scan, and E2E on push/PR', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local workflow file check');
    const wf = fs.readFileSync(path.join(resolveRepoRoot(), '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(wf).toContain('pull_request');
    expect(wf).toContain('npm test');
    expect(wf).toContain('npm run build');
    expect(wf).toContain('test:privacy');
    expect(wf).toContain('test:e2e');
  });

  test('T1-F11-04: vite.config.js sets base: "/bakalari-status/" and build emits subpath asset paths', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local vite build check');
    const repoRoot = resolveRepoRoot();
    const viteConfig = fs.readFileSync(path.join(repoRoot, 'vite.config.js'), 'utf8');
    expect(viteConfig).toContain('/bakalari-status/');
    await execFileAsync('npm', ['run', 'build'], { cwd: repoRoot, timeout: 45_000 });
    const distHtml = fs.readFileSync(path.join(repoRoot, 'dist', 'index.html'), 'utf8');
    expect(distHtml).toContain('/bakalari-status/assets/');
  });

  test('T1-F11-05: dist/data/status.json exists after build and matches valid schema', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local dist artifact check');
    const repoRoot = resolveRepoRoot();
    const distStatusPath = path.join(repoRoot, 'dist', 'data', 'status.json');
    expect(fs.existsSync(distStatusPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(distStatusPath, 'utf8'));
    const validation = validateStatusPayload(parsed, { maxDate: formatPragueDate() });
    expect(validation.valid, validation.errors.join('\n')).toBe(true);
  });

  test('T2-F11-01: status-pages.yml guards against push loops and rebases safely with github-actions[bot]', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local workflow file check');
    const wf = fs.readFileSync(path.join(resolveRepoRoot(), '.github', 'workflows', 'status-pages.yml'), 'utf8');
    expect(wf).toMatch(/github\.event_name\s*!=\s*'push'/);
    expect(wf).toContain('github-actions[bot]');
    expect(wf).toContain('pull --rebase');
  });

  test('T2-F11-02: status-pages.yml publishes outage updates cleanly without continue-on-error workarounds', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local workflow file check');
    const wf = fs.readFileSync(path.join(resolveRepoRoot(), '.github', 'workflows', 'status-pages.yml'), 'utf8');
    expect(wf).not.toMatch(/continue-on-error:\s*true/);
    expect(wf).toContain('npm run probe');
  });

  test('T2-F11-03: Preview subpath /bakalari-status/ issues zero asset requests to root /assets/ or /data/', async ({ page }) => {
    const requestedPaths = [];
    page.on('request', (req) => {
      try {
        const u = new URL(req.url());
        if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
          requestedPaths.push(u.pathname);
        }
      } catch {
        // ignore
      }
    });

    await page.goto('./');
    await waitForCalendarReady(page);
    expect(requestedPaths.length).toBeGreaterThan(0);
    for (const p of requestedPaths) {
      expect(p.startsWith('/bakalari-status/'), `Request escaped subpath: ${p}`).toBe(true);
    }
  });

  test('T2-F11-04: Requesting /bakalari-status without trailing slash resolves cleanly with HTTP 200', async ({ request }, testInfo) => {
    const base = testInfo.project.use.baseURL || 'http://127.0.0.1:4173/bakalari-status/';
    const noSlash = base.replace(/\/+$/, '');
    const res = await request.get(noSlash);
    expect(res.status()).toBe(200);
    expect((res.headers()['content-type'] || '').toLowerCase()).toContain('text/html');
  });

  test('T2-F11-05: dist/ contains zero .env files and zero source maps leaking local /Users/ paths', async () => {
    test.skip(isRemoteBaseUrl(process.env.BASE_URL) || isDryRunSandbox(), 'Local dist cleanliness check');
    const distDir = path.join(resolveRepoRoot(), 'dist');
    expect(fs.existsSync(distDir)).toBe(true);
    const walk = (dir) => {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
      }
      return out;
    };
    const files = walk(distDir);
    for (const f of files) {
      expect(path.basename(f)).not.toMatch(/^\.env/);
      if (/\.(js|css|html|json|map)$/i.test(f)) {
        const txt = fs.readFileSync(f, 'utf8');
        const leaks = scanTextForPrivacyLeaks(txt, { forbidAllIpv4: f.endsWith('status.json') });
        expect(leaks, `Leak in ${f}: ${JSON.stringify(leaks)}`).toEqual([]);
      }
    }
  });

  // Feature 12: Public GitHub Repo & Live Pages Deployment (CHECK_LIVE=1 or remote BASE_URL)
  const shouldRunLive = () => process.env.CHECK_LIVE === '1' || isRemoteBaseUrl(process.env.BASE_URL);

  test('T1-F12-01: gh repo view confirms Harru230/bakalari-status is PUBLIC', async () => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const { stdout } = await execFileAsync('gh', ['repo', 'view', 'Harru230/bakalari-status', '--json', 'visibility,name']);
    const parsed = JSON.parse(stdout);
    expect(parsed.visibility).toBe('PUBLIC');
    expect(parsed.name).toBe('bakalari-status');
  });

  test('T1-F12-02: GitHub Pages API confirms workflow build_type and canonical html_url', async () => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const { stdout } = await execFileAsync('gh', ['api', 'repos/Harru230/bakalari-status/pages']);
    const pages = JSON.parse(stdout);
    expect(pages.build_type).toBe('workflow');
    expect(pages.html_url).toBe('https://harru230.github.io/bakalari-status/');
  });

  test('T1-F12-03: Live GitHub Pages root returns strictly HTTP 200 text/html', async ({ request }) => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const res = await request.get('https://harru230.github.io/bakalari-status/');
    expect(res.status()).toBe(200);
    expect((res.headers()['content-type'] || '').toLowerCase()).toContain('text/html');
  });

  test('T1-F12-04: Live GitHub Pages data/status.json returns HTTP 200 with today Europe/Prague entry', async ({ request }) => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const res = await request.get('https://harru230.github.io/bakalari-status/data/status.json');
    expect(res.status()).toBe(200);
    const data = await res.json();
    const todayPrague = formatPragueDate();
    expect(data.days[todayPrague]).toBeDefined();
    expect(validateStatusPayload(data, { maxDate: todayPrague }).valid).toBe(true);
  });

  test('T1-F12-05: Live GitHub Pages loads with 100% HTTP 200 assets and zero console/page errors', async ({ page }) => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const collector = installErrorCollectors(page);
    await page.goto('https://harru230.github.io/bakalari-status/');
    await waitForCalendarReady(page);
    collector.assertClean();
  });

  test('T2-F12-01: Live Pages returns HTTP 200 independently of target /login state', async ({ request }) => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const res = await request.get('https://harru230.github.io/bakalari-status/');
    expect(res.status()).toBe(200);
  });

  test('T2-F12-02: Live data/status.json passes zero-PII and RFC1918 privacy scan', async ({ request }) => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const res = await request.get('https://harru230.github.io/bakalari-status/data/status.json');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(scanTextForPrivacyLeaks(text, { forbidAllIpv4: true })).toEqual([]);
  });

  test('T2-F12-03: Live GitHub repository commits use only allowlisted noreply authors', async () => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const { stdout } = await execFileAsync('gh', ['api', 'repos/Harru230/bakalari-status/commits?per_page=100']);
    const commits = JSON.parse(stdout);
    expect(commits.length).toBeGreaterThan(0);
    for (const c of commits) {
      expect(ALLOWED_GIT_NAMES.has(c.commit.author.name)).toBe(true);
      expect(ALLOWED_GIT_EMAILS.has(c.commit.author.email)).toBe(true);
      expect(ALLOWED_GIT_NAMES.has(c.commit.committer.name)).toBe(true);
      expect(ALLOWED_GIT_EMAILS.has(c.commit.committer.email)).toBe(true);
    }
  });

  test('T2-F12-04: Live GitHub Pages serves over HTTPS with zero insecure http:// asset requests', async ({ page }) => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const insecureUrls = [];
    page.on('request', (req) => {
      if (req.url().startsWith('http://')) insecureUrls.push(req.url());
    });
    await page.goto('https://harru230.github.io/bakalari-status/');
    await waitForCalendarReady(page);
    expect(insecureUrls).toEqual([]);
  });

  test('T2-F12-05: Live DOM <script> and <link> bundles resolve under /bakalari-status/ with HTTP 200', async ({ page }) => {
    test.skip(!shouldRunLive(), 'Requires CHECK_LIVE=1 or remote BASE_URL');
    const assetResponses = [];
    page.on('response', (res) => {
      if (['script', 'stylesheet'].includes(res.request().resourceType())) {
        assetResponses.push({ url: res.url(), status: res.status() });
      }
    });
    await page.goto('https://harru230.github.io/bakalari-status/');
    await waitForCalendarReady(page);
    expect(assetResponses.length).toBeGreaterThan(0);
    for (const a of assetResponses) {
      expect(a.status).toBe(200);
      expect(new URL(a.url).pathname.startsWith('/bakalari-status/')).toBe(true);
    }
  });
});
