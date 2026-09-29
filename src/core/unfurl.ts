// Link previews for pasted URLs: fetch the page server-side (no CORS) and read its OpenGraph tags.
// Note content picks the URL, so the fetch is kept on a short leash: `guard` vets every hop before
// it's fetched (locally: public hosts only), redirects are capped, the whole thing has one deadline,
// only HTML is read, and at most MAX_BYTES of it.

export interface Unfurl {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

/** Throws if a URL mustn't be fetched. Called for the first URL and for every redirect. */
export type UrlGuard = (u: URL) => Promise<void> | void;

export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 512 * 1024;
/** How much of a page's head is read for its tags. */
const HEAD_BYTES = 64 * 1024;
const TIMEOUT = 6000;
const TTL = 6 * 3600_000;
const CACHE_SIZE = 500;

const cache = new Map<string, { at: number; value: Promise<Unfurl> }>();

export function unfurl(url: string, guard?: UrlGuard, opts: { timeout?: number } = {}): Promise<Unfurl> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = fetchPreview(url, guard, opts.timeout ?? TIMEOUT).catch(() => empty(url));
  cache.delete(url);
  cache.set(url, { at: Date.now(), value });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!); // the oldest
  return value;
}

const empty = (url: string): Unfurl => ({ url, title: null, description: null, image: null, siteName: null, favicon: null });

/** Rules for any URL we fetch, before the guard's own: http(s) only, and no credentials in it. */
function check(u: URL) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("scheme");
  if (u.username || u.password) throw new Error("credentials");
}

async function fetchPreview(raw: string, guard: UrlGuard | undefined, timeout: number): Promise<Unfurl> {
  const signal = AbortSignal.timeout(timeout);
  let u = new URL(raw);
  let res: Response | null = null;
  for (let hop = 0; ; hop++) {
    check(u);
    await guard?.(u);
    res = await fetch(u, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QuireLinkPreview/0.1)", Accept: "text/html,application/xhtml+xml" },
    });
    const loc = res.headers.get("location");
    if (!(res.status >= 300 && res.status < 400 && loc)) break;
    await res.body?.cancel();
    if (hop === MAX_REDIRECTS) throw new Error("too many redirects");
    u = new URL(loc, u);
  }
  const type = String(res.headers.get("content-type")).split(";")[0].trim().toLowerCase();
  if (!res.ok || (type !== "text/html" && type !== "application/xhtml+xml")) {
    await res.body?.cancel();
    return { ...empty(raw), siteName: u.hostname };
  }
  const html = await readCapped(res, MAX_BYTES);
  // The page is hostile too: only its head is read, at most HEAD_BYTES of it, and every pattern
  // below stops at the next "<", so none can backtrack across the page.
  const end = html.search(/<\/head>/i);
  const head = html.slice(0, Math.min(end < 0 ? html.length : end, HEAD_BYTES));
  const metas = new Map<string, string>();
  const links: Array<Record<string, string>> = [];
  for (const [tag, name] of head.matchAll(/<(meta|link)\b[^<>]*>/gi)) {
    const attrs = attributes(tag);
    if (name.toLowerCase() === "link") links.push(attrs);
    else {
      const key = (attrs.property ?? attrs.name)?.toLowerCase();
      if (key && attrs.content !== undefined && !metas.has(key)) metas.set(key, attrs.content);
    }
  }
  const meta = (name: string) => decode(metas.get(name) ?? "") || null;
  const abs = (href: string | null) => {
    try {
      return href ? new URL(href, u).href : null;
    } catch {
      return null;
    }
  };
  const icon = links.find((l) => /icon/i.test(l.rel ?? "") && l.href)?.href;
  return {
    url: raw,
    title: meta("og:title") ?? meta("twitter:title") ?? (decode(head.match(/<title[^<>]*>([^<]*)<\/title>/i)?.[1] ?? "") || null),
    description: meta("og:description") ?? meta("twitter:description") ?? meta("description"),
    image: abs(meta("og:image") ?? meta("twitter:image")),
    siteName: meta("og:site_name") ?? u.hostname.replace(/^www\./, ""),
    favicon: abs(icon ?? "/favicon.ico"),
  };
}

/** A tag's attributes, names lowercased: `<meta property="og:title" content='Hi'>` → { property, content }. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+))/g)) {
    const key = m[1].toLowerCase();
    if (!(key in out)) out[key] = m[2] ?? m[3] ?? m[4];
  }
  return out;
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

// ------------------------------------------------------------------ public hosts

/** Names that only ever mean this machine or a private network. */
export function isPrivateName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h) || !h.includes(".");
}

/** Loopback, private, link-local, shared (CGNAT), multicast and reserved addresses, v4 or v6. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  // Anything else with an embedded v4 address (mapped, NAT64, compatible) or a local scope.
  return v6 === "::" || v6 === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(v6) || v6.startsWith("::ffff:") || v6.startsWith("64:ff9b:") || /^::[0-9a-f]/.test(v6);
}

const isIpLiteral = (host: string) => /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[");

/**
 * What any guard checks without DNS: a public name or address, on the default port. The local
 * server also resolves the name (see src/server/unfurl.ts); Workers can't, and Cloudflare doesn't
 * route their fetches to private networks.
 */
export function assertPublicUrl(u: URL) {
  if (u.port) throw new Error("port");
  if (isIpLiteral(u.hostname) ? isPrivateAddress(u.hostname) : isPrivateName(u.hostname)) throw new Error("private");
}
