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

## Deploy on Render (single Web Service)

Create a **Web Service** from `https://github.com/manan-ebiz/CartoGraphy`.

| Field | Value |
|-------|--------|
| **Language** | `Node` |
| **Branch** | `main` |
| **Region** | Oregon (or any; keep other services in the same region if you use private networking) |
| **Root Directory** | *(leave empty)* |
| **Build Command** | `npm run build` |
| **Start Command** | `npm start` |
| **Instance** | At least **Starter** (1 GB). Free/tiny instances often OOM with Playwright/Chromium. |

### Environment Variables

Render injects `PORT` automatically — do **not** set it yourself.

| Key | Value | Required |
|-----|--------|----------|
| `PLAYWRIGHT_BROWSERS_PATH` | `0` | **Yes** (bundles Chromium into the app so runtime can find it) |
| `NODE_ENV` | `production` | Optional |

### After deploy

Open the service URL Render gives you (e.g. `https://cartography.onrender.com`). The UI and `/api` are on the same host.

### Notes

- Build installs Chromium with `PLAYWRIGHT_BROWSERS_PATH=0` so browsers live under `node_modules` (not an ephemeral cache).
- Cold starts / crawls on free tiers can be slow or fail under memory pressure — prefer **Starter (1 GB)+**.
- Jobs are in-memory: a restart/redeploy clears in-progress and completed jobs.
