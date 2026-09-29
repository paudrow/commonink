// A browser-like global environment (jsdom), so web/src modules that sanitize and render can be
// tested in node. Import this before any web module.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const g = globalThis as Record<string, unknown>;
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "HTMLIFrameElement", "DOMParser", "DocumentFragment", "CustomEvent", "localStorage", "location", "getComputedStyle", "navigator"]) {
  if (!(key in g) || key === "navigator") Object.defineProperty(g, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
}
