// The npm package's CLI: src/cli.ts and everything it imports in one file, so `npx commonink`
// needs nothing installed but Node. Build with `npm run build:cli`; `npm pack ./cli` makes the package.
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  build: {
    ssr: "src/cli.ts",
    outDir: "cli/dist",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: "quire.mjs",
        codeSplitting: false,
        banner: "#!/usr/bin/env -S node --disable-warning=ExperimentalWarning",
      },
    },
  },
  ssr: { noExternal: true, target: "node" },
  define: {
    "process.env.QUIRE_BUNDLED": JSON.stringify("1"),
    "process.env.QUIRE_CLI_VERSION": JSON.stringify(pkg.version),
  },
});
