import * as vscode from "vscode";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createDefaultState,
  defaultPacksDir,
  defaultStatePath,
  listPackDirs,
  loadPackManifest,
  readState,
  writeState,
  type PetPackManifest
} from "@cursor-pets/core";

let statusBar: vscode.StatusBarItem | undefined;
let stateWatcher: vscode.FileSystemWatcher | undefined;

async function loadPacksWithDirs(): Promise<Array<{ dir: string; manifest: any }>> {
  const dirs = await listPackDirs();
  const items: Array<{ dir: string; manifest: any }> = [];
  for (const dir of dirs) {
    try {
      items.push({ dir, manifest: await loadPackManifest(dir) });
    } catch {
      // ignore invalid pack
    }
  }
  return items;
}

async function ensureInitialState(ctx: vscode.ExtensionContext) {
  const packsDir = defaultPacksDir();
  await fs.mkdir(packsDir, { recursive: true });
  await ensureBuiltinAsciiPack(packsDir);
  await ensureBundledSpritePacks(ctx, packsDir);
  const state = await readState();
  if (state) return;

  const packs = await loadPacksWithDirs();
  const petId = pickDefaultPetId(packs.map((p) => p.manifest));
  const state0 = createDefaultState(petId);
  const selected = packs.find((p) => p.manifest?.id === petId)?.manifest;
  if (selected?.renderers?.some((r: any) => r.kind === "sprite")) {
    state0.selectedRendererKind = "sprite";
  }
  await writeState(state0);
}

async function ensureBuiltinAsciiPack(packsDir: string) {
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

async function ensureBundledSpritePacks(ctx: vscode.ExtensionContext, userPacksDir: string) {
  const bundledPacksDir = vscode.Uri.joinPath(ctx.extensionUri, "media", "packs");
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(bundledPacksDir);
  } catch {
    return;
  }

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.Directory) continue;
    const srcDir = vscode.Uri.joinPath(bundledPacksDir, name);
    const dstDir = vscode.Uri.file(path.join(userPacksDir, name));
    const dstManifest = vscode.Uri.joinPath(dstDir, "pet.json");
    try {
      await vscode.workspace.fs.stat(dstManifest);
      continue;
    } catch {
      // not installed yet
    }
    await copyDirRecursive(srcDir, dstDir);
  }
}

function pickDefaultPetId(manifests: PetPackManifest[]): string {
  const sprite = manifests.find((m) =>
    m.renderers?.some((r: { kind?: string }) => r.kind === "sprite")
  );
  if (sprite) return sprite.id;
  return manifests[0]?.id ?? "ascii-cat";
}

async function copyDirRecursive(src: vscode.Uri, dst: vscode.Uri) {
  await vscode.workspace.fs.createDirectory(dst);
  const entries = await vscode.workspace.fs.readDirectory(src);
  for (const [name, fileType] of entries) {
    const s = vscode.Uri.joinPath(src, name);
    const d = vscode.Uri.joinPath(dst, name);
    if (fileType === vscode.FileType.Directory) {
      await copyDirRecursive(s, d);
    } else {
      const bytes = await vscode.workspace.fs.readFile(s);
      await vscode.workspace.fs.writeFile(d, bytes);
    }
  }
}

async function refreshStatusBar() {
  if (!statusBar) return;
  const state = await readState();
  if (!state) {
    statusBar.text = "$(heart) Pets";
    statusBar.tooltip = "Cursor Pets — click for menu";
    return;
  }
  const kind = state.selectedRendererKind === "sprite" ? "sprite" : "ascii";
  statusBar.text = `$(heart) ${state.selectedPetId} (${kind})`;
  statusBar.tooltip = `${state.selectedPetId} • ${state.currentState} • ${state.selectedRendererKind}\nClick for menu`;
}

function startStateWatcher() {
  stateWatcher?.dispose();
  const stateFsPath = defaultStatePath();
  const baseDir = path.dirname(stateFsPath);
  const fileName = path.basename(stateFsPath);
  const pattern = new vscode.RelativePattern(baseDir, fileName);
  stateWatcher = vscode.workspace.createFileSystemWatcher(pattern);
  const bump = () => void refreshStatusBar();
  stateWatcher.onDidCreate(bump);
  stateWatcher.onDidChange(bump);
  stateWatcher.onDidDelete(bump);
}

async function selectPetFlow() {
  const packs = await loadPacksWithDirs();
  if (packs.length === 0) {
    void vscode.window.showWarningMessage(
      `No pet packs found. Copy one into: ${defaultPacksDir()}`
    );
    return;
  }

  const pick = await vscode.window.showQuickPick(
    packs.map((p) => {
      const hasSprite = !!p.manifest?.renderers?.some((r: any) => r.kind === "sprite");
      const hasAscii = !!p.manifest?.renderers?.some((r: any) => r.kind === "ascii");
      const badge = hasSprite ? "SPRITE" : hasAscii ? "ASCII" : "PACK";
      return {
        label: `${p.manifest.displayName}`,
        description: p.manifest.id,
        detail: `${badge}${p.manifest.description ? ` • ${p.manifest.description}` : ""}`,
        packId: p.manifest.id,
        preferSprite: hasSprite
      };
    }),
    { title: "Select a pet pack" }
  );

  if (!pick) return;
  const state = (await readState()) ?? createDefaultState(pick.packId);
  state.selectedPetId = pick.packId;
  if (pick.preferSprite) state.selectedRendererKind = "sprite";
  state.lastActivityAt = new Date().toISOString();
  await writeState(state);
  await refreshStatusBar();
}

async function resetState() {
  const packs = await loadPacksWithDirs();
  const petId = pickDefaultPetId(packs.map((p) => p.manifest));
  const state0 = createDefaultState(petId);
  const selected = packs.find((p) => p.manifest?.id === petId)?.manifest;
  if (selected?.renderers?.some((r: any) => r.kind === "sprite")) {
    state0.selectedRendererKind = "sprite";
  }
  await writeState(state0);
  await refreshStatusBar();
}

async function toggleRendererKind() {
  const state = await readState();
  if (!state) return;
  state.selectedRendererKind = state.selectedRendererKind === "ascii" ? "sprite" : "ascii";
  state.lastActivityAt = new Date().toISOString();
  await writeState(state);
  await refreshStatusBar();
}

async function actionsFlow() {
  const packsDir = defaultPacksDir();
  const statePath = defaultStatePath();
  const pick = await vscode.window.showQuickPick(
    [
      { label: "Copy pet packs folder path", id: "copyPacks" },
      { label: "Open state.json", id: "openState" },
      { label: "Copy state.json path", id: "copyState" },
      { label: "Reset state", id: "reset" }
    ],
    { title: "Cursor Pets actions" }
  );
  if (!pick) return;

  if (pick.id === "copyPacks") {
    await vscode.env.clipboard.writeText(packsDir);
    void vscode.window.showInformationMessage("Copied packs folder path to clipboard.");
  } else if (pick.id === "openState") {
    await vscode.window.showTextDocument(vscode.Uri.file(statePath), { preview: false });
  } else if (pick.id === "copyState") {
    await vscode.env.clipboard.writeText(statePath);
    void vscode.window.showInformationMessage("Copied state.json path to clipboard.");
  } else if (pick.id === "reset") {
    await resetState();
  }
}

type GeneratorProvider = "none" | "local-script" | "cursor-sdk" | "external-api";

async function generatePetFlow() {
  const prompt = await vscode.window.showInputBox({
    title: "Generate pet",
    prompt: "Describe your pet (e.g. “sleepy panda with a hoodie”).",
    ignoreFocusOut: true
  });
  if (!prompt) return;

  const style = await vscode.window.showQuickPick(
    [
      { label: "Cute vector (SVG spritesheet)", id: "svg" },
      { label: "Pixel-art (PNG/WebP spritesheet)", id: "pixel" }
    ],
    { title: "Pick a generation style" }
  );
  if (!style) return;

  const provider: GeneratorProvider =
    (process.env.CURSOR_PETS_GENERATOR as GeneratorProvider | undefined) ?? "none";

  const consent = await vscode.window.showWarningMessage(
    `This will generate a new pet pack into your local packs folder.\n\nProvider: ${provider}\nPrompt: ${prompt}\nStyle: ${style.label}\n\nIf the provider uses a network API, it may send your prompt to that service.`,
    { modal: true },
    "Generate",
    "Cancel"
  );
  if (consent !== "Generate") return;

  const packsDir = defaultPacksDir();
  await fs.mkdir(packsDir, { recursive: true });
  const id = `gen-${Date.now()}`;
  const outDir = path.join(packsDir, id);
  await fs.mkdir(outDir, { recursive: true });

  if (provider === "none") {
    const manifest = {
      id,
      displayName: `Generated Pet (${prompt.slice(0, 24)}${prompt.length > 24 ? "…" : ""})`,
      description: `Placeholder. Configure CURSOR_PETS_GENERATOR to enable real generation.`,
      author: "cursor-pets",
      version: "0.1.0",
      renderers: [
        {
          kind: "sprite",
          spritesheet: { path: "spritesheet.svg", mime: "image/svg+xml" },
          atlas: { columns: 4, rows: 1, cellWidth: 64, cellHeight: 64 },
          animation: { states: { idle: { row: 0, frameCount: 4, frameMs: 180 } } }
        }
      ]
    };
    const svg = buildPlaceholderSvg(prompt);
    await fs.writeFile(path.join(outDir, "pet.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    await fs.writeFile(path.join(outDir, "spritesheet.svg"), svg, "utf8");
    void vscode.window.showInformationMessage(
      `Created placeholder pet pack: ${id}. Set CURSOR_PETS_GENERATOR to enable real generation.`
    );
    await refreshStatusBar();
    return;
  }

  void vscode.window.showWarningMessage(
    `Generator provider "${provider}" is not implemented yet. Set CURSOR_PETS_GENERATOR=none for placeholder packs.`
  );
}

function escapeXml(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[c]!));
}

function buildPlaceholderSvg(prompt: string) {
  const label = escapeXml(prompt.slice(0, 18));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="64" viewBox="0 0 256 64">
  <rect width="256" height="64" fill="transparent"/>
  ${[0, 1, 2, 3]
    .map(
      (i) => `
  <g transform="translate(${i * 64},0)">
    <rect x="12" y="12" width="40" height="40" rx="14" fill="#a78bfa" stroke="#111827" stroke-width="2"/>
    <circle cx="26" cy="30" r="3" fill="#111827"/><circle cx="38" cy="30" r="3" fill="#111827"/>
    <path d="M24 40 C 30 ${44 - i}, 34 ${44 - i}, 40 40" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round"/>
    <text x="32" y="60" text-anchor="middle" font-size="9" fill="#111827" font-family="ui-sans-serif,system-ui">${label}</text>
  </g>`
    )
    .join("")}
</svg>`;
}

async function launchFloatingCompanionFromWorkspace() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showWarningMessage(
      "Open a workspace folder that contains this repo (packages/companion)."
    );
    return;
  }
  const companionDir = path.join(folder, "packages", "companion");
  try {
    await fs.access(path.join(companionDir, "package.json"));
  } catch {
    void vscode.window.showWarningMessage(`No packages/companion found under: ${folder}`);
    return;
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCmd, ["run", "start"], {
    cwd: companionDir,
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32"
  });
  child.unref();
  void vscode.window.showInformationMessage(
    "Floating pet launched (sprites + ASCII — no Cursor sidebar bar)."
  );
}

async function quickMenu() {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "$(symbol-color) Select pet…", id: "selectPet" },
      { label: "$(debug-restart) Toggle renderer", id: "toggle" },
      { label: "$(rocket) Open floating pet window", id: "float" },
      { label: "$(wand) Generate pet…", id: "gen" },
      { label: "$(refresh) Reset state", id: "reset" },
      { label: "$(list-flat) Actions…", id: "actions" }
    ],
    { title: "Cursor Pets" }
  );
  if (!pick) return;
  if (pick.id === "selectPet") await selectPetFlow();
  else if (pick.id === "toggle") await toggleRendererKind();
  else if (pick.id === "float") await launchFloatingCompanionFromWorkspace();
  else if (pick.id === "gen") await generatePetFlow();
  else if (pick.id === "reset") await resetState();
  else if (pick.id === "actions") await actionsFlow();
}

export async function activate(context: vscode.ExtensionContext) {
  await ensureInitialState(context);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "cursorPets.quickMenu";
  context.subscriptions.push(statusBar);
  await refreshStatusBar();
  statusBar.show();

  startStateWatcher();
  context.subscriptions.push({ dispose: () => stateWatcher?.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorPets.quickMenu", () => quickMenu()),
    vscode.commands.registerCommand("cursorPets.selectPet", () => selectPetFlow()),
    vscode.commands.registerCommand("cursorPets.toggle", () => quickMenu()),
    vscode.commands.registerCommand("cursorPets.resetState", () => resetState()),
    vscode.commands.registerCommand("cursorPets.actions", () => actionsFlow()),
    vscode.commands.registerCommand("cursorPets.hide", () =>
      vscode.window.showInformationMessage(
        "Sidebar pet view was removed. Use the status bar pet or Command Palette → Cursor Pets."
      )
    ),
    vscode.commands.registerCommand("cursorPets.generatePet", () => generatePetFlow()),
    vscode.commands.registerCommand("cursorPets.openFloatingCompanion", () =>
      launchFloatingCompanionFromWorkspace()
    )
  );
}

export function deactivate() {}
