import fs from "node:fs/promises";
import path from "node:path";
import {
  createDefaultState,
  defaultPacksDir,
  defaultStatePath,
  listPacks,
  readState,
  writeState
} from "@cursor-pets/core";

async function readStdin(): Promise<string> {
  return await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}

function dim(s: string) {
  return `\u001b[90m${s}\u001b[0m`;
}

async function ensureBuiltinPack(packsDir: string) {
  const builtinDir = path.join(packsDir, "ascii-cat");
  const manifestPath = path.join(builtinDir, "pet.json");
  try {
    await fs.readFile(manifestPath, "utf8");
    return;
  } catch {
    // continue
  }
  await fs.mkdir(builtinDir, { recursive: true });
  const manifest = {
    id: "ascii-cat",
    displayName: "ASCII Cat",
    description: "A tiny built-in ASCII cat for Cursor Pets.",
    author: "cursor-pets",
    version: "0.1.0",
    renderers: [
      {
        kind: "ascii",
        frameMs: 250,
        states: {
          idle: { frames: ["(=^.^=)", "(=^o^=)", "(=^.^=)"] },
          thinking: { frames: ["(=^.^=) ...", "(=^.^=)  ..", "(=^.^=)   ."] },
          running: { frames: ["ᓚᘏᗢ___", "ᓚᘏᗢ__ ", "ᓚᘏᗢ_  "], frameMs: 120 },
          failed: { frames: ["(=x.x=)", "(=X.X=)"], frameMs: 400 }
        }
      }
    ]
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

async function ensureInitialState() {
  const packsDir = defaultPacksDir();
  await fs.mkdir(packsDir, { recursive: true });
  await ensureBuiltinPack(packsDir);

  const existing = await readState();
  if (existing) return existing;

  const packs = await listPacks();
  const petId = packs[0]?.id ?? "ascii-cat";
  const state = createDefaultState(petId);
  await writeState(state);
  return state;
}

async function main() {
  // Cursor CLI passes a JSON payload; we currently only need it to exist.
  await readStdin().catch(() => "");

  const state = await ensureInitialState();
  const packs = await listPacks();

  const pack = packs.find((p) => p.id === state.selectedPetId);
  const ascii: any = pack?.renderers?.find((r: any) => r.kind === "ascii");
  const def = ascii?.states?.[state.currentState] ?? ascii?.states?.idle;
  const frames: string[] = def?.frames ?? ["(no frames)"];
  const frameMs: number = def?.frameMs ?? ascii?.frameMs ?? 250;
  const idx = Math.floor(Date.now() / frameMs) % frames.length;
  const frame = frames[idx] ?? frames[0] ?? "(no frame)";

  process.stdout.write(`${frame} ${dim(`${state.selectedPetId} ${state.currentState}`)}`);
}

main().catch((err) => {
  // Fail silently (statusline should not be noisy)
  process.stdout.write("");
  process.exitCode = 0;
});

