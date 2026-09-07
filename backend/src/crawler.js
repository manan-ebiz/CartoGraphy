import { Parser } from 'htmlparser2';
import { fetchRobotsRules, isAllowed } from './robots.js';
import { normalizeUrl } from './urlNormalize.js';

function resolveEngine() {
  const raw = (process.env.CRAWL_ENGINE || '').toLowerCase().trim();
  if (raw === 'playwright') return 'playwright';
  if (raw === 'http') return 'http';
  // Default: lightweight HTTP (safe on small Render plans). Playwright is opt-in.
  return 'http';
}

const ENGINE = resolveEngine();

const CONCURRENCY = Math.max(
  1,
  Math.min(
    4,
    Number(process.env.CRAWL_CONCURRENCY) ||
      (process.env.RENDER || ENGINE === 'http'
        ? 2
        : process.env.NODE_ENV === 'production'
          ? 2
          : 4),
  ),
);

const NAV_TIMEOUT_MS = 20000;
const SPA_LINK_WAIT_MS = 1500;
const CONTROL_POLL_MS = 400;
const USER_AGENT = 'CartographBot/1.0 (+https://cartograph.dev/bot; Website sitemap generator)';

// Cap download size per page for the HTTP crawler (default 512 KB) to prevent memory spikes on small hosts.
const MAX_HTML_BYTES = Math.max(
  64 * 1024,
  Number(process.env.MAX_PAGE_BYTES) || 512 * 1024,
);

function isSameSite(url, rootHostname) {
  try {
    return new URL(url).hostname.toLowerCase() === rootHostname;
  } catch {
    return false;
  }
}

const SKIP_EXTENSIONS =
  /\.(pdf|jpg|jpeg|png|gif|svg|webp|avif|bmp|tiff|zip|gz|tar|tgz|bz2|7z|rar|mp4|mp3|mkv|mov|avi|wmv|flac|wav|ogg|webm|css|js|mjs|ico|woff2?|eot|ttf|otf|xml|json|csv|tsv|doc|docx|xls|xlsx|ppt|pptx|bin|exe|dmg|iso|apk|deb|rpm)$/i;

const DEFAULT_MAX_PAGES = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stream HTML chunks through htmlparser2 SAX parser.
 * Extracts title and link hrefs on the fly and cancels the stream once maxBytes is reached.
 */
async function parseHtmlStream(response, maxBytes = MAX_HTML_BYTES) {
  let title = '';
  let inTitle = false;
  const hrefs = [];

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const tag = name.toLowerCase();
        if (tag === 'a' && attribs && attribs.href) {
          hrefs.push(attribs.href);
        } else if (tag === 'title') {
          inTitle = true;
        }
      },
      ontext(text) {
        if (inTitle && title.length < 300) {
          title += text;
        }
      },
      onclosetag(name) {
        if (name.toLowerCase() === 'title') {
          inTitle = false;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );

  if (!response.body) {
    parser.end();
    return { title: title.trim(), hrefs };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        const chunk = decoder.decode(value, { stream: true });
        parser.write(chunk);
        if (totalBytes >= maxBytes) {
          try {
            await reader.cancel();
          } catch {}
          break;
        }
      }
    }
  } catch {
    try {
      await reader.cancel();
    } catch {}
  } finally {
    const remaining = decoder.decode();
    if (remaining) parser.write(remaining);
    parser.end();
  }

  return { title: title.trim(), hrefs };
}

function enqueueLinks({
  hrefs,
  canonical,
  rootHostname,
  queued,
  visited,
  pageUrls,
  queue,
  pageLimit,
}) {
  for (const href of hrefs) {
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
}

function createControlGate({ getControl, onProgress, state }) {
  return async function awaitControl() {
    while (true) {
      const control = getControl();
      if (control === 'cancel') {
        state.cancelled = true;
        return 'cancel';
      }
      if (control === 'pause') {
        if (!state.pauseAnnounced) {
          state.pauseAnnounced = true;
          onProgress({ patch: { status: 'paused' }, logLine: 'Crawl paused.' });
        }
        await sleep(CONTROL_POLL_MS);
        continue;
      }
      if (state.pauseAnnounced) {
        state.pauseAnnounced = false;
        onProgress({ patch: { status: 'crawling' }, logLine: 'Crawl resumed.' });
      }
      return 'run';
    }
  };
}

async function crawlWithHttp({
  rootUrl,
  pageLimit,
  origin,
  rootHostname,
  robotsRules,
  onProgress,
  getControl,
}) {
  const visited = new Set();
  const queued = new Set([normalizeUrl(rootUrl)]);
  const queue = [normalizeUrl(rootUrl)];
  const pages = [];
  const pageUrls = new Set();
  const errors = [];
  const state = { cancelled: false, pauseAnnounced: false };
  const awaitControl = createControlGate({ getControl, onProgress, state });

  onProgress({
    patch: { status: 'crawling' },
    logLine: `HTTP crawl of ${origin} (concurrency ${CONCURRENCY}, no browser)`,
  });

  async function worker() {
    while (!state.cancelled && queue.length && visited.size < pageLimit) {
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
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
        let response;
        try {
          response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
              'User-Agent': USER_AGENT,
              Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            },
          });
        } finally {
          clearTimeout(timer);
        }

        if (getControl() === 'cancel') {
          state.cancelled = true;
          break;
        }

        const status = response.status;
        if (status >= 400) {
          try {
            await response.body?.cancel();
          } catch {}
          errors.push({ url, error: `HTTP ${status}` });
          onProgress({
            patch: { pagesCrawled: pages.length },
            logLine: `Failed: ${url} (HTTP ${status})`,
          });
          continue;
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.includes('html') && !contentType.includes('xhtml')) {
          try {
            await response.body?.cancel();
          } catch {}
          onProgress({ logLine: `Skipped (non-HTML: ${contentType}): ${url}` });
          continue;
        }

        const { title, hrefs } = await parseHtmlStream(response, MAX_HTML_BYTES);

        let canonical;
        try {
          canonical = normalizeUrl(response.url || url);
        } catch {
          canonical = url;
        }

        let addedIndex = 0;
        if (!pageUrls.has(canonical)) {
          pageUrls.add(canonical);
          visited.add(canonical);
          addedIndex = pages.push({
            url: canonical,
            title: title || canonical,
            lastmod: new Date().toISOString().slice(0, 10),
          });
        }

        enqueueLinks({
          hrefs,
          canonical,
          rootHostname,
          queued,
          visited,
          pageUrls,
          queue,
          pageLimit,
        });

        onProgress({
          patch: { pagesCrawled: pages.length, pagesDiscovered: queued.size },
          logLine: addedIndex ? `${addedIndex}. ${canonical}` : null,
        });
      } catch (err) {
        const message = err.name === 'AbortError' ? 'Navigation timeout' : err.message;
        errors.push({ url, error: message });
        onProgress({
          patch: { pagesCrawled: pages.length },
          logLine: `Failed: ${url} (${message})`,
        });
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  if (state.cancelled) {
    onProgress({ logLine: 'Crawl cancelled.' });
    return { pages, errors, rootUrl: normalizeUrl(rootUrl), cancelled: true };
  }

  onProgress({ logLine: `Crawl complete: ${pages.length} pages discovered.` });
  return { pages, errors, rootUrl: normalizeUrl(rootUrl), cancelled: false };
}

async function crawlWithPlaywright({
  rootUrl,
  pageLimit,
  origin,
  rootHostname,
  robotsRules,
  onProgress,
  getControl,
}) {
  const { chromium } = await import('playwright');

  const visited = new Set();
  const queued = new Set([normalizeUrl(rootUrl)]);
  const queue = [normalizeUrl(rootUrl)];
  const pages = [];
  const pageUrls = new Set();
  const errors = [];
  const state = { cancelled: false, pauseAnnounced: false };
  const awaitControl = createControlGate({ getControl, onProgress, state });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    javaScriptEnabled: true,
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
    logLine: `Playwright crawl of ${origin} (concurrency ${CONCURRENCY})`,
  });

  async function worker() {
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    while (!state.cancelled && queue.length && visited.size < pageLimit) {
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

        if (getControl() === 'cancel') {
          state.cancelled = true;
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
        const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));

        let canonical;
        try {
          canonical = normalizeUrl(page.url() || url);
        } catch {
          canonical = url;
        }

        let addedIndex = 0;
        if (!pageUrls.has(canonical)) {
          pageUrls.add(canonical);
          visited.add(canonical);
          addedIndex = pages.push({
            url: canonical,
            title: title || canonical,
            lastmod: new Date().toISOString().slice(0, 10),
          });
        }

        enqueueLinks({
          hrefs,
          canonical,
          rootHostname,
          queued,
          visited,
          pageUrls,
          queue,
          pageLimit,
        });

        onProgress({
          patch: { pagesCrawled: pages.length, pagesDiscovered: queued.size },
          logLine: addedIndex ? `${addedIndex}. ${canonical}` : null,
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

  try {
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
  } finally {
    await browser.close();
  }

  if (state.cancelled) {
    onProgress({ logLine: 'Crawl cancelled.' });
    return { pages, errors, rootUrl: normalizeUrl(rootUrl), cancelled: true };
  }

  onProgress({ logLine: `Crawl complete: ${pages.length} pages discovered.` });
  return { pages, errors, rootUrl: normalizeUrl(rootUrl), cancelled: false };
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

  const args = {
    rootUrl,
    pageLimit,
    origin,
    rootHostname,
    robotsRules,
    onProgress,
    getControl,
  };

  if (ENGINE === 'playwright') {
    return crawlWithPlaywright(args);
  }
  return crawlWithHttp(args);
}
