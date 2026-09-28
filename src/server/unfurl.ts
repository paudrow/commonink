// Local unfurl guard: only public hosts, so a note can't make this server probe your network.
import dns from "node:dns/promises";
import net from "node:net";
import { unfurl as unfurlCore } from "../core/unfurl.ts";

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || (v6.startsWith("::ffff:") && isPrivate(v6.slice(7)));
}

async function assertPublic(u: URL) {
  if (u.hostname === "localhost" || u.hostname.endsWith(".local") || u.hostname.endsWith(".localhost")) throw new Error("private");
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error("private");
}

export const unfurl = (url: string) => unfurlCore(url, assertPublic);
