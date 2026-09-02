// Shared URL normalization + uniqueness for crawl results and exports.

// Strips hash fragments and common tracking params, drops a trailing slash
// (except root), lowercases the host.
export function normalizeUrl(rawUrl) {
  const u = new URL(rawUrl);
  u.hash = '';
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((p) =>
    u.searchParams.delete(p)
  );
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  // Stable search param order so ?a=1&b=2 and ?b=2&a=1 collapse.
  u.searchParams.sort();
  return u.toString();
}

/** Keep first occurrence of each normalized URL; rewrite url to canonical form. */
export function dedupePages(pages) {
  const seen = new Set();
  const unique = [];
  for (const p of pages || []) {
    if (!p?.url) continue;
    let key;
    try {
      key = normalizeUrl(p.url);
    } catch {
      key = String(p.url);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...p, url: key });
  }
  return unique;
}
