// Where the app's static renders (print, exports) get what a note refers to: its API, and the page
// itself for math and diagrams.
import { api, type NoteMeta } from "../api.ts";
import { today } from "../taskChips.ts";
import { mathRenderer } from "../math.ts";
import { drawDiagram, lookOf } from "../diagram.ts";
import { notePath } from "../../../src/core/ids.ts";
import type { StaticSources } from "./static.ts";

/**
 * The app's sources. `doc` is a `.st-doc` on the page, which diagrams take their (light) colors and
 * font from. With `images`, pictures from this workspace are read into the document as data: URLs.
 */
export function appSources(doc: Element, opts: { images?: boolean } = {}): StaticSources {
  let notes: Promise<NoteMeta[]> | null = null;
  const url = (n: { title: string; id: string }) => `${location.origin}${notePath(n.title, n.id)}`;
  return {
    async note(target, from) {
      const path = await api.resolve(target, from);
      if (!path) return null;
      const n = await api.note(path);
      return { path: n.path, title: n.title, content: n.content, url: url(n) };
    },
    async url(target, from) {
      const path = await api.resolve(target, from);
      const meta = path ? (await (notes ??= api.notes())).find((n) => n.path === path) : undefined;
      return meta ? url(meta) : null;
    },
    tasks: (q) => api.tasks({ ...q, today: today() }),
    feed: (q) => api.feed({ ...q, scope: "active" }).then((p) => p.items),
    today: () => api.today(today()),
    math: mathRenderer,
    diagram: (code) => drawDiagram(code, lookOf(doc, false)),
    image: opts.images ? inlineImage : undefined,
  };
}

/** A picture from this site as a data: URL; one from elsewhere keeps its address. */
async function inlineImage(src: string): Promise<string | null> {
  const at = new URL(src, location.href);
  if (at.origin !== location.origin) return null;
  const r = await fetch(at, { credentials: "same-origin" });
  if (!r.ok) return null;
  const blob = await r.blob();
  if (!blob.type.startsWith("image/")) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
