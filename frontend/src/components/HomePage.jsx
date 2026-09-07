import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [excludedFolders, setExcludedFolders] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  function addFolders(text) {
    if (!text) return;
    const rawList = text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!rawList.length) return;

    setExcludedFolders((prev) => {
      const next = [...prev];
      for (const item of rawList) {
        if (!next.includes(item)) {
          next.push(item);
        }
      }
      return next;
    });
    setFolderInput('');
  }

  function handleAddClick(e) {
    e.preventDefault();
    addFolders(folderInput);
  }

  function handleFolderKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFolders(folderInput);
    }
  }

  function handleRemoveFolder(indexToRemove) {
    setExcludedFolders((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const pendingInput = folderInput.trim();
    const finalExcluded = [...excludedFolders];
    if (pendingInput) {
      const extra = pendingInput
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const item of extra) {
        if (!finalExcluded.includes(item)) {
          finalExcluded.push(item);
        }
      }
    }

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          excludedFolders: finalExcluded,
        }),
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
      <div className="hero-grid">
        <div className="hero-intro">
          <p className="hero-kicker">SITEMAP & STRUCTURE ENGINE</p>
          <h1 className="hero-title">Chart the full shape of any website.</h1>
          <p className="hero-lead">
            Enter a URL and Cartograph crawls every reachable page, generating a
            clean XML sitemap for search engines, a complete URL list, and an
            interactive visual diagram of how the site is structured.
          </p>

          <div className="hero-features">
            <div className="feature-card">
              <div className="feature-title">
                <span className="feature-icon">✦</span> XML Sitemap
              </div>
              <p className="feature-desc">
                Production-ready XML formatted for Google, Bing, and SEO indexing.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-title">
                <span className="feature-icon">✦</span> Visual Hierarchy
              </div>
              <p className="feature-desc">
                Interactive zoomable D3 diagram to explore page depths and relations.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-title">
                <span className="feature-icon">✦</span> Clean URL List
              </div>
              <p className="feature-desc">
                Downloadable text export with serial numbering for all mapped URLs.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-title">
                <span className="feature-icon">✦</span> Subfolder Filtering
              </div>
              <p className="feature-desc">
                Omit unwanted folders, blogs, or sections with smart prefix matching.
              </p>
            </div>
          </div>
        </div>

        <div className="hero-card-panel">
          <div className="hero-card-header">
            <h2>Start a crawl</h2>
            <p className="hero-card-sub">
              Enter your target website and any subfolders you want to exclude.
            </p>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <form className="hero-form" onSubmit={handleSubmit}>
            <div className="form-field">
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

            <div className="exception-bar-group">
              <div className="exception-bar-header">
                <label htmlFor="folder-input">Exclude subfolders (exception bar)</label>
                <span className="field-tip">Optional</span>
              </div>
              <p className="field-help">
                Omit specific folders and all their subpaths from the crawl (e.g.{' '}
                <code>example.com/blog</code> or <code>/blog</code>).
              </p>
              <div className="exception-input-row">
                <input
                  id="folder-input"
                  type="text"
                  placeholder="e.g. example.com/blog or /blog"
                  value={folderInput}
                  onChange={(e) => setFolderInput(e.target.value)}
                  onKeyDown={handleFolderKeyDown}
                />
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleAddClick}
                  disabled={!folderInput.trim()}
                >
                  + Add
                </button>
              </div>

              {excludedFolders.length > 0 && (
                <div className="excluded-chips">
                  {excludedFolders.map((folder, idx) => (
                    <span key={idx} className="excluded-chip">
                      <span className="chip-text">{folder}</span>
                      <button
                        type="button"
                        className="chip-remove"
                        onClick={() => handleRemoveFolder(idx)}
                        aria-label={`Remove ${folder}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="form-submit-row">
              <button type="submit" className="primary hero-submit-btn" disabled={submitting}>
                {submitting ? 'Starting…' : 'Start crawl →'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
