import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

export default function ResultsPage() {
  const { jobId } = useParams();
  const [job, setJob] = useState(null);
  const [urlPreview, setUrlPreview] = useState('');
  const [xmlPreview, setXmlPreview] = useState('');
  const [error, setError] = useState(null);
  const [treeKey, setTreeKey] = useState(0);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || 'Job not found or expired.');
        }
        return r.json();
      })
      .then(setJob)
      .catch((err) => setError(err.message));

    fetch(`/api/jobs/${jobId}/urls.txt`)
      .then((r) => {
        if (!r.ok) throw new Error('URL list not available.');
        return r.text();
      })
      .then((text) => {
        const lines = text.trimEnd().split('\n');
        const preview = lines.slice(0, 40).join('\n');
        setUrlPreview(lines.length > 40 ? `${preview}\n…` : preview);
      })
      .catch(() => {});

    fetch(`/api/jobs/${jobId}/sitemap.xml`)
      .then((r) => {
        if (!r.ok) throw new Error('Sitemap not available.');
        return r.text();
      })
      .then((text) => {
        const lines = text.split('\n');
        setXmlPreview(lines.slice(0, 40).join('\n') + (lines.length > 40 ? '\n…' : ''));
      })
      .catch(() => {});
  }, [jobId]);

  if (error) {
    return (
      <div className="results-page">
        <div className="error-banner">{error}</div>
        <Link to="/">
          <button className="ghost">Back to home</button>
        </Link>
      </div>
    );
  }

  if (!job) return <p className="results-page">Loading results…</p>;

  return (
    <div className="results-page">
      <div className="results-hero">
        <p className="results-kicker">Mapped site</p>
        <a className="results-site-url" href={job.url} target="_blank" rel="noreferrer">
          {job.url}
        </a>
        <div className="stat-row">
          <div className="stat">
            <div className="num">{job.pageCount}</div>
            <div className="label">pages mapped</div>
          </div>
          <div className="stat">
            <div className="num">{job.errorCount}</div>
            <div className="label">pages skipped</div>
          </div>
        </div>
      </div>

      <div className="panel panel-structure">
        <div className="panel-head">
          <div>
            <h2>Site structure</h2>
            <p className="sub">
              All {job.pageCount} mapped pages in hierarchy — zoom, pan, expand/collapse, or open a page.
            </p>
          </div>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setTreeKey((k) => k + 1)}>
              Refresh view
            </button>
            <a href={`/api/jobs/${jobId}/hierarchy-preview`} target="_blank" rel="noreferrer">
              <button type="button" className="ghost">Open full screen</button>
            </a>
            <a href={`/api/jobs/${jobId}/hierarchy.html`} download>
              <button type="button" className="ghost">Download diagram</button>
            </a>
          </div>
        </div>
        <iframe
          key={treeKey}
          className="tree-frame"
          title="Site structure diagram"
          src={`/api/jobs/${jobId}/hierarchy-preview`}
        />
      </div>

      <div className="results-split">
        <div className="panel">
          <h2>URL list</h2>
          <p className="sub">Serial number and URL on each line.</p>
          <div className="xml-preview">{urlPreview || 'Loading…'}</div>
          <div className="actions">
            <a href={`/api/jobs/${jobId}/urls.txt`} download>
              <button type="button" className="primary">Download urls.txt</button>
            </a>
          </div>
        </div>

        <div className="panel">
          <h2>XML sitemap</h2>
          <p className="sub">Standard sitemap.xml for search engines.</p>
          <div className="xml-preview">{xmlPreview}</div>
          <div className="actions">
            <a href={`/api/jobs/${jobId}/sitemap.xml`} download>
              <button type="button" className="ghost">Download sitemap.xml</button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
