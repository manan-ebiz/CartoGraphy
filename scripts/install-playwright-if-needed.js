/**
 * Playwright/Chromium is optional. Default crawls use HTTP + Cheerio.
 * Install Chromium only when explicitly requested (SPA / high-RAM hosts).
 */
const wantPlaywright =
  process.env.INSTALL_PLAYWRIGHT === '1' ||
  (process.env.CRAWL_ENGINE || '').toLowerCase() === 'playwright';

if (!wantPlaywright) {
  console.log('Skipping Playwright Chromium install (HTTP crawl is the default).');
  console.log('Set INSTALL_PLAYWRIGHT=1 or CRAWL_ENGINE=playwright to install the browser.');
  process.exit(0);
}

const { spawnSync } = require('child_process');

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' };
const result = spawnSync(
  'npx',
  ['--prefix', 'backend', 'playwright', 'install', 'chromium'],
  { stdio: 'inherit', env, shell: true },
);

process.exit(result.status ?? 1);
