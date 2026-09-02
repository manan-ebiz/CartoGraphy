// Small, dependency-free robots.txt parser. Good enough for a single
// user-agent (*) with Allow/Disallow rules — not a full spec implementation.
export async function fetchRobotsRules(origin) {
  try {
    const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { disallow: [], allow: [] };
    const text = await res.text();
    return parseRobots(text);
  } catch {
    return { disallow: [], allow: [] };
  }
}

function parseRobots(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const disallow = [];
  const allow = [];
  let inWildcardGroup = false;

  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      inWildcardGroup = value === '*';
    } else if (inWildcardGroup && key === 'disallow' && value) {
      disallow.push(value);
    } else if (inWildcardGroup && key === 'allow' && value) {
      allow.push(value);
    }
  }
  return { disallow, allow };
}

export function isAllowed(pathname, rules) {
  const disallowed = rules.disallow.some((p) => pathname.startsWith(p));
  if (!disallowed) return true;
  const allowedOverride = rules.allow.some((p) => pathname.startsWith(p));
  return allowedOverride;
}
