// A command's input, checked against its arguments: the schema MCP tools are offered with, and the
// same check for input that arrives as JSON from elsewhere (the hosted CLI route), so nothing reaches
// a command's `run` that its arguments don't allow. No Node imports: hosted workspaces use this too.
import { z } from "zod";
import { UsageError, type ArgSpec, type Command } from "./types.ts";

/** One argument's schema. Over MCP, `mcpRequired` ones are required and CLI-only ones aren't there. */
export function schemaOf(a: ArgSpec, side: "mcp" | "cli" = "mcp"): z.ZodTypeAny {
  let t: z.ZodTypeAny;
  if (a.kind === "number") t = z.number().int().min(a.min ?? Number.MIN_SAFE_INTEGER).max(a.max ?? Number.MAX_SAFE_INTEGER);
  else if (a.kind === "boolean") t = z.boolean();
  else if (a.kind === "strings") t = a.required && !a.allowEmpty ? z.array(z.string()).min(1) : z.array(z.string());
  else if (a.kind === "string") t = a.enum ? z.enum(a.enum as [string, ...string[]]) : z.string();
  else if (a.kind === "pairs") t = z.record(z.string(), z.string());
  else if (a.kind === "files" && side === "cli") t = z.array(z.object({ name: z.string(), bytes: z.instanceof(Uint8Array) }));
  else throw new Error(`An MCP tool can't take a ${a.kind} argument`);
  if (a.nullable) t = t.nullable();
  if (!a.required && !(side === "mcp" && a.mcpRequired)) t = t.optional();
  return a.describe ? t.describe(a.describe) : t;
}

/** A command's arguments on one side, each with its schema. */
export const inputSchema = (c: Command, side: "mcp" | "cli" = "mcp") =>
  Object.fromEntries(Object.entries(c.args).flatMap(([name, a]) => (a.only === (side === "mcp" ? "cli" : "mcp") ? [] : [[name, schemaOf(a, side)]])));

/**
 * `input` as `c`'s arguments allow it on `side` (types, required ones, bounds, allowed values), with
 * anything else left out. Throws a UsageError saying what's wrong.
 */
export function checkInput(c: Command, input: Record<string, unknown>, side: "mcp" | "cli"): Record<string, unknown> {
  const out = z.object(inputSchema(c, side)).safeParse(input);
  if (out.success) return out.data;
  const why = out.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
  throw new UsageError(`${c.cli}: ${why}. See commonink help ${c.cli}`);
}
