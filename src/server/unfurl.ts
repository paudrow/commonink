// Link previews for pasted URLs: fetch the page server-side (no CORS) and read its OpenGraph tags.
// Only public http(s) hosts are fetched, so a note can't use this to probe the local network.
import dns from "node:dns/promises";
import net from "node:net";

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

export function unfurl(url: string): Promise<Unfurl> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = fetchPreview(url).catch(() => empty(url));
  cache.set(url, { at: Date.now(), value });
  return value;
}

const empty = (url: string): Unfurl => ({ url, title: null, description: null, image: null, siteName: null, favicon: null });

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || (v6.startsWith("::ffff:") && isPrivate(v6.slice(7)));
}

async function assertPublic(u: URL) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("scheme");
  if (u.hostname === "localhost" || u.hostname.endsWith(".local") || u.hostname.endsWith(".localhost")) throw new Error("private");
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error("private");
}

async function fetchPreview(raw: string): Promise<Unfurl> {
  let u = new URL(raw);
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u);
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
  return new TextDecoder().decode(Buffer.concat(chunks));
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
