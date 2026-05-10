import { build, context } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
await mkdir(path.resolve("dist"), { recursive: true });

const entries = [
  {
    entryPoints: [path.resolve("src/statusline.ts")],
    outfile: path.resolve("dist/statusline.mjs")
  },
  {
    entryPoints: [path.resolve("src/import-codex.ts")],
    outfile: path.resolve("dist/import-codex.mjs"),
    banner: { js: "#!/usr/bin/env node\n" }
  }
];

const base = {
  bundle: true,
  platform: "node",
  format: "esm",
  sourcemap: true
};

if (watch) {
  await Promise.all(
    entries.map(async (e) => {
      const ctx = await context({ ...base, ...e });
      await ctx.watch();
    })
  );
  console.log("cli build watching...");
} else {
  for (const e of entries) {
    await build({ ...base, ...e });
  }
}

