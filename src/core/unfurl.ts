// Link previews for pasted URLs: fetch the page server-side (no CORS) and read its OpenGraph tags.
// `guard` vets every hop's URL before it's fetched (locally: public hosts only).

export interface Unfurl {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

const cache = new Map<string, { at: number; value: Promise<Unfurl> }>();
const TTL = 6 * 3600_000;

export type UrlGuard = (u: URL) => Promise<void>;

export function unfurl(url: string, guard?: UrlGuard): Promise<Unfurl> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = fetchPreview(url, guard).catch(() => empty(url));
  cache.set(url, { at: Date.now(), value });
  return value;
}

const empty = (url: string): Unfurl => ({ url, title: null, description: null, image: null, siteName: null, favicon: null });

async function fetchPreview(raw: string, guard?: UrlGuard): Promise<Unfurl> {
  let u = new URL(raw);
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(u.protocol)) throw new Error("scheme");
    await guard?.(u);
    res = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QuireLinkPreview/0.1)", Accept: "text/html,application/xhtml+xml" },
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) u = new URL(loc, u);
    else break;
  }
  if (!res?.ok || !String(res.headers.get("content-type")).includes("html")) return { ...empty(raw), siteName: u.hostname };
  const html = await readCapped(res, 512 * 1024);
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || undefined);
  const meta = (name: string) => {
    for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = m[0];
      const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (key === name) return decode(tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find((x) => x !== undefined) ?? "") || null;
    }
    return null;
  };
  const abs = (href: string | null) => {
    try {
      return href ? new URL(href, u).href : null;
    } catch {
      return null;
    }
  };
  const icon = head.match(/<link\b[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i)?.[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
  return {
    url: raw,
    title: meta("og:title") ?? meta("twitter:title") ?? (decode(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "") || null),
    description: meta("og:description") ?? meta("twitter:description") ?? meta("description"),
    image: abs(meta("og:image") ?? meta("twitter:image")),
    siteName: meta("og:site_name") ?? u.hostname.replace(/^www\./, ""),
    favicon: abs(icon ?? "/favicon.ico"),
  };
}

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  void reader.cancel().catch(() => {});
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) (all.set(c, at), (at += c.length));
  return new TextDecoder().decode(all.subarray(0, Math.min(size, max)));
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}
