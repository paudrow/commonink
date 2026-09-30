import { test } from "node:test";
import assert from "node:assert/strict";
import { saveChain } from "../web/src/saveChain.ts";

/** A note on a server that refuses a save made against an old version, the way PUT /note does. */
function server(text: string) {
  const s = { text, version: 1 };
  return {
    s,
    put(next: string, base: number) {
      if (base !== s.version) return Promise.reject(new Error("conflict"));
      s.text = next;
      s.version++;
      return Promise.resolve(s.version);
    },
  };
}

test("saves made on text a failed save's reload replaced don't write over the other change", async () => {
  const srv = server("a\n");
  let mine = { text: "a\n", version: 1 };
  const chain = saveChain(
    async (text) => {
      mine.version = await srv.put(text, mine.version);
    },
    async () => {
      mine = { text: srv.s.text, version: srv.s.version };
    },
  );
  // An agent changes the note, then two quick board edits go out, each made on the last.
  srv.s.text = "a\nagent\n";
  srv.s.version++;
  void chain.push("a\nmine 1\n");
  await chain.push("a\nmine 1\nmine 2\n");
  assert.equal(srv.s.text, "a\nagent\n");
  assert.deepEqual(mine, { text: "a\nagent\n", version: srv.s.version });
  assert.equal(chain.pending, 0);
});

test("saves go out one after another, each on the version the last one made", async () => {
  const srv = server("a\n");
  let version = 1;
  const chain = saveChain(async (text) => void (version = await srv.put(text, version)), async () => {});
  void chain.push("a\nb\n");
  void chain.push("a\nb\nc\n");
  await chain.push("a\nb\nc\nd\n");
  assert.deepEqual(srv.s, { text: "a\nb\nc\nd\n", version: 4 });
});
