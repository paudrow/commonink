// The few path.posix functions the core needs, written out so they run in the browser too: the app
// bundles the core's import (unzip, convert, check paths), and Vite has no node:path there, so
// `path.posix` would be undefined. These match node's path.posix for the vault's forward-slash paths.

/** Resolve "." and ".." segments and doubled slashes; "" becomes ".". */
export function normalize(p: string): string {
  if (!p) return ".";
  const absolute = p.startsWith("/");
  const trailing = p.endsWith("/");
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
    } else out.push(seg);
  }
  let s = out.join("/");
  if (!s && !absolute) s = ".";
  if (s && trailing) s += "/";
  return absolute ? `/${s}` : s;
}

export const isAbsolute = (p: string): boolean => p.startsWith("/");

export function join(...parts: string[]): string {
  const joined = parts.filter((s) => s.length > 0).join("/");
  return joined ? normalize(joined) : ".";
}

/** Strip trailing slashes (but keep a lone "/"). */
const trimEnd = (p: string) => {
  let end = p.length;
  while (end > 1 && p[end - 1] === "/") end--;
  return p.slice(0, end);
};

export function basename(p: string): string {
  const t = trimEnd(p);
  if (t === "/") return "";
  return t.slice(t.lastIndexOf("/") + 1);
}

export function dirname(p: string): string {
  if (!p) return ".";
  const t = trimEnd(p);
  if (t === "/") return "/";
  const i = t.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return t.slice(0, i);
}

export function extname(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf(".");
  return dot <= 0 || base === ".." ? "" : base.slice(dot);
}

/** The path from `from` to `to`, both relative to the same root (as the vault's paths are). */
export function relative(from: string, to: string): string {
  const a = normalize(`/${from}`).split("/").filter(Boolean);
  const b = normalize(`/${to}`).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}
