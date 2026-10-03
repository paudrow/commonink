import { test } from "node:test";
import assert from "node:assert/strict";
import { checkup } from "../src/core/checkup.ts";
import { openTempVault } from "./helpers.ts";

// Links that find a note, or don't, in every way resolve() knows: by path, by name from anywhere,
// relative to the folder, another case or Unicode form, a heading, an alias, an asset, an ID.
const NFD = "Café";
const files = {
  "Hub.md": [
    "# Hub",
    "",
    "[[Plan]] [[plan]] [[PLAN#Goals]] [[Plan|the plan]] [[Projects/Plan]] [[projects/plan.md]]",
    "[[Deep]] [[Projects/Sub/Deep]] [[Sub/Deep]] [[Nowhere]] [[nowhere#x]] [[#Heading]]",
    "![[photo.png]] ![[Images/Photo.PNG]] ![[missing.png]] [[report.pdf]] [[Café]] [[café]]",
    "[link](Projects/Plan.md) [link](projects/plan.md#Goals) [gone](Gone.md) [cal](/calendar/2026-10-01)",
    "[[Projects]] [[Plan.md]] [[Folder/]] [[ ]] [[../Outside]] [[.hidden/Secret]]",
  ].join("\n"),
  "Projects/Plan.md": "# Plan\n\n## Goals\n\n[[Sub/Deep]] [[Deep]] [[../Hub]] [[Hub]] [[Sibling]] [[sibling]] [[Missing Here]]\n",
  "Projects/Sibling.md": "# Sibling\n\n[[Plan]] [[Plan#Goals|g]] [[photo.png]] [[Images/photo.png]] [[Nowhere]]\n",
  "Projects/Sub/Deep.md": "# Deep\n\n[[Plan]] [[Projects/Plan]] [[Hub]] [[Deep]] [[Gone]]\n",
  "Other/Plan.md": "# Other plan\n\n[[Plan]] [[Deep]] [[Sibling]] [[Gone]]\n",
  "Images/photo.png": "png",
  "report.pdf": "pdf",
  [`${NFD}.md`]: "# Café\n\n[[Café]] [[CAFÉ]] [[Hub]]\n",
  "Loose.md": "# Loose\n\nNothing points here. [[Nowhere]]\n",
};

/** Every answer the memo gives must be what resolving each link on its own gives. */
function compare(vault: ReturnType<typeof openTempVault>["vault"]) {
  const v = vault as unknown as { resolver: () => (t: string, f: string) => string | null };
  const memo = { missing: vault.missingLinks({ scope: "all" }), checkup: checkup(vault, "me", "2026-10-02") };
  const resolver = v.resolver;
  v.resolver = () => (t, f) => vault.resolve(t, f);
  try {
    const plain = { missing: vault.missingLinks({ scope: "all" }), checkup: checkup(vault, "me", "2026-10-02") };
    assert.equal(JSON.stringify(memo), JSON.stringify(plain));
    return memo;
  } finally {
    v.resolver = resolver;
  }
}

test("finding missing links answers just as resolving each link would", () => {
  const { vault } = openTempVault(files);
  const memo = compare(vault);
  assert.ok(memo.missing.length > 3);
  assert.ok(memo.missing.some((m) => m.target === "Nowhere"));
});

test("finding missing links asks the index, not the disk, about notes it has", () => {
  const { vault } = openTempVault(files);
  let stats = 0;
  const stat = vault.files.stat.bind(vault.files);
  (vault.files as { stat: typeof stat }).stat = (rel) => (stats++, stat(rel));
  vault.missingLinks({ scope: "all" });
  // Only links spelled in another case or Unicode form than the note ask the disk (75 stats without the index).
  assert.ok(stats <= 13, `${stats} stats`);
});

test("on a disk that ignores case and Unicode form, missing links still answer as resolving each link would", () => {
  const { vault } = openTempVault(files);
  // A Mac's disk, more or less: any spelling of a file's name finds it.
  const fold = (p: string) => p.normalize("NFC").toLowerCase();
  const stat = vault.files.stat.bind(vault.files);
  const real = new Map(vault.files.list().map((f) => [fold(f.path), f.path]));
  (vault.files as { stat: typeof stat }).stat = (rel) => stat(real.get(fold(rel)) ?? rel);
  const memo = compare(vault);
  assert.ok(!memo.missing.some((m) => m.target === "projects/plan.md"));
});
