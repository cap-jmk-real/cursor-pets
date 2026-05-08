import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function defaultStatePath() {
  return path.join(os.homedir(), ".cursor-pets", "state.json");
}

async function readStdin() {
  return await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}

async function readState() {
  try {
    const raw = await fs.readFile(defaultStatePath(), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(defaultStatePath()), { recursive: true });
  await fs.writeFile(defaultStatePath(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

function inferNextState(input) {
  const hook = String(input?.hook ?? input?.event ?? input?.name ?? "");
  const tool = String(input?.tool ?? input?.tool_name ?? input?.toolName ?? input?.toolType ?? "");
  const command = String(input?.command ?? "");
  const ok =
    input?.success === true ||
    input?.ok === true ||
    input?.status === "success" ||
    input?.error == null;

  const isShell =
    hook.toLowerCase().includes("shell") ||
    tool.toLowerCase().includes("shell") ||
    command.length > 0;

  if (!ok && (hook.toLowerCase().includes("failure") || input?.error)) return "failed";
  if (isShell) return ok ? "ran" : "running";
  if (hook.toLowerCase().includes("pretool")) return "thinking";
  return "idle";
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const state = (await readState()) ?? {
    version: 1,
    selectedPetId: "ascii-cat",
    selectedRendererKind: "ascii",
    currentState: "idle",
    lastActivityAt: new Date().toISOString(),
    energy: 100,
    stats: {}
  };

  state.currentState = inferNextState(input);
  state.lastActivityAt = new Date().toISOString();
  state.stats = state.stats ?? {};
  state.stats.events = (state.stats.events ?? 0) + 1;
  await writeState(state);

  // allow
  process.stdout.write(JSON.stringify({ permission: "allow" }));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ permission: "allow" }));
});

