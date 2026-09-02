import { randomUUID } from 'crypto';

// Jobs live in memory only — this is a stateless, one-off tool with no accounts,
// so results just need to survive long enough for the user to view/download them.
const JOB_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours

const jobs = new Map();

export function createJob({ url, maxPages }) {
  const id = randomUUID();
  const job = {
    id,
    url,
    maxPages,
    status: 'queued', // queued -> crawling -> paused -> generating -> done | error | cancelled
    control: 'run', // run | pause | cancel
    pagesCrawled: 0,
    pagesDiscovered: 1,
    currentUrl: null,
    log: [],
    errors: [],
    pages: [], // [{ url, title, lastmod }]
    sitemapXml: null,
    hierarchyHtml: null,
    urlListText: null,
    createdAt: Date.now(),
    completedAt: null,
    listeners: new Set(),
  };
  jobs.set(id, job);
  scheduleCleanup(id);
  return job;
}

export function getJob(id) {
  return jobs.get(id);
}

export function setJobControl(id, control) {
  const job = jobs.get(id);
  if (!job) return null;
  job.control = control;
  return job;
}

export function subscribe(id, res) {
  const job = jobs.get(id);
  if (!job) return false;
  job.listeners.add(res);
  return true;
}

export function unsubscribe(id, res) {
  const job = jobs.get(id);
  if (job) job.listeners.delete(res);
}

// Pushes a progress event to every open SSE connection for this job, and
// keeps a short rolling log on the job itself so late subscribers (e.g. a
// page refresh) can catch up via GET /api/jobs/:id.
export function emitProgress(id, event) {
  const job = jobs.get(id);
  if (!job) return;

  Object.assign(job, event.patch || {});
  if (event.logLine) {
    job.log.push({ t: Date.now(), line: event.logLine });
    if (job.log.length > 200) job.log.shift();
  }

  const payload = JSON.stringify({
    status: job.status,
    pagesCrawled: job.pagesCrawled,
    pagesDiscovered: job.pagesDiscovered,
    currentUrl: job.currentUrl,
    logLine: event.logLine || null,
  });

  for (const res of job.listeners) {
    res.write(`event: progress\ndata: ${payload}\n\n`);
  }

  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    for (const res of job.listeners) {
      res.write(`event: complete\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
      res.end();
    }
    job.listeners.clear();
  }
}

function scheduleCleanup(id) {
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
}
