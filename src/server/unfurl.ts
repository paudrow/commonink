// Local unfurl guard: only public hosts, so a note can't make this server probe your network.
import dns from "node:dns/promises";
import { assertPublicUrl, isPrivateAddress, unfurl as unfurlCore } from "../core/unfurl.ts";

async function assertPublic(u: URL) {
  assertPublicUrl(u);
  const addrs = await dns.lookup(u.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("private");
}

export const unfurl = (url: string) => unfurlCore(url, assertPublic);
