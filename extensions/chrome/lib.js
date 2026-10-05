// What the popup, the right-click menu and the options page share. Nothing here keeps a note: a
// capture goes straight to the Common Ink server, and the only things stored are settings.

export const DEFAULT_SERVER = "https://commonink.app";

/** The origin of a Common Ink server someone typed, or null: https, or http on this computer. */
export function serverOrigin(input) {
  const typed = String(input ?? "").trim();
  if (!typed) return DEFAULT_SERVER;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  return url.origin;
}

/** The host permission that lets the extension reach `origin` (a match pattern has no port). */
export function hostPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

/** The person's day, YYYY-MM-DD: which journal note is today's. */
export function localDate(d = new Date()) {
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The most of a page's HTML that's sent (the server takes twice this). */
export const MAX_HTML = 1_000_000;

/**
 * What a capture sends: the page's title and address, its content (`html`, a page) or the selected
 * text (`text`), the person's day, and the folder for a new note (none: today's journal note).
 */
export function captureBody({ title, url, html, text, folder }, now = new Date()) {
  const body = { today: localDate(now), title: String(title ?? "").trim(), url: String(url ?? "") };
  const selected = String(text ?? "").trim();
  if (selected) body.text = selected;
  else body.html = String(html ?? "").slice(0, MAX_HTML);
  if (!selected && !body.html.trim()) throw new Error("There's nothing to save on this page.");
  const into = String(folder ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (into) body.folder = into;
  return body;
}

/** The folders notes are in, each with the folders above it, in order. */
export function foldersOf(notes) {
  const out = new Set();
  for (const { path } of notes) {
    const parts = String(path).split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Not signed in to Common Ink in this browser. */
export class SignedOut extends Error {
  constructor() {
    super("You're not signed in to Common Ink.");
    this.signedOut = true;
  }
}

/** One call to the server's API, as the person signed in to it in this browser (their session cookie). */
export async function api(server, path, init = {}, fetchFn = fetch) {
  let res;
  try {
    res = await fetchFn(`${server}${path}`, { credentials: "include", ...init });
  } catch {
    throw new Error(`Couldn't reach ${new URL(server).host}.`);
  }
  if (res.status === 401) throw new SignedOut();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Common Ink answered ${res.status}.`);
  return data;
}

/** Who's signed in, and the workspaces they can write to (their own first). */
export async function account(server, fetchFn = fetch) {
  const me = await api(server, "/api/me", {}, fetchFn);
  return { user: me.user, workspaces: (me.workspaces ?? []).filter((w) => w.role !== "viewer") };
}

/** The folders of a workspace. */
export async function folders(server, workspace, fetchFn = fetch) {
  return foldersOf(await api(server, `/api/w/${workspace}/notes`, {}, fetchFn));
}

/** Save a capture (see captureBody). Resolves to the note it went to, and its address in the app. */
export async function save(server, workspace, body, fetchFn = fetch) {
  const saved = await api(
    server,
    `/api/w/${workspace}/capture`,
    { method: "POST", headers: { "Content-Type": "application/json", "X-Common-Ink-Capture": "1" }, body: JSON.stringify(body) },
    fetchFn,
  );
  return { path: saved.path, title: saved.title, url: `${server}${saved.href}` };
}

/** The settings: which server, and which workspace captures go to. */
export async function loadSettings(storage = chrome.storage.sync) {
  const { server, workspace } = await storage.get({ server: DEFAULT_SERVER, workspace: "" });
  return { server: serverOrigin(server) ?? DEFAULT_SERVER, workspace };
}

/**
 * The page's title, address and readable content, as HTML for the server to turn into markdown.
 * Runs in the page (chrome.scripting.executeScript), so it uses nothing outside itself. The content
 * is the article or main part when the page marks one, without its navigation, forms and scripts.
 */
export function pageContent() {
  const length = (el) => (el.textContent ?? "").trim().length;
  const marked = [...document.querySelectorAll("article, main, [role='main']")].sort((a, b) => length(b) - length(a))[0];
  const whole = !marked || length(marked) < 200;
  const root = (whole ? document.body : marked).cloneNode(true);
  const skip = "script, style, noscript, template, nav, aside, footer, form, button, input, select, textarea, iframe, object, embed, svg, canvas, video, audio, img, picture, dialog, [hidden], [aria-hidden='true']";
  for (const el of root.querySelectorAll(whole ? `${skip}, header` : skip)) el.remove();
  // Links are kept, pointing where they point from this page.
  for (const a of root.querySelectorAll("a[href]")) {
    if (/^https?:$/.test(a.protocol)) a.setAttribute("href", a.href);
    else a.removeAttribute("href");
  }
  return { title: document.title, url: location.href, html: root.innerHTML };
}
