import { build, context } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
await mkdir(path.resolve("dist"), { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  sourcemap: true,
  format: "cjs",
  external: ["electron"]
};

if (watch) {
  const mainCtx = await context({
    ...common,
    entryPoints: [path.resolve("src/main.ts")],
    outfile: path.resolve("dist/main.cjs")
  });
  const preloadCtx = await context({
    ...common,
    entryPoints: [path.resolve("src/preload.ts")],
    outfile: path.resolve("dist/preload.cjs")
  });
  await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
  console.log("companion build watching...");
} else {
  await build({
    ...common,
    entryPoints: [path.resolve("src/main.ts")],
    outfile: path.resolve("dist/main.cjs")
  });
  await build({
    ...common,
    entryPoints: [path.resolve("src/preload.ts")],
    outfile: path.resolve("dist/preload.cjs")
  });
}

