// The popup: save the page in this tab, or what's selected in it, to today's journal note or a
// new note in a folder.
import { account, captureBody, folders, hostPattern, loadSettings, pageContent, save } from "./lib.js";

const $ = (id) => document.getElementById(id);
const status = $("status");

/** Say something, with a link after it if there's one to offer. */
function say(text, link) {
  status.textContent = text;
  if (!link) return;
  const a = document.createElement("a");
  a.textContent = link.text;
  a.href = link.url;
  a.addEventListener("click", (e) => {
    e.preventDefault();
    if (link.run) return void link.run();
    chrome.tabs.create({ url: link.url });
  });
  status.append(" ", a);
}

const { server, workspace: lastWorkspace } = await loadSettings();
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
$("page").textContent = tab?.title ?? "";
$("options").addEventListener("click", (e) => (e.preventDefault(), chrome.runtime.openOptionsPage()));

/** Run `func` in the tab's page; null where Chrome doesn't let extensions in (its own pages, the store). */
async function inPage(func) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
    return result;
  } catch {
    return null;
  }
}

async function listFolders() {
  const where = $("where");
  where.length = 1;
  for (const f of await folders(server, $("workspace").value)) where.add(new Option(f, f));
}

async function capture(button, read) {
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  say("Saving…");
  try {
    const got = await read();
    if (!got) throw new Error("Chrome doesn't let extensions read this page.");
    const saved = await save(server, $("workspace").value, captureBody({ ...got, folder: $("where").value }));
    say(`Saved to ${saved.title}.`, { text: "Open note", url: saved.url });
  } catch (e) {
    problem(e);
  } finally {
    $("save-page").disabled = false;
    $("save-selection").disabled = !selection;
    button.focus();
  }
}

function problem(e) {
  if (e?.signedOut) return say("You're not signed in to Common Ink.", { text: "Open Common Ink to sign in", url: server });
  say(e instanceof Error ? e.message : String(e));
}

let selection = "";

async function start() {
  const { user, workspaces } = await account(server);
  if (!workspaces.length) return say("You can't edit any workspace with this account.");
  $("who").textContent = `${user.email} · ${new URL(server).host}`;
  for (const w of workspaces) $("workspace").add(new Option(w.name, w.id));
  if (workspaces.some((w) => w.id === lastWorkspace)) $("workspace").value = lastWorkspace;
  $("workspace-row").hidden = workspaces.length < 2;
  $("workspace").addEventListener("change", () => {
    chrome.storage.sync.set({ workspace: $("workspace").value });
    listFolders().catch(problem);
  });
  $("capture").hidden = false;
  selection = ((await inPage(() => String(getSelection()))) ?? "").trim();
  $("save-selection").disabled = !selection;
  $("save-page").addEventListener("click", (e) => capture(e.target, () => inPage(pageContent)));
  $("save-selection").addEventListener("click", (e) => capture(e.target, async () => ({ title: tab.title, url: tab.url, text: selection })));
  $("save-page").focus();
  await listFolders();
}

// Another server than commonink.app is reached only once the person allows it (asked for on a click).
const origins = [hostPattern(server)];
if (await chrome.permissions.contains({ origins })) start().catch(problem);
else {
  say(`Common Ink Capture needs your OK to reach ${new URL(server).host}.`, {
    text: "Allow",
    url: server,
    run: async () => {
      if (!(await chrome.permissions.request({ origins }))) return;
      say("");
      start().catch(problem);
    },
  });
}
