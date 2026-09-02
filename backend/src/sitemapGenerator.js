import { dedupePages } from './urlNormalize.js';

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Produces a sitemap.xml with unique <loc> entries (sitemaps.org, loc only).
export function generateXmlSitemap(pages) {
  const unique = dedupePages(pages);
  const urlEntries = unique
    .map(
      (p) => `  <url>
    <loc>${escapeXml(p.url)}</loc>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`;
}
