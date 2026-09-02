import { dedupePages } from './urlNormalize.js';

// Plain-text URL list: one unique "N. url" line per page.
export function generateUrlList(pages) {
  const unique = dedupePages(pages);
  return unique.map((p, i) => `${i + 1}. ${p.url}`).join('\n') + (unique.length ? '\n' : '');
}
