# Cartograph — Sitemap Generator

Enter a website URL, and it crawls the site and produces two outputs:

1. **XML sitemap** (`sitemap.xml`) — standard sitemaps.org format, ready to submit
   to search engines.
2. **Interactive site-structure diagram** — a self-contained, zoomable/pannable
   HTML file showing the site's page hierarchy as a tree.

No accounts — it's a one-off tool. Submit a URL, watch live progress, download
results. Job results (and the temporary in-memory job record) expire after 2 hours.

**Default crawl engine is HTTP** (fetch + HTML parsing). That keeps memory low on
small hosts like free Render. Optional Playwright mode can render JavaScript SPAs
when you have enough RAM.

## Project layout

```
backend/     Node + Express API, crawler, sitemap/diagram generators
frontend/    React + Vite single-page app (URL form → progress → results)
```

## Running it locally

You'll need Node 18+.

### 1. Backend

```bash
cd backend
npm install
npm start                          # listens on http://localhost:4000
```

Optional SPA crawling (needs more RAM):

```bash
npx playwright install chromium
CRAWL_ENGINE=playwright npm start
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                        # listens on http://localhost:5173, proxies /api to :4000
```

Open `http://localhost:5173`, enter a URL, and go.

## How it works

- **Crawling** (`backend/src/crawler.js`): by default fetches each page over HTTP,
  parses HTML links with Cheerio, and does a breadth-first crawl (soft ceiling
  10,000 pages). It respects `robots.txt`, de-dupes URLs (trailing slashes, hashes,
  common tracking params), and skips non-HTML assets. Set `CRAWL_ENGINE=playwright`
  to use a headless browser for client-rendered SPAs instead. Any http(s) URL is
  accepted (no rate limit or SSRF block).
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
| **Instance** | Free/small is fine for the default **HTTP** crawler. Use **Starter (1 GB)+** only if you enable Playwright. |

### Environment Variables

Render injects `PORT` automatically — do **not** set it yourself.

| Key | Value | Required |
|-----|--------|----------|
| `CRAWL_ENGINE` | `http` (default) or `playwright` | Optional — leave unset for HTTP |
| `CRAWL_CONCURRENCY` | `2` | Optional (HTTP default on Render is 2) |
| `INSTALL_PLAYWRIGHT` | `1` | Only if `CRAWL_ENGINE=playwright` — installs Chromium at build |
| `PLAYWRIGHT_BROWSERS_PATH` | `0` | Only needed with Playwright |
| `NODE_ENV` | `production` | Optional |

### After deploy

Open the service URL Render gives you (e.g. `https://cartography.onrender.com`). The UI and `/api` are on the same host.

### Notes

- Default builds **skip** Chromium install to keep deploys light and memory-safe.
- To enable SPA crawling on Render: set `CRAWL_ENGINE=playwright`, `INSTALL_PLAYWRIGHT=1`,
  `PLAYWRIGHT_BROWSERS_PATH=0`, and use at least a **Starter 1 GB** instance.
- Only **one crawl at a time** is allowed on a process.
- Jobs are in-memory: a process restart clears in-progress and completed jobs.
- Heavy client-only SPAs may miss JS-injected links on the HTTP engine.
