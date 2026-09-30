// Link embeds for video and social posts. Each provider maps a pasted URL to its official embed
// iframe. Third-party frames run on their own origin with a sandbox that forbids navigating
// the app; height updates are only accepted from the provider's own origin.
import { currentScheme } from "../dom.ts";

export interface EmbedInfo {
  provider: string;
  label: string;
  url: string;
  src: string;
  origin: string;
  /** CSS aspect-ratio for video players; otherwise a fixed starting height. */
  aspect?: string;
  height?: number;
  maxWidth?: number;
  heightFrom?: (data: unknown) => number | null;
  /** The provider is whatever host the URL names (Mastodon), not a known one: sandboxed tighter. */
  anyHost?: boolean;
  onLoad?: (frame: HTMLIFrameElement) => void;
}

interface Provider {
  test(u: URL): boolean;
  resolve(u: URL): EmbedInfo | Promise<EmbedInfo | null> | null;
}

const host = (u: URL) => u.hostname.replace(/^(www|m|mobile|music)\./, "");
const json = (d: unknown): any => {
  if (typeof d !== "string") return d;
  try {
    return JSON.parse(d);
  } catch {
    return null;
  }
};
const uid = () => Math.random().toString(36).slice(2, 10);

/** "90", "90s", "1m30s", "1h2m3s" → seconds */
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

const PROVIDERS: Provider[] = [
  {
    // youtube.com/watch?v=, youtu.be/, /shorts/, /live/, /embed/, playlists
    test: (u) => ["youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host(u)),
    resolve(u) {
      let id: string | null = null;
      let vertical = false;
      if (host(u) === "youtu.be") id = u.pathname.slice(1, 12);
      else if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
        if (m) [id, vertical] = [m[2], m[1] === "shorts"];
      }
      const list = u.searchParams.get("list");
      if (!id && !list) return null;
      const params = new URLSearchParams({ rel: "0" });
      const start = seconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
      if (start) params.set("start", String(start));
      if (list) params.set("list", list);
      return {
        provider: "youtube",
        label: "YouTube",
        url: u.href,
        src: `https://www.youtube-nocookie.com/embed/${id ?? "videoseries"}?${params}`,
        origin: "https://www.youtube-nocookie.com",
        aspect: vertical ? "9 / 16" : "16 / 9",
        maxWidth: vertical ? 340 : undefined,
      };
    },
  },
  {
    test: (u) => host(u) === "vimeo.com" && /^\/\d+/.test(u.pathname),
    resolve: (u) => ({
      provider: "vimeo",
      label: "Vimeo",
      url: u.href,
      src: `https://player.vimeo.com/video/${u.pathname.match(/^\/(\d+)/)![1]}?dnt=1`,
      origin: "https://player.vimeo.com",
      aspect: "16 / 9",
    }),
  },
  {
    test: (u) => host(u) === "loom.com" && /^\/share\/\w+/.test(u.pathname),
    resolve: (u) => ({
      provider: "loom",
      label: "Loom",
      url: u.href,
      src: `https://www.loom.com/embed/${u.pathname.split("/")[2]}`,
      origin: "https://www.loom.com",
      aspect: "16 / 9",
    }),
  },
  {
    test: (u) => ["twitter.com", "x.com"].includes(host(u)) && /^\/\w+\/status(es)?\/\d+/.test(u.pathname),
    resolve: (u) => ({
      provider: "x",
      label: "X",
      url: u.href,
      src: `https://platform.twitter.com/embed/Tweet.html?id=${u.pathname.match(/status(?:es)?\/(\d+)/)![1]}&theme=${currentScheme()}&dnt=true`,
      origin: "https://platform.twitter.com",
      height: 560,
      maxWidth: 550,
      heightFrom: (d) => {
        const e = json(d)?.["twttr.embed"];
        return e?.method === "twttr.private.resize" ? (e.params?.[0]?.height ?? null) : null;
      },
    }),
  },
  {
    test: (u) => host(u) === "bsky.app" && /^\/profile\/[^/]+\/post\/\w+/.test(u.pathname),
    async resolve(u) {
      const [, , handle, , rkey] = u.pathname.split("/");
      let did = handle;
      if (!did.startsWith("did:")) {
        const r = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
        if (!r.ok) return null;
        did = (await r.json()).did;
      }
      const id = uid();
      return {
        provider: "bluesky",
        label: "Bluesky",
        url: u.href,
        src: `https://embed.bsky.app/embed/${did}/app.bsky.feed.post/${rkey}?id=${id}&colorMode=${currentScheme()}`,
        origin: "https://embed.bsky.app",
        height: 380,
        maxWidth: 600,
        heightFrom: (d) => (json(d)?.id === id && typeof json(d).height === "number" ? json(d).height : null),
      };
    },
  },
  {
    // Mastodon (any instance): https://host/@user/123456789
    test: (u) => /^\/@[\w.]+(@[\w.-]+)?\/\d{6,}\/?$/.test(u.pathname),
    resolve(u) {
      const id = Number(uid().replace(/\D/g, "").slice(0, 8) || 1);
      return {
        provider: "mastodon",
        anyHost: true,
        label: "Mastodon",
        url: u.href,
        src: `${u.origin}${u.pathname.replace(/\/$/, "")}/embed`,
        origin: u.origin,
        height: 420,
        maxWidth: 550,
        heightFrom: (d) => (json(d)?.type === "setHeight" && json(d).id === id ? json(d).height : null),
        onLoad: (f) => f.contentWindow?.postMessage({ type: "setHeight", id }, u.origin),
      };
    },
  },
  {
    test: (u) => host(u) === "instagram.com" && /^\/(?:[\w.]+\/)?(p|reel|tv)\/[\w-]+/.test(u.pathname),
    resolve(u) {
      const [, kind, code] = u.pathname.match(/\/(p|reel|tv)\/([\w-]+)/)!;
      return {
        provider: "instagram",
        label: "Instagram",
        url: u.href,
        src: `https://www.instagram.com/${kind}/${code}/embed/`,
        origin: "https://www.instagram.com",
        height: 680,
        maxWidth: 480,
        heightFrom: (d) => (json(d)?.type === "MEASURE" ? (json(d).details?.height ?? null) : null),
      };
    },
  },
  {
    test: (u) => host(u) === "tiktok.com" && /\/video\/\d+/.test(u.pathname),
    resolve: (u) => ({
      provider: "tiktok",
      label: "TikTok",
      url: u.href,
      src: `https://www.tiktok.com/embed/v2/${u.pathname.match(/\/video\/(\d+)/)![1]}`,
      origin: "https://www.tiktok.com",
      height: 740,
      maxWidth: 340,
    }),
  },
  {
    test: (u) => host(u) === "open.spotify.com" && /\/(track|album|playlist|episode|show|artist)\/\w+/.test(u.pathname),
    resolve(u) {
      const [, kind, id] = u.pathname.match(/\/(track|album|playlist|episode|show|artist)\/(\w+)/)!;
      return {
        provider: "spotify",
        label: "Spotify",
        url: u.href,
        src: `https://open.spotify.com/embed/${kind}/${id}`,
        origin: "https://open.spotify.com",
        height: kind === "track" || kind === "episode" ? 152 : 352,
      };
    },
  },
];

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

export function isEmbeddable(url: string): boolean {
  const u = parse(url);
  return !!u && PROVIDERS.some((p) => p.test(u));
}

export async function resolveEmbed(url: string): Promise<EmbedInfo | null> {
  const u = parse(url);
  const p = u && PROVIDERS.find((x) => x.test(u));
  return p ? await p.resolve(u!) : null;
}

const frames = new WeakMap<HTMLIFrameElement, EmbedInfo>();

export function providerFrame(info: EmbedInfo): HTMLIFrameElement {
  const f = document.createElement("iframe");
  f.src = info.src;
  f.title = `${info.label} embed`;
  f.loading = "lazy";
  f.allowFullscreen = true;
  f.referrerPolicy = "strict-origin-when-cross-origin"; // YouTube refuses to play without a referrer
  // A provider on any host (Mastodon) could be any page at all, so it gets no forms, no clipboard,
  // and popups that stay sandboxed.
  f.setAttribute("allow", info.anyHost ? "autoplay; picture-in-picture; fullscreen" : "autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write");
  f.setAttribute(
    "sandbox",
    info.anyHost ? "allow-scripts allow-same-origin allow-popups" : "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms",
  );
  f.dataset.provider = info.provider;
  if (!info.aspect) f.style.height = `${info.height ?? 400}px`;
  if (info.onLoad) f.addEventListener("load", () => info.onLoad!(f));
  frames.set(f, info);
  return f;
}

window.addEventListener("message", (e) => {
  for (const f of document.querySelectorAll<HTMLIFrameElement>("iframe[data-provider]")) {
    if (f.contentWindow !== e.source) continue;
    const info = frames.get(f);
    if (!info?.heightFrom || e.origin !== info.origin) return;
    const h = info.heightFrom(e.data);
    if (typeof h === "number" && h > 40) {
      f.style.height = `${Math.min(Math.ceil(h), 2400)}px`;
      f.dispatchEvent(new CustomEvent("commonink-resize", { bubbles: true }));
    }
    return;
  }
});
