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

/**
 * Normalizes a user-specified folder or URL exclusion input into a standard pathname prefix.
 * e.g.:
 *   "example.com/blog" -> "/blog"
 *   "https://example.com/blog/" -> "/blog"
 *   "/blog/subfolder" -> "/blog/subfolder"
 *   "blog" -> "/blog"
 */
export function normalizeExclusionPath(raw, rootUrl = null) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let pathname = '';
  let inputHostname = null;
  let rootHostname = null;

  if (rootUrl) {
    try {
      rootHostname = new URL(rootUrl).hostname.toLowerCase();
    } catch {}
  }

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const u = new URL(trimmed);
      inputHostname = u.hostname.toLowerCase();
      pathname = u.pathname;
    } else if (trimmed.startsWith('/')) {
      pathname = trimmed.split('?')[0].split('#')[0];
    } else {
      const slashIndex = trimmed.indexOf('/');
      const domainPart = slashIndex === -1 ? trimmed : trimmed.slice(0, slashIndex);
      if (domainPart.includes('.') || (rootHostname && domainPart.toLowerCase() === rootHostname)) {
        const u = new URL('https://' + trimmed);
        inputHostname = u.hostname.toLowerCase();
        pathname = u.pathname;
      } else {
        pathname = '/' + trimmed.split('?')[0].split('#')[0];
      }
    }
  } catch {
    pathname = trimmed.startsWith('/') ? trimmed : '/' + trimmed;
    pathname = pathname.split('?')[0].split('#')[0];
  }

  if (inputHostname && rootHostname && inputHostname !== rootHostname) {
    const cleanInputHost = inputHostname.replace(/^www\./, '');
    const cleanRootHost = rootHostname.replace(/^www\./, '');
    if (cleanInputHost !== cleanRootHost) {
      return null;
    }
  }

  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }
  while (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Never exclude the root path itself
  if (pathname === '/') {
    return null;
  }

  return pathname.toLowerCase();
}

/**
 * Checks whether candidateUrl falls within any of the excluded folder paths.
 * Excludes the folder itself and all its subfolders/files, but does not match
 * partial segment names (e.g. /blog matches /blog and /blog/*, but NOT /blogging).
 */
export function isUrlExcluded(candidateUrl, excludedPaths = []) {
  if (!candidateUrl || !Array.isArray(excludedPaths) || excludedPaths.length === 0) {
    return false;
  }

  let candPath;
  try {
    candPath = new URL(candidateUrl).pathname;
  } catch {
    candPath = String(candidateUrl).split('?')[0].split('#')[0];
  }

  if (candPath.length > 1 && candPath.endsWith('/')) {
    candPath = candPath.slice(0, -1);
  }
  const lowerCand = candPath.toLowerCase();

  for (const rawPrefix of excludedPaths) {
    if (!rawPrefix) continue;
    let prefix = String(rawPrefix).trim().toLowerCase();
    if (prefix.length > 1 && prefix.endsWith('/')) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix.startsWith('/')) {
      prefix = '/' + prefix;
    }
    if (prefix === '/') continue;

    if (lowerCand === prefix || lowerCand.startsWith(prefix + '/')) {
      return true;
    }
  }

  return false;
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
