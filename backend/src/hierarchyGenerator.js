function humanize(segment) {
  return decodeURIComponent(segment)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

// Detect a shared brand/site suffix like " - Shah Teelani & Associates" that
// appears on most <title> tags but is not part of the page name.
function detectCommonTitleSuffix(titles) {
  const counts = new Map();
  for (const raw of titles) {
    const title = String(raw || '').trim();
    const match = title.match(/\s+([-–—|])\s+(.+)$/);
    if (!match) continue;
    const suffix = match[0];
    counts.set(suffix, (counts.get(suffix) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [suffix, count] of counts) {
    if (count > bestCount) {
      best = suffix;
      bestCount = count;
    }
  }
  const threshold = Math.max(2, Math.ceil(titles.length * 0.4));
  return bestCount >= threshold ? best : null;
}

function stripTitleSuffix(title, suffix) {
  const t = String(title || '').trim();
  if (!suffix || !t) return t;
  if (t.endsWith(suffix)) return t.slice(0, -suffix.length).trim();
  const idx = t.lastIndexOf(suffix);
  if (idx > 0) return t.slice(0, idx).trim();
  return t;
}

// Short page label for the diagram: cleaned title, else last path segment.
function pageDisplayName(path, rawTitle, commonSuffix) {
  const fromTitle = stripTitleSuffix(rawTitle, commonSuffix);
  if (fromTitle && fromTitle !== '/' && fromTitle.toLowerCase() !== path.toLowerCase()) {
    return fromTitle;
  }
  const seg = path.split('/').filter(Boolean).pop();
  return seg ? humanize(seg) : fromTitle || path;
}

function lastSegment(path) {
  if (!path || path === '/') return '';
  return path.split('/').filter(Boolean).pop() || '';
}

function singularizeSegment(seg) {
  const s = String(seg || '').toLowerCase();
  if (s.endsWith('ies') && s.length > 4) return `${s.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes|zes)$/.test(s) && s.length > 4) return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss') && s.length > 1) return s.slice(0, -1);
  return s;
}

function isPluralSegment(seg) {
  return singularizeSegment(seg) !== String(seg || '').toLowerCase();
}

// Merge sibling nodes that are singular/plural of the same word (e.g. /service + /services).
// If either URL was actually crawled, the merged node stays clickable; folder-only stays dashed.
function mergeSingularPluralSiblings(node, origin) {
  if (!node.children?.length) return;

  const groups = new Map();
  for (const child of node.children) {
    const key = singularizeSegment(lastSegment(child.path));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(child);
  }

  const nextChildren = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      nextChildren.push(group[0]);
      continue;
    }

    // Prefer plural path for the label when present; prefer a crawled URL for the link.
    const plural = group.find((n) => isPluralSegment(lastSegment(n.path)));
    const crawled = group.filter((n) => n.crawled);
    const withMostKids = [...group].sort((a, b) => b.children.length - a.children.length)[0];
    const keeper = plural || crawled[0] || withMostKids;

    const mergedKids = [];
    const seenChildPaths = new Set();
    for (const member of group) {
      for (const grand of member.children) {
        if (seenChildPaths.has(grand.path)) continue;
        seenChildPaths.add(grand.path);
        mergedKids.push(grand);
      }
    }

    const linkSource = crawled.includes(keeper)
      ? keeper
      : crawled[0] || null;

    keeper.children = mergedKids;
    keeper.crawled = Boolean(linkSource);
    if (linkSource) {
      keeper.url = linkSource.url;
      keeper.fullName = linkSource.fullName || keeper.fullName;
      // Keep a clear section label (prefer plural word).
      const labelSeg = lastSegment((plural || keeper).path);
      keeper.name = humanize(labelSeg);
      keeper.path = (plural || keeper).path;
    } else {
      // Folder-only section: no outbound page link.
      keeper.url = origin + keeper.path;
      keeper.name = humanize(lastSegment((plural || keeper).path));
    }

    nextChildren.push(keeper);
  }

  node.children = nextChildren;
  for (const child of node.children) {
    mergeSingularPluralSiblings(child, origin);
  }
}

// Turns the flat list of crawled pages into a tree keyed by URL path
// segments. Every crawled URL becomes a node; missing parents are filled in
// so the hierarchy stays navigable.
export function buildTree(pages, rootUrl) {
  const rootObj = new URL(rootUrl);
  const titleByPath = new Map();
  const crawledPaths = new Set();

  for (const p of pages) {
    const path = normalizePathname(new URL(p.url).pathname);
    crawledPaths.add(path);
    titleByPath.set(path, p.title || path);
  }

  const commonSuffix = detectCommonTitleSuffix([...titleByPath.values()]);

  const rootFull = titleByPath.get('/') || rootObj.hostname;
  const root = {
    // Prefer hostname for the root label; full page title stays in tooltip via fullName.
    name: rootObj.hostname,
    fullName: rootFull,
    url: rootObj.origin + '/',
    path: '/',
    crawled: crawledPaths.has('/'),
    children: [],
  };
  const nodesByPath = new Map([['/', root]]);

  // Stable order: shorter paths first, then alphabetical — parents before children.
  const orderedPaths = [...crawledPaths].sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    const depth = a.split('/').length - b.split('/').length;
    return depth !== 0 ? depth : a.localeCompare(b);
  });

  for (const path of orderedPaths) {
    if (path === '/') continue;
    const segments = path.split('/').filter(Boolean);
    let cumulative = '';
    let parent = root;
    for (const seg of segments) {
      cumulative += '/' + seg;
      let node = nodesByPath.get(cumulative);
      if (!node) {
        const isCrawled = crawledPaths.has(cumulative);
        const fullName = titleByPath.get(cumulative) || humanize(seg);
        const name = isCrawled
          ? pageDisplayName(cumulative, fullName, commonSuffix)
          : humanize(seg);
        node = {
          name,
          fullName,
          url: rootObj.origin + cumulative,
          path: cumulative,
          crawled: isCrawled,
          children: [],
        };
        nodesByPath.set(cumulative, node);
        parent.children.push(node);
      } else if (crawledPaths.has(cumulative)) {
        node.crawled = true;
        if (titleByPath.has(cumulative)) {
          const fullName = titleByPath.get(cumulative);
          node.fullName = fullName;
          node.name = pageDisplayName(cumulative, fullName, commonSuffix);
        }
      }
      parent = node;
    }
  }

  mergeSingularPluralSiblings(root, rootObj.origin);

  function sortRecursive(node) {
    node.children.sort((a, b) => a.path.localeCompare(b.path));
    node.children.forEach(sortRecursive);
  }
  sortRecursive(root);

  return root;
}

function countNodes(node) {
  return 1 + (node.children || []).reduce((sum, c) => sum + countNodes(c), 0);
}

// Renders the tree as a single self-contained HTML file: pan/zoom, click to
// expand/collapse, expand-all / collapse-all controls. D3 loads from a CDN.
export function generateHierarchyHtml(tree, siteLabel) {
  const treeJson = JSON.stringify(tree);
  const total = countNodes(tree);
  const safeLabel = escapeHtml(siteLabel);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Site structure — ${safeLabel}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<style>
  :root {
    --ink: #101820;
    --panel: #16212c;
    --paper: #ede6d6;
    --paper-dim: #a7a190;
    --brass: #c9a227;
    --line: #3a4753;
    --muted-stroke: #5a6874;
    --topbar-h: 56px;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%; background: var(--ink); color: var(--paper);
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    overflow: hidden;
  }
  #topbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 20;
    pointer-events: auto;
    display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px;
    min-height: var(--topbar-h);
    padding: 10px 20px;
    background: var(--ink);
    border-bottom: 1px solid var(--line);
  }
  #topbar h1 {
    font-family: Georgia, 'Source Serif Pro', serif;
    font-weight: 600; font-size: 18px; margin: 0; color: var(--paper);
  }
  #topbar .meta { color: var(--paper-dim); font-size: 12px; flex: 1; min-width: 160px; }
  #controls { display: flex; gap: 8px; pointer-events: auto; }
  #controls button {
    font-family: inherit; font-size: 12px; cursor: pointer;
    background: var(--panel); color: var(--paper); border: 1px solid var(--line);
    padding: 6px 10px; border-radius: 3px;
    pointer-events: auto;
  }
  #controls button:hover { border-color: var(--brass); color: var(--brass); }
  #hint {
    position: fixed; bottom: 12px; left: 20px; z-index: 20;
    font-size: 11px; color: var(--paper-dim); pointer-events: none;
  }
  #canvas {
    position: absolute;
    top: var(--topbar-h);
    left: 0; right: 0; bottom: 0;
  }
  #canvas svg {
    width: 100%; height: 100%; display: block; cursor: grab;
  }
  .link { fill: none; stroke: var(--line); stroke-width: 1.4px; }
  .node circle {
    fill: var(--panel); stroke: var(--brass); stroke-width: 1.5px; cursor: pointer;
  }
  .node.intermediate circle { stroke: var(--muted-stroke); stroke-dasharray: 3 2; }
  .node circle:hover { fill: var(--brass); }
  .node text {
    fill: var(--paper); font-size: 12px;
    paint-order: stroke; stroke: var(--ink); stroke-width: 4px;
  }
  .node text.linkable {
    cursor: pointer; text-decoration: underline; text-decoration-color: transparent;
  }
  .node text.linkable:hover {
    fill: var(--brass); text-decoration-color: var(--brass);
  }
</style>
</head>
<body>
<div id="topbar">
  <h1>Site structure</h1>
  <span class="meta">${safeLabel} — ${total} nodes · scroll to zoom, drag to pan · click circle to expand/collapse · click name to open page</span>
  <div id="controls">
    <button type="button" id="expandAll">Expand all</button>
    <button type="button" id="collapseAll">Collapse all</button>
  </div>
</div>
<div id="hint">Solid nodes are real pages (name opens the URL) · dashed nodes are folders only</div>
<div id="canvas"><svg></svg></div>
<script>
const data = ${treeJson};
const siteLabel = ${JSON.stringify(siteLabel)};

function truncate(str, max) {
  const s = String(str || '');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function displayName(d) {
  if (d.depth === 0) return siteLabel || d.data.name;
  return truncate(d.data.name, 40);
}

const svg = d3.select('#canvas svg');
const g = svg.append('g');
// Keep connectors under labels: after collapse→expand, new <path>s would
// otherwise append on top of surviving parent nodes and strike through names.
const gLinks = g.append('g').attr('class', 'links');
const gNodes = g.append('g').attr('class', 'nodes');
const zoom = d3.zoom().scaleExtent([0.12, 3]).on('zoom', (event) => {
  g.attr('transform', event.transform);
});
svg.call(zoom);

const root = d3.hierarchy(data);

function expandAll(d) {
  if (d._children) {
    d.children = d._children;
    d._children = null;
  }
  if (d.children) d.children.forEach(expandAll);
}

function collapseAll() {
  expandAll(root);
  if (root.children) {
    root._children = root.children;
    root.children = null;
  }
}

// Single-line labels need less vertical room; keep horizontal gap readable.
const treeLayout = d3.tree().nodeSize([42, 200]);

function fitView(minX, maxX, maxY) {
  const canvas = document.getElementById('canvas');
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const treeHeight = Math.max(maxX - minX, 1);
  const treeWidth = Math.max(maxY, 1);
  const scale = Math.min(
    0.95,
    (w - 100) / (treeWidth + 220),
    (h - 40) / (treeHeight + 100)
  );
  const s = Math.max(0.15, scale);
  const tx = 70;
  const ty = h / 2 - ((minX + maxX) / 2) * s;
  svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(s));
}

function elbowLink(d) {
  // Start slightly past the parent circle so the stroke does not run under the glyph center.
  const sx = d.source.y + 6;
  const sy = d.source.x;
  const tx = d.target.y;
  const ty = d.target.x;
  const mx = (sx + tx) / 2;
  return \`M\${sx},\${sy}C\${mx},\${sy} \${mx},\${ty} \${tx},\${ty}\`;
}

function update(shouldFit) {
  const nodes = root.descendants();
  const links = root.links();
  treeLayout(root);

  let minX = Infinity, maxX = -Infinity, maxY = 0;
  nodes.forEach((d) => {
    if (d.x < minX) minX = d.x;
    if (d.x > maxX) maxX = d.x;
    if (d.y > maxY) maxY = d.y;
  });
  if (!isFinite(minX)) { minX = 0; maxX = 0; }

  const link = gLinks.selectAll('path.link').data(links, (d) => d.target.data.path || d.target.data.url);
  link.join(
    (enter) => enter.append('path').attr('class', 'link'),
    (updateSel) => updateSel,
    (exit) => exit.remove()
  ).attr('d', elbowLink);

  // Ensure link layer stays behind nodes after every join.
  gLinks.lower();

  const node = gNodes.selectAll('g.node').data(nodes, (d) => d.data.path || d.data.url);
  const nodeEnter = node.enter().append('g')
    .attr('class', (d) => 'node' + (d.data.crawled ? '' : ' intermediate'))
    .attr('transform', (d) => \`translate(\${d.y},\${d.x})\`);

  nodeEnter.append('circle')
    .attr('r', 5)
    .on('click', (event, d) => {
      event.stopPropagation();
      if (d.children) { d._children = d.children; d.children = null; }
      else if (d._children) { d.children = d._children; d._children = null; }
      update(true);
    });

  nodeEnter.append('title')
    .text((d) => {
      const title = d.data.fullName || d.data.name;
      return d.data.crawled ? title + '\\n' + (d.data.url || '') : title + '\\n(folder — no page URL)';
    });

  nodeEnter.append('text')
    .attr('class', (d) => 'label' + (d.data.crawled ? ' linkable' : ''))
    .attr('dy', '0.32em')
    .attr('x', 10)
    .text((d) => displayName(d))
    .on('click', (event, d) => {
      event.stopPropagation();
      if (!d.data.crawled || !d.data.url) return;
      window.open(d.data.url, '_blank');
    });

  const merged = node.merge(nodeEnter)
    .attr('class', (d) => 'node' + (d.data.crawled ? '' : ' intermediate'))
    .attr('transform', (d) => \`translate(\${d.y},\${d.x})\`);

  merged.select('text.label')
    .attr('class', (d) => 'label' + (d.data.crawled ? ' linkable' : ''))
    .text((d) => displayName(d));
  merged.select('title').text((d) => {
    const title = d.data.fullName || d.data.name;
    return d.data.crawled ? title + '\\n' + (d.data.url || '') : title + '\\n(folder — no page URL)';
  });

  // Drop legacy path / open labels from older renders in this session.
  merged.selectAll('text.path, text.visit').remove();

  node.exit().remove();

  if (shouldFit) fitView(minX, maxX, maxY);
}

function onExpandAll(event) {
  event.preventDefault();
  event.stopPropagation();
  expandAll(root);
  update(true);
}

function onCollapseAll(event) {
  event.preventDefault();
  event.stopPropagation();
  collapseAll();
  update(true);
}

const expandBtn = document.getElementById('expandAll');
const collapseBtn = document.getElementById('collapseAll');
expandBtn.addEventListener('click', onExpandAll);
collapseBtn.addEventListener('click', onCollapseAll);
expandBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
collapseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });

update(true);
</script>
</body>
</html>
`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
