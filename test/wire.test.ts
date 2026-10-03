// Commands over HTTP (src/core/commands/wire.ts): bytes travel as base64 inside JSON, both ways, and a
// Worker (128 MB) decodes them, so they come back exact without taking many times their size to do it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fromWire, toWire } from "../src/core/commands/wire.ts";

const WIRE = path.resolve(import.meta.dirname, "../src/core/commands/wire.ts");

test("bytes come back exact, every byte value and every length around a slice's edges", () => {
  const every = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (const n of [0, 1, 2, 3, 4, 255, 256, 3 * 0x2000 - 1, 3 * 0x2000, 3 * 0x2000 + 1, 3 * 0x2000 + 2, 100_003]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => every[(i * 7) % 256]);
    const sent = JSON.parse(JSON.stringify(toWire({ files: [{ name: "f.bin", bytes }], n })));
    assert.equal(sent.files[0].bytes.$bytes, Buffer.from(bytes).toString("base64"), `base64 of ${n} bytes`);
    const back = fromWire(sent) as { files: Array<{ name: string; bytes: Uint8Array }>; n: number };
    assert.ok(back.files[0].bytes instanceof Uint8Array);
    assert.deepEqual([...back.files[0].bytes], [...bytes], `${n} bytes`);
    assert.equal(back.n, n);
  }
  // Base64 with its padding left off decodes too.
  assert.deepEqual([...(fromWire({ $bytes: "/w" }) as Uint8Array)], [255]);
});

test("decoding a file takes about its own size, not many times it", () => {
  // 8 MB of file in a 64 MB heap: one array entry per base64 character needed well over 100 MB.
  const code = `
    const { toWire, fromWire } = await import(${JSON.stringify(WIRE)});
    const bytes = new Uint8Array(8 * 1024 * 1024).map((_, i) => i * 31);
    const back = fromWire(JSON.parse(JSON.stringify(toWire({ bytes })))).bytes;
    if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new Error("not the same bytes");
    console.log("ok");`;
  const r = spawnSync(process.execPath, ["--max-old-space-size=64", "--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(r.stdout.trim(), "ok", r.stderr.slice(-500));
});
