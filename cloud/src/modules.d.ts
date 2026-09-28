// Seed notes are bundled as text (see "rules" in wrangler.jsonc).
declare module "*.md" {
  const text: string;
  export default text;
}
declare module "*.svg" {
  const text: string;
  export default text;
}
