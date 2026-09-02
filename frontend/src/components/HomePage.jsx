import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the crawl.');
      navigate(`/jobs/${data.jobId}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="hero">
      <h1>Chart the full shape of a website.</h1>
      <p>
        Enter a URL and Cartograph crawls every reachable page, then hands you an XML
        sitemap for search engines and a zoomable diagram of how the site is actually
        structured.
      </p>

      {error && <div className="error-banner">{error}</div>}

      <form className="field-group" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="url">Website URL</label>
          <input
            id="url"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>

        <div>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Starting…' : 'Start crawl'}
          </button>
        </div>
      </form>
    </div>
  );
}
