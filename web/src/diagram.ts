// ```mermaid diagrams, drawn in the app's own palette: the editor's widget and print and exports
// (export/static.ts) use this. Mermaid loads on first use and runs in strict mode with no HTML labels,
// and the SVG it draws goes through DOMPurify before it reaches the page.
import DOMPurify from "dompurify";

let mermaid: Promise<(typeof import("mermaid"))["default"]> | null = null;
let seq = 0;

/** Where a diagram takes its colors and font: the page's own (the editor), or a light document's (print). */
export interface DiagramLook {
  /** A color token's value (`--bg`…) where the diagram will show. */
  color(name: string): string;
  dark: boolean;
  font: string;
}

/** The look of an element's surroundings: its color tokens, the theme and the font. */
export function lookOf(node: Element, dark: boolean): DiagramLook {
  const css = getComputedStyle(node);
  return { color: (name) => css.getPropertyValue(name).trim(), dark, font: css.fontFamily };
}

// Mermaid keeps one configuration, so drawings take turns.
let queue: Promise<unknown> = Promise.resolve();

/** A diagram as sanitized SVG. Rejects with Mermaid's message when the code doesn't parse. */
export function drawDiagram(code: string, look: DiagramLook): Promise<string> {
  const run = queue.then(async () => {
    mermaid ??= import("mermaid").then((m) => m.default);
    const m = await mermaid;
    const v = look.color;
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // What a diagram's own `%%{init}%%` or frontmatter can't change: Mermaid's own list, and the
      // look. Its themeCSS lands in the page, where it could pin the SVG over the app or load a URL.
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "themeCSS", "themeVariables", "fontFamily", "altFontFamily", "darkMode", "theme"],
      htmlLabels: false,
      flowchart: { htmlLabels: false, curve: "basis" },
      // Drawn in the app's own palette, so diagrams look native in light and dark.
      theme: "base",
      darkMode: look.dark,
      fontFamily: look.font,
      themeVariables: {
        fontSize: "14px",
        background: v("--bg-elev"),
        primaryColor: v("--bg"),
        primaryBorderColor: v("--accent"),
        primaryTextColor: v("--ink-strong"),
        secondaryColor: v("--code-bg"),
        tertiaryColor: v("--bg-side"),
        lineColor: v("--muted"),
        textColor: v("--ink-2"),
        edgeLabelBackground: v("--bg-elev"),
        clusterBkg: v("--bg-side"),
        clusterBorder: v("--line-strong"),
        noteBkgColor: v("--code-bg"),
        noteTextColor: v("--ink"),
        actorBkg: v("--bg"),
        actorBorder: v("--accent"),
        actorTextColor: v("--ink-strong"),
        signalColor: v("--ink-2"),
      },
    });
    const { svg } = await m.render(`qd-${++seq}`, code);
    return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
  });
  queue = run.catch(() => {});
  return run;
}
