import os from "node:os";
import path from "node:path";

export function defaultPetsHomeDir(): string {
  return path.join(os.homedir(), ".cursor-pets");
}

export function defaultStatePath(): string {
  return path.join(defaultPetsHomeDir(), "state.json");
}

export function defaultEventsPath(): string {
  return path.join(defaultPetsHomeDir(), "events.ndjson");
}

export function defaultPacksDir(): string {
  return path.join(defaultPetsHomeDir(), "packs");
}

