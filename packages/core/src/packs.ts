import fs from "node:fs/promises";
import path from "node:path";
import { defaultPacksDir } from "./paths.js";
import type { PetPackManifest } from "./types.js";

export async function loadPackManifest(packDir: string): Promise<PetPackManifest> {
  const manifestPath = path.join(packDir, "pet.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as PetPackManifest;
}

export async function listPackDirs(packsDir: string = defaultPacksDir()): Promise<string[]> {
  try {
    const entries = await fs.readdir(packsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(packsDir, e.name));
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

export async function listPacks(packsDir: string = defaultPacksDir()): Promise<PetPackManifest[]> {
  const dirs = await listPackDirs(packsDir);
  const packs: PetPackManifest[] = [];
  for (const dir of dirs) {
    try {
      packs.push(await loadPackManifest(dir));
    } catch {
      // ignore invalid packs
    }
  }
  return packs;
}

