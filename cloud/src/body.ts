// Reading a request's body with a cap, so an oversized one is refused while it streams in.

/**
 * A request's body, or null once it runs past `max` bytes. It's counted as it streams in, so a body
 * sent without a length (or with a false one) is refused before it can fill memory.
 */
export async function readUpTo(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = req.headers.get("Content-Length");
  if (Number(declared ?? 0) > max) return (await req.body?.cancel(), null);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  // With a length, the bytes go straight into one buffer; without one, they're joined at the end.
  const into = declared === null ? null : new Uint8Array(Number(declared));
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > (into ? into.byteLength : max)) return (await reader.cancel(), null);
    if (into) into.set(value, size);
    else chunks.push(value);
    size += value.byteLength;
  }
  if (into) return into.subarray(0, size);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) (out.set(c, at), (at += c.byteLength));
  return out;
}
