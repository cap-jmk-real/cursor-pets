import fs from "node:fs/promises";
import path from "node:path";
import { defaultStatePath } from "./paths.js";
import type { PetState } from "./types.js";

export function createDefaultState(petId: string): PetState {
  const now = new Date().toISOString();
  return {
    version: 1,
    selectedPetId: petId,
    selectedRendererKind: "ascii",
    currentState: "idle",
    lastActivityAt: now,
    energy: 100,
    stats: {}
  };
}

export async function readState(statePath: string = defaultStatePath()): Promise<PetState | null> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as PetState;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeState(state: PetState, statePath: string = defaultStatePath()): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

