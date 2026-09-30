// A browser-like global environment (jsdom), so web/src modules that sanitize and render can be
// tested in node (a CodeMirror field too). Import this before any web module.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "HTMLIFrameElement", "DOMParser", "DocumentFragment", "CustomEvent", "NodeFilter", "localStorage", "location", "getComputedStyle", "navigator", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "getSelection", "KeyboardEvent", "MouseEvent", "Event", "Range", "Text", "Window"]) {
  if (!(key in g) || key === "navigator") Object.defineProperty(g, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
}
// jsdom lays nothing out; CodeMirror measures text ranges, which then have no boxes.
const range = dom.window.Range.prototype as unknown as { getClientRects(): unknown; getBoundingClientRect(): unknown };
range.getClientRects ??= () => [];
range.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
