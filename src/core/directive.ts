// Directives: one-line widgets (`::timer{duration=25m}`) and the `{…}` args of block containers
// (`:::kanban{done="Shipped"}`), in the CommonMark "generic directives" syntax as used by
// remark-directive. No Node imports: the editor uses this too.

export interface Directive {
  name: string;
  args: Record<string, string>;
}

const DIRECTIVE = /^\s*::([a-z][\w-]*)(?:\{([^}\n]*)\})?\s*$/i;

export function parseDirective(line: string): Directive | null {
  const m = line.match(DIRECTIVE);
  return m ? { name: m[1].toLowerCase(), args: parseAttrs(m[2] ?? "") } : null;
}

/**
 * `key=value` pairs; a key can also compare (`due<=today`), and then the operator starts its value
 * ("<=today"). A key that compares twice is a range: `due>=today due<=+7d` is ">=today <=+7d".
 */
export function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([\w-]+)(?:(<=|>=|<|>|=)(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) {
    const value = m[3] ?? m[4] ?? m[5];
    const had = out[m[1]];
    if (value === undefined) out[m[1]] = "true";
    else if (m[2] === "=") out[m[1]] = value;
    else out[m[1]] = had !== undefined && RANGE.test(had) ? `${had} ${m[2]}${value}` : `${m[2]}${value}`;
  }
  return out;
}

/** Args that compare (`due<=today`), and so are written with their operator. Any other value is just a value. */
const COMPARES = new Set(["due", "start", "done"]);
/** One or more comparisons, like "<=today" or ">=today <=+7d". */
const RANGE = /^(?:<=|>=|<|>)\S+(?:\s+(?:<=|>=|<|>)\S+)*$/;

export function serializeDirective({ name, args }: Directive): string {
  const attrs = serializeAttrs(args);
  return attrs ? `::${name}{${attrs}}` : `::${name}`;
}

/** Args as `key=value` pairs (the part between the braces), `id` last; empty if there are none. */
export function serializeAttrs(args: Record<string, string>): string {
  const keys = [...Object.keys(args).filter((k) => k !== "id"), ...("id" in args ? ["id"] : [])];
  const parts = keys
    .filter((k) => args[k] !== undefined && args[k] !== "")
    .map((k) => {
      // A range goes back as one comparison each: `due>=today due<=+7d`.
      if (COMPARES.has(k) && RANGE.test(args[k]) && /\s/.test(args[k])) return args[k].split(/\s+/).map((c) => serializeAttrs({ [k]: c })).join(" ");
      const op = COMPARES.has(k) ? args[k].match(/^(<=|>=|<|>)\s*/) : null;
      const value = op ? args[k].slice(op[0].length) : args[k];
      return `${k}${op ? op[1] : "="}${/^[\w.:/+-]+$/.test(value) ? value : `"${value.replace(/"/g, "'")}"`}`;
    });
  return parts.join(" ");
}
