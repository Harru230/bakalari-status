import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const DEFAULT_BASE_URL = 'http://127.0.0.1:4173/';

function normalizeBaseUrl(rawUrl) {
  const trimmed = (rawUrl ?? '').trim();
  const candidate = trimmed || DEFAULT_BASE_URL;
  return candidate.endsWith('/') ? candidate : `${candidate}/`;
}

const hasExternalBaseUrl = Boolean(process.env.BASE_URL && process.env.BASE_URL.trim());
const baseURL = normalizeBaseUrl(process.env.BASE_URL);

const msPlaywrightCacheDir = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shouldUseMacChromeChannel =
  process.platform === 'darwin' &&
  !process.env.CI &&
  !process.env.PLAYWRIGHT_CHROMIUM &&
  !fs.existsSync(msPlaywrightCacheDir) &&
  fs.existsSync(macChromePath);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: path.join(os.tmpdir(), 'bakalari-status-e2e-artifacts'),
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...(shouldUseMacChromeChannel ? { channel: 'chrome' } : {}),
  },
  webServer: hasExternalBaseUrl
    ? undefined
    : {
        command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: DEFAULT_BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
