import { randomUUID } from 'crypto';

// Jobs live in memory only — this is a stateless, one-off tool with no accounts,
// so results just need to survive long enough for the user to view/download them.
const JOB_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours
const SSE_HEARTBEAT_MS = 15000; // keep proxies (e.g. Render) from closing idle SSE

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
    heartbeat: null,
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

function stopHeartbeat(job) {
  if (job.heartbeat) {
    clearInterval(job.heartbeat);
    job.heartbeat = null;
  }
}

function startHeartbeat(job) {
  if (job.heartbeat) return;
  job.heartbeat = setInterval(() => {
    for (const res of [...job.listeners]) {
      try {
        // SSE comment — ignored by EventSource clients, keeps the TCP connection warm.
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        job.listeners.delete(res);
      }
    }
    if (job.listeners.size === 0) stopHeartbeat(job);
  }, SSE_HEARTBEAT_MS);
  job.heartbeat.unref?.();
}

export function subscribe(id, res) {
  const job = jobs.get(id);
  if (!job) return false;
  job.listeners.add(res);
  startHeartbeat(job);
  return true;
}

export function unsubscribe(id, res) {
  const job = jobs.get(id);
  if (!job) return;
  job.listeners.delete(res);
  if (job.listeners.size === 0) stopHeartbeat(job);
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

  for (const res of [...job.listeners]) {
    try {
      res.write(`event: progress\ndata: ${payload}\n\n`);
    } catch {
      job.listeners.delete(res);
    }
  }

  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    stopHeartbeat(job);
    for (const res of [...job.listeners]) {
      try {
        res.write(`event: complete\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
        res.end();
      } catch {
        // ignore
      }
    }
    job.listeners.clear();
  }
}

function scheduleCleanup(id) {
  setTimeout(() => {
    const job = jobs.get(id);
    if (job) stopHeartbeat(job);
    jobs.delete(id);
  }, JOB_TTL_MS).unref();
}
