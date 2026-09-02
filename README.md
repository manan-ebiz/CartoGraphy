# Cartograph — Sitemap Generator

Enter a website URL, and it crawls the site (rendering JavaScript, so single-page
apps work) and produces two outputs:

1. **XML sitemap** (`sitemap.xml`) — standard sitemaps.org format, ready to submit
   to search engines.
2. **Interactive site-structure diagram** — a self-contained, zoomable/pannable
   HTML file showing the site's page hierarchy as a tree.

No accounts — it's a one-off tool. Submit a URL, watch live progress, download
results. Job results (and the temporary in-memory job record) expire after 2 hours.

## Project layout

```
backend/     Node + Express API, Playwright crawler, sitemap/diagram generators
frontend/    React + Vite single-page app (URL form → progress → results)
```

## Running it locally

You'll need Node 18+.

### 1. Backend

```bash
cd backend
npm install
npx playwright install chromium   # downloads the headless browser binary
npm start                          # listens on http://localhost:4000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                        # listens on http://localhost:5173, proxies /api to :4000
```

Open `http://localhost:5173`, enter a URL, and go.

## How it works

- **Crawling** (`backend/src/crawler.js`): a Playwright headless browser opens each
  page (so client-rendered links are discovered too), extracts internal links,
  and does a breadth-first crawl (default soft ceiling 10,000 pages for memory
  safety). It respects `robots.txt`, de-dupes URLs (trailing slashes, hashes,
  common tracking params), and skips non-HTML assets. Four pages are crawled
  concurrently. Any http(s) URL is accepted (no rate limit or SSRF block).
- **Progress**: the frontend opens a Server-Sent Events (SSE) connection
  (`GET /api/jobs/:id/events`) and gets a live stream of pages crawled/discovered
  and a scrolling log (numbered `N. url` lines). You can pause/resume mid-crawl;
  reloading or leaving the page warns that progress will be lost and cancels the job.
- **URL list** (`backend/src/urlListGenerator.js`): primary download — `1. url` per line.
- **XML sitemap** (`backend/src/sitemapGenerator.js`): standard sitemap protocol with
  `<loc>` entries only (no lastmod timestamps).
- **Hierarchy diagram** (`backend/src/hierarchyGenerator.js`): builds a tree keyed
  by URL path segments (e.g. `/about/team` nests under `/about`), then renders it
  as a single self-contained HTML file using D3.js (loaded from a CDN) with
  pan/zoom and click-to-expand/collapse. This file is what gets downloaded, and
  it's also what's embedded in an `<iframe>` on the results page for in-app preview.

## Known limitations / things to harden before production

- **Job storage is in-memory** — fine for a demo or single-instance deployment,
  but a restart loses in-progress and recently-completed jobs. For multi-instance
  hosting, swap the `jobManager.js` Map for Redis (or similar) and move SSE
  fan-out to a pub/sub channel.
- **No rate limiting or SSRF blocking by design** — any http(s) URL can be
  crawled. If you expose this publicly, add abuse controls appropriate for
  your threat model.
- **Concurrency is fixed at 4** — tune based on your hosting resources; higher
  concurrency crawls faster but uses more memory (each concurrent page is a real
  browser tab) and is more likely to trip target sites' own rate limiting.
- **The interactive diagram needs internet access to open** (it loads D3 from a
  CDN) — fine for normal use, but won't render offline.
- **This container's network is locked down to package registries**, so I
  verified every module except the live browser crawl itself (which needs to
  reach arbitrary websites and download the Chromium binary — both blocked
  here). Run the steps above locally to see the actual crawl end-to-end; I'd
  recommend trying it against a small site first.
