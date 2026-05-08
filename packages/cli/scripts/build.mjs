import { build, context } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
await mkdir(path.resolve("dist"), { recursive: true });

const opts = {
  entryPoints: [path.resolve("src/statusline.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  sourcemap: true,
  outfile: path.resolve("dist/statusline.mjs")
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("cli build watching...");
} else {
  await build(opts);
}

