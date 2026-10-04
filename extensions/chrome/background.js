// The right-click menu: "Save selection to Common Ink" puts the selected text in today's journal
// note, with a link back to the page, and says so on the page.
import { account, captureBody, loadSettings, save } from "./lib.js";

const MENU = "save-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU, title: "Save selection to Common Ink", contexts: ["selection"] });
});

/** A message at the bottom of the page for a few seconds, with a link. Runs in the page, so it uses nothing outside itself. */
function toast(text, linkText, linkUrl) {
  document.getElementById("common-ink-capture-toast")?.remove();
  const box = document.createElement("div");
  box.id = "common-ink-capture-toast";
  box.setAttribute("role", "status");
  box.style.cssText =
    "all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;padding:10px 14px;border-radius:8px;background:#1f2328;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)";
  box.append(text);
  if (linkUrl) {
    const a = document.createElement("a");
    a.href = linkUrl;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = linkText;
    a.style.cssText = "all:initial;margin-left:8px;color:#9cc0ff;font:inherit;text-decoration:underline;cursor:pointer";
    box.append(a);
  }
  document.documentElement.append(box);
  setTimeout(() => box.remove(), 6000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU) return;
  const { server, workspace } = await loadSettings();
  let said;
  try {
    const { workspaces } = await account(server);
    const into = workspaces.find((w) => w.id === workspace) ?? workspaces[0];
    if (!into) throw new Error("You can't edit any workspace with this account.");
    const saved = await save(server, into.id, captureBody({ title: tab?.title, url: info.pageUrl, text: info.selectionText }));
    said = [`Saved to ${saved.title}.`, "Open note", saved.url];
  } catch (e) {
    said = e?.signedOut ? ["You're not signed in to Common Ink.", "Sign in", server] : [`Couldn't save to Common Ink: ${e instanceof Error ? e.message : e}`, "", ""];
  }
  // Where the page can't show it (a PDF, Chrome's own pages), the toolbar button's badge says how it went.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: toast, args: said });
  } catch {
    await chrome.action.setBadgeText({ tabId: tab?.id, text: said[1] === "Open note" ? "✓" : "!" });
  }
});
