import { chromium } from 'playwright';
import { fetchRobotsRules, isAllowed } from './robots.js';
import { normalizeUrl } from './urlNormalize.js';

const CONCURRENCY = Math.max(
  1,
  Math.min(
    4,
    Number(process.env.CRAWL_CONCURRENCY) ||
      // Render OOM-kills multi-tab Chromium; default to one page at a time there.
      (process.env.RENDER ? 1 : process.env.NODE_ENV === 'production' ? 2 : 4),
  ),
);
const NAV_TIMEOUT_MS = 20000;
const SPA_LINK_WAIT_MS = 1500;
const CONTROL_POLL_MS = 400;
const USER_AGENT = 'CartographBot/1.0 (+https://cartograph.dev/bot; Website sitemap generator)';

function isSameSite(url, rootHostname) {
  try {
    return new URL(url).hostname.toLowerCase() === rootHostname;
  } catch {
    return false;
  }
}

const SKIP_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4|mp3|css|js|ico|woff2?|xml|json)$/i;

const DEFAULT_MAX_PAGES = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function crawlSite({
  rootUrl,
  maxPages = DEFAULT_MAX_PAGES,
  onProgress,
  getControl = () => 'run',
}) {
  const pageLimit =
    Number.isFinite(Number(maxPages)) && Number(maxPages) > 0
      ? Math.floor(Number(maxPages))
      : DEFAULT_MAX_PAGES;
  const root = new URL(rootUrl);
  const origin = root.origin;
  const rootHostname = root.hostname.toLowerCase();
  const robotsRules = await fetchRobotsRules(origin);

  const visited = new Set();
  const queued = new Set([normalizeUrl(rootUrl)]);
  const queue = [normalizeUrl(rootUrl)];
  const pages = [];
  const pageUrls = new Set();
  const errors = [];
  let cancelled = false;
  let pauseAnnounced = false;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    javaScriptEnabled: true,
    // Skip downloading heavy assets — we only need HTML anchors for the sitemap.
    bypassCSP: true,
  });
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font' || type === 'stylesheet') {
      return route.abort();
    }
    return route.continue();
  });

  onProgress({
    patch: { status: 'crawling' },
    logLine: `Fetching robots.txt from ${origin} (concurrency ${CONCURRENCY})`,
  });

  async function awaitControl() {
    while (true) {
      const control = getControl();
      if (control === 'cancel') {
        cancelled = true;
        return 'cancel';
      }
      if (control === 'pause') {
        if (!pauseAnnounced) {
          pauseAnnounced = true;
          onProgress({ patch: { status: 'paused' }, logLine: 'Crawl paused.' });
        }
        await sleep(CONTROL_POLL_MS);
        continue;
      }
      if (pauseAnnounced) {
        pauseAnnounced = false;
        onProgress({ patch: { status: 'crawling' }, logLine: 'Crawl resumed.' });
      }
      return 'run';
    }
  }

  async function worker() {
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    while (!cancelled && queue.length && visited.size < pageLimit) {
      const control = await awaitControl();
      if (control === 'cancel') break;
      if (!queue.length || visited.size >= pageLimit) break;

      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);

      const pathname = new URL(url).pathname;
      if (!isAllowed(pathname, robotsRules)) {
        onProgress({ logLine: `Skipped (robots.txt disallow): ${url}` });
        continue;
      }

      onProgress({ patch: { currentUrl: url } });

      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('a[href]', { timeout: SPA_LINK_WAIT_MS }).catch(() => {});

        // Re-check after a slow navigation in case the user paused/cancelled mid-load.
        if (getControl() === 'cancel') {
          cancelled = true;
          break;
        }

        const status = response ? response.status() : 0;
        if (status >= 400) {
          errors.push({ url, error: `HTTP ${status}` });
          onProgress({
            patch: { pagesCrawled: pages.length },
            logLine: `Failed: ${url} (HTTP ${status})`,
          });
          continue;
        }

        const title = await page.title();
        const links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));

        // Prefer the final URL after redirects so A → B does not create two entries.
        let canonical;
        try {
          canonical = normalizeUrl(page.url() || url);
        } catch {
          canonical = url;
        }
        if (!pageUrls.has(canonical)) {
          pageUrls.add(canonical);
          visited.add(canonical);
          pages.push({
            url: canonical,
            title: title || canonical,
            lastmod: new Date().toISOString().slice(0, 10),
          });
        }

        for (const href of links) {
          if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
            continue;
          }
          let absolute;
          try {
            absolute = normalizeUrl(new URL(href, canonical).toString());
          } catch {
            continue;
          }
          if (SKIP_EXTENSIONS.test(new URL(absolute).pathname)) continue;
          if (!isSameSite(absolute, rootHostname)) continue;
          if (queued.has(absolute) || visited.has(absolute) || pageUrls.has(absolute)) continue;
          if (queued.size >= pageLimit) continue;

          queued.add(absolute);
          queue.push(absolute);
        }

        onProgress({
          patch: { pagesCrawled: pages.length, pagesDiscovered: queued.size },
          logLine: `${pages.length}. ${canonical}`,
        });
      } catch (err) {
        errors.push({ url, error: err.message });
        onProgress({
          patch: { pagesCrawled: pages.length },
          logLine: `Failed: ${url} (${err.message})`,
        });
      }
    }

    await page.close();
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  await browser.close();

  if (cancelled) {
    onProgress({ logLine: 'Crawl cancelled.' });
    return { pages, errors, rootUrl: normalizeUrl(rootUrl), cancelled: true };
  }

  onProgress({ logLine: `Crawl complete: ${pages.length} pages discovered.` });

  return { pages, errors, rootUrl: normalizeUrl(rootUrl), cancelled: false };
}
