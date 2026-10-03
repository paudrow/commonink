// A note saved by a Windows editor can start with a byte-order mark (U+FEFF) before its `---`.
// Its frontmatter is still its frontmatter: read as properties, and rewritten as one block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatterEntries, scalarOf } from "../src/core/frontmatter.ts";
import { dateOf, splitFrontmatter, titleOf } from "../src/core/parse.ts";
import { frontmatterLines } from "../src/core/prose.ts";
import { openTempVault } from "./helpers.ts";

const JANE = "﻿---\nemail: jane@old.com\ncompany: Acme\n---\n# Jane\n\nMet at the offsite.\n";

test("frontmatter after a byte-order mark is read like any other", () => {
  const { entries, body, had } = frontmatterEntries(JANE);
  assert.equal(had, true);
  assert.equal(scalarOf(entries.find((e) => e.key === "company")), "Acme");
  assert.equal(body, "# Jane\n\nMet at the offsite.\n");
  assert.deepEqual(splitFrontmatter("﻿---\ntitle: Plan\n---\nx\n"), { data: { title: "Plan" }, body: "x\n" });
  assert.equal(titleOf("﻿---\ntitle: Plan\n---\n# Other\n", "md", "a.md"), "Plan");
  assert.equal(dateOf("﻿---\ndate: 2026-01-02\n---\n", "md", "a.md"), "2026-01-02");
  assert.equal(frontmatterLines(JANE), 4);
});

test("a contact whose note starts with a byte-order mark keeps one frontmatter block when edited", () => {
  const { vault } = openTempVault({ "People/Jane.md": JANE });
  const { contact } = vault.contact("Jane");
  assert.deepEqual({ email: contact.email, company: contact.company }, { email: ["jane@old.com"], company: "Acme" });
  vault.updateContact("Jane", { role: "CTO" }, "you");
  const out = vault.read("People/Jane").content;
  assert.equal(out.match(/^---$/gm)?.length, 2, out);
  assert.ok(!out.includes("﻿"), "the mark isn't left stranded in the body");
  assert.match(out, /^---\nemail: jane@old.com\ncompany: Acme\nrole: CTO\n---\n# Jane\n/);
});
