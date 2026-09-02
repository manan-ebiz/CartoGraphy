import { Router } from 'express';
import { createJob, getJob, setJobControl, subscribe, unsubscribe, emitProgress } from './jobManager.js';
import { crawlSite } from './crawler.js';
import { generateXmlSitemap } from './sitemapGenerator.js';
import { generateUrlList } from './urlListGenerator.js';
import { buildTree, generateHierarchyHtml } from './hierarchyGenerator.js';
import { dedupePages } from './urlNormalize.js';

const router = Router();
/** Soft safety ceiling for memory; not exposed as a restrictive UI limit. */
const DEFAULT_MAX_PAGES = 10000;

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

router.post('/jobs', async (req, res) => {
  const { url, maxPages } = req.body || {};

  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).json({ error: 'Enter a valid URL, including http:// or https://.' });
  }

  const requested = Number(maxPages);
  const resolvedMaxPages =
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_MAX_PAGES;
  const job = createJob({ url, maxPages: resolvedMaxPages });

  res.status(201).json({ jobId: job.id });

  // Run the crawl in the background; progress goes out over SSE.
  runJob(job.id).catch((err) => {
    emitProgress(job.id, { patch: { status: 'error' }, logLine: `Job failed: ${err.message}` });
  });
});

async function runJob(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  try {
    const { pages, errors, cancelled } = await crawlSite({
      rootUrl: job.url,
      maxPages: job.maxPages,
      onProgress: (event) => emitProgress(jobId, event),
      getControl: () => getJob(jobId)?.control || 'cancel',
    });

    if (cancelled || getJob(jobId)?.control === 'cancel') {
      Object.assign(job, {
        status: 'cancelled',
        pages: [],
        errors: [],
        sitemapXml: null,
        hierarchyHtml: null,
        urlListText: null,
        completedAt: Date.now(),
      });
      emitProgress(jobId, { patch: { status: 'cancelled' }, logLine: 'Job cancelled — progress discarded.' });
      return;
    }

    emitProgress(jobId, { patch: { status: 'generating' }, logLine: 'Generating sitemap files…' });

    const uniquePages = dedupePages(pages);
    const sitemapXml = generateXmlSitemap(uniquePages);
    const urlListText = generateUrlList(uniquePages);
    const tree = buildTree(uniquePages, job.url);
    const hierarchyHtml = generateHierarchyHtml(tree, new URL(job.url).hostname);

    Object.assign(job, {
      status: 'done',
      pages: uniquePages,
      errors,
      sitemapXml,
      hierarchyHtml,
      urlListText,
      completedAt: Date.now(),
    });

    emitProgress(jobId, {
      patch: { status: 'done', pagesCrawled: uniquePages.length },
      logLine: `Done — ${uniquePages.length} unique pages.`,
    });
  } catch (err) {
    Object.assign(job, { status: 'error', completedAt: Date.now() });
    emitProgress(jobId, { patch: { status: 'error' }, logLine: `Error: ${err.message}` });
  }
}

router.post('/jobs/:id/pause', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  if (job.status !== 'crawling' && job.status !== 'paused') {
    return res.status(409).json({ error: 'Only an active crawl can be paused.' });
  }
  setJobControl(job.id, 'pause');
  res.json({ ok: true, status: 'paused' });
});

router.post('/jobs/:id/resume', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  if (job.control !== 'pause' && job.status !== 'paused') {
    return res.status(409).json({ error: 'Job is not paused.' });
  }
  setJobControl(job.id, 'run');
  res.json({ ok: true, status: 'crawling' });
});

router.post('/jobs/:id/cancel', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    return res.status(409).json({ error: 'Job is already finished.' });
  }
  setJobControl(job.id, 'cancel');
  // If still queued / generating with no crawler loop, mark cancelled immediately.
  if (job.status === 'queued' || job.status === 'generating') {
    Object.assign(job, {
      status: 'cancelled',
      pages: [],
      errors: [],
      sitemapXml: null,
      hierarchyHtml: null,
      urlListText: null,
      completedAt: Date.now(),
    });
    emitProgress(job.id, { patch: { status: 'cancelled' }, logLine: 'Job cancelled.' });
  }
  res.json({ ok: true, status: 'cancelled' });
});

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });

  res.json({
    id: job.id,
    url: job.url,
    status: job.status,
    pagesCrawled: job.pagesCrawled,
    pagesDiscovered: job.pagesDiscovered,
    pageCount: job.pages.length,
    errorCount: job.errors.length,
    log: job.log.slice(-50),
  });
});

router.get('/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: progress\ndata: ${JSON.stringify({
    status: job.status,
    pagesCrawled: job.pagesCrawled,
    pagesDiscovered: job.pagesDiscovered,
    currentUrl: job.currentUrl,
  })}\n\n`);

  subscribe(job.id, res);
  req.on('close', () => unsubscribe(job.id, res));

  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    res.write(`event: complete\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
    res.end();
  }
});

router.get('/jobs/:id/urls.txt', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.urlListText) return res.status(404).end();
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="urls.txt"');
  res.send(job.urlListText);
});

router.get('/jobs/:id/sitemap.xml', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.sitemapXml) return res.status(404).end();
  res.set('Content-Type', 'application/xml');
  res.set('Content-Disposition', 'attachment; filename="sitemap.xml"');
  res.send(job.sitemapXml);
});

function hierarchyForJob(job) {
  if (!job?.pages?.length) return job?.hierarchyHtml || null;
  const tree = buildTree(job.pages, job.url);
  return generateHierarchyHtml(tree, new URL(job.url).hostname);
}

router.get('/jobs/:id/hierarchy.html', (req, res) => {
  const job = getJob(req.params.id);
  const html = hierarchyForJob(job);
  if (!html) return res.status(404).end();
  res.set('Content-Type', 'text/html');
  res.set('Content-Disposition', 'attachment; filename="site-structure.html"');
  res.send(html);
});

router.get('/jobs/:id/hierarchy-preview', (req, res) => {
  const job = getJob(req.params.id);
  const html = hierarchyForJob(job);
  if (!html) return res.status(404).end();
  res.set('Content-Type', 'text/html');
  res.send(html);
});

export default router;
