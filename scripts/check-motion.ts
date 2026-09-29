// npm run check:motion: move the cursor down and back up through notes of consecutive block widgets
// (code blocks, diagrams, embeds, and whatever else draws a block) in Google Chrome, with vim's j/k
// and with the arrow keys, and fail if a step skips a line. Entering a block shows its source, so
// every line is one step from the next. Needs playwright-core and Chrome (like bench:web).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Notes with blocks one after another, each separated by a blank line or by nothing at all. */
export const MOTION_NOTES: Record<string, string> = {
  "Code.md": "# Code\n\nTop\n\n```js\none()\n```\n\n```py\ntwo()\n```\n\n```sh\nthree\n```\n\nBottom",
  "Code tight.md": "# Code tight\n\nTop\n```js\none()\n```\n```py\ntwo()\n```\nBottom",
  "Mermaid.md": "# Mermaid\n\nTop\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nflowchart LR\n  C --> D\n```\n\nBottom",
  "Embeds.md": "# Embeds\n\nTop\n\n![[Code]]\n\n![[Mermaid]]\n\nBottom",
  "Math.md": "# Math\n\nTop\n\n$$\na\n$$\n\n$$\nb\n$$\n\n$$\nc\n$$\n\nBottom",
  "Math tight.md": "# Math tight\n\nTop\n\n$$\na\n$$\n$$\nb\n$$\n$$\nc\n$$\n\nBottom",
  "Math under text.md": "# Math under text\n\nTop\n$$\na\n$$\n$$\nb\n$$\nBottom",
};

function playwright(): any {
  const candidates = [process.env.PLAYWRIGHT_CORE, "playwright-core"];
  const npx = path.join(os.homedir(), ".npm/_npx");
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) candidates.push(path.join(npx, d, "node_modules/playwright-core"));
  for (const c of candidates) {
    if (!c) continue;
    try {
      return createRequire(import.meta.url)(c);
    } catch {}
  }
  throw new Error("playwright-core not found: set PLAYWRIGHT_CORE, or run `npx playwright-core --version` once");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-motion-"));
for (const [f, t] of Object.entries(MOTION_NOTES)) fs.writeFileSync(path.join(dir, f), `${t}\n`);
const port = 5300 + Math.floor(Math.random() * 400);
const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/server/main.ts"], {
  cwd: ROOT,
  env: { ...process.env, QUIRE_VAULT: dir, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise<void>((r) => server.stdout.on("data", (d: Buffer) => d.toString().includes("localhost:") && r()));
const browser = await playwright().chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const failures: string[] = [];
try {
  const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const ids = new Map<string, string>((await (await fetch(`http://localhost:${port}/api/notes`)).json()).map((n: { path: string; id: string }) => [n.path, n.id]));
  const line = async () => Number((await p.locator("#cursor-pos").textContent())!.match(/Ln (\d+)/)![1]);
  for (const note of Object.keys(MOTION_NOTES)) {
    const lines = MOTION_NOTES[note].split("\n").length;
    for (const [mode, down, up] of [["vim", "j", "k"], ["arrows", "ArrowDown", "ArrowUp"]]) {
      await p.goto(`http://localhost:${port}/notes/x-${ids.get(note)}`);
      await p.locator("#editor-host .cm-content").waitFor();
      await p.waitForTimeout(1200); // widgets drawn and measured
      await p.locator("#editor-host .cm-line").first().click();
      await p.keyboard.press("Escape");
      await p.keyboard.type("gg");
      if (mode === "arrows") await p.keyboard.press("i"); // insert mode: the arrows as in any editor
      const trail = [await line()];
      for (let i = 1; i < lines; i++) {
        await p.keyboard.press(down);
        await p.waitForTimeout(40);
        trail.push(await line());
      }
      for (let i = 1; i < lines; i++) {
        await p.keyboard.press(up);
        await p.waitForTimeout(40);
        trail.push(await line());
      }
      await p.keyboard.press("Escape");
      const want = [...Array(lines).keys()].map((i) => i + 1);
      const expected = [...want, ...want.slice(0, -1).reverse()].join(" ");
      const ok = trail.join(" ") === expected;
      console.log(`${ok ? "ok  " : "FAIL"} ${note.padEnd(14)} ${mode.padEnd(6)} ${trail.join(" ")}`);
      if (!ok) failures.push(`${note} (${mode}): ${trail.join(" ")}, expected ${expected}`);
    }
  }
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
  process.exit(1);
}
