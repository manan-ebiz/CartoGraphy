import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCrawlGuard } from '../crawlGuard.jsx';

const STATUS_LABEL = {
  queued: 'Queued',
  crawling: 'Crawling',
  paused: 'Paused',
  generating: 'Generating sitemaps',
  done: 'Done',
  error: 'Error',
  cancelled: 'Cancelled',
};

const ACTIVE_STATUSES = new Set(['queued', 'crawling', 'paused', 'generating']);

export default function ProgressPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { setActive, registerCancel } = useCrawlGuard();
  const [status, setStatus] = useState('queued');
  const [pagesCrawled, setPagesCrawled] = useState(0);
  const [pagesDiscovered, setPagesDiscovered] = useState(1);
  const [currentUrl, setCurrentUrl] = useState(null);
  const [entries, setEntries] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [controlBusy, setControlBusy] = useState(false);
  const logRef = useRef(null);
  const statusRef = useRef(status);
  const finishedRef = useRef(false);

  statusRef.current = status;

  useEffect(() => {
    setActive(true);
    const unregister = registerCancel(async () => {
      await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    });
    return () => {
      unregister();
      setActive(false);
    };
  }, [jobId, setActive, registerCancel]);

  useEffect(() => {
    function onBeforeUnload(e) {
      if (!ACTIVE_STATUSES.has(statusRef.current)) return;
      e.preventDefault();
      e.returnValue = '';
    }
    function onPageHide() {
      if (!ACTIVE_STATUSES.has(statusRef.current)) return;
      navigator.sendBeacon(`/api/jobs/${jobId}/cancel`);
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [jobId]);

  useEffect(() => {
    finishedRef.current = false;
    let source = null;
    let reconnectTimer = null;
    let cancelled = false;

    function handleComplete(data) {
      finishedRef.current = true;
      setActive(false);
      if (data.status === 'done') {
        navigate(`/jobs/${jobId}/results`);
      } else if (data.status === 'cancelled') {
        navigate('/');
      } else {
        setStatus('error');
        setErrorMessage('The crawl failed. Check the log below for details.');
      }
    }

    function applyProgress(data) {
      setStatus(data.status);
      setPagesCrawled(data.pagesCrawled);
      setPagesDiscovered(data.pagesDiscovered);
      setCurrentUrl(data.currentUrl);
      if (data.logLine) {
        setEntries((prev) => [...prev.slice(-199), { line: data.logLine }]);
      }
      if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
        handleComplete({ status: data.status });
      }
    }

    async function recoverFromDisconnect() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          setStatus('error');
          setErrorMessage(
            'The crawl job was lost (server restart or idle timeout). Start a new crawl — HTTP crawling uses little memory; if this keeps happening, retry once the service is awake.',
          );
          setActive(false);
          finishedRef.current = true;
          return;
        }
        const job = await res.json();
        setStatus(job.status);
        setPagesCrawled(job.pagesCrawled);
        setPagesDiscovered(job.pagesDiscovered);
        if (job.log?.length) {
          setEntries(job.log.map((e) => ({ line: e.line })));
        }
        if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
          handleComplete({ status: job.status });
          return;
        }
        // Still running — reconnect SSE (Render proxies sometimes drop idle streams).
        setErrorMessage(null);
        reconnectTimer = setTimeout(connect, 1000);
      } catch {
        setStatus('error');
        setErrorMessage(
          'Lost connection to the server. The crawl may have failed, or this job expired.',
        );
        setActive(false);
        finishedRef.current = true;
      }
    }

    function connect() {
      if (cancelled || finishedRef.current) return;
      source = new EventSource(`/api/jobs/${jobId}/events`);

      source.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data);
        applyProgress(data);
      });

      source.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        source.close();
        handleComplete(data);
      });

      source.onerror = () => {
        source.close();
        if (cancelled || finishedRef.current) return;
        if (!ACTIVE_STATUSES.has(statusRef.current)) return;
        recoverFromDisconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (source) source.close();
    };
  }, [jobId, navigate, setActive]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [entries]);

  async function handlePause() {
    setControlBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/pause`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.error || 'Could not pause the crawl.');
      }
    } finally {
      setControlBusy(false);
    }
  }

  async function handleResume() {
    setControlBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.error || 'Could not resume the crawl.');
      }
    } finally {
      setControlBusy(false);
    }
  }

  const pct = pagesDiscovered > 0 ? Math.min(100, (pagesCrawled / pagesDiscovered) * 100) : 0;
  const canPause = status === 'crawling' && !controlBusy;
  const canResume = status === 'paused' && !controlBusy;

  return (
    <div>
      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      <div className="status-line">
        <span className={`dot${status === 'paused' ? ' paused' : ''}`} />
        <span>
          {STATUS_LABEL[status] || status}
          {currentUrl ? ` — ${currentUrl}` : ''}
        </span>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-count">
        {pagesCrawled} crawled of {pagesDiscovered} discovered so far
      </div>

      <div className="actions progress-actions">
        {status === 'paused' ? (
          <button type="button" className="primary" onClick={handleResume} disabled={!canResume}>
            Resume
          </button>
        ) : (
          <button type="button" className="ghost" onClick={handlePause} disabled={!canPause}>
            Pause
          </button>
        )}
      </div>

      <div className="log" ref={logRef}>
        {entries.map((entry, i) => (
          <div className="entry" key={i}>
            {entry.line}
          </div>
        ))}
        {entries.length === 0 && <div className="entry">Waiting for the crawler to start…</div>}
      </div>
    </div>
  );
}
