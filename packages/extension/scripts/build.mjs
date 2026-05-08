import { context } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const outDir = path.resolve("dist");

await mkdir(outDir, { recursive: true });

// Build extension host code as CJS (VS Code expects CommonJS for main)
const ctx = await context({
  entryPoints: [path.resolve("src/extension.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(outDir, "extension.cjs"),
  sourcemap: true,
  external: ["vscode"]
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
}

// Copy extension manifest into dist (for running as a packaged extension later)
try {
  const raw = await readFile(path.resolve("extension.package.json"), "utf8");
  await writeFile(path.join(outDir, "package.json"), raw);
} catch {
  // ignore
}

if (!watch) {
  await ctx.dispose();
}

