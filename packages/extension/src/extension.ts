import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createDefaultState,
  defaultPacksDir,
  defaultStatePath,
  listPackDirs,
  loadPackManifest,
  readState,
  writeState
} from "@cursor-pets/core";

class CursorPetsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "cursorPets.view";
  private view?: vscode.WebviewView;
  private stateWatcher?: vscode.FileSystemWatcher;
  private readonly ctx: vscode.ExtensionContext;

  constructor(ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
  }

  dispose() {
    this.stateWatcher?.dispose();
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === "ready") {
        await ensureInitialState(this.ctx);
        await this.postSnapshot();
      }
      if (msg?.type === "selectPet") {
        await selectPetFlow();
        await this.postSnapshot();
      }
      if (msg?.type === "actions") {
        await actionsFlow();
        await this.postSnapshot();
      }
      if (msg?.type === "reset") {
        await resetState();
        await this.postSnapshot();
      }
      if (msg?.type === "toggleRenderer") {
        await toggleRendererKind();
        await this.postSnapshot();
      }
      if (msg?.type === "hide") {
        await hideSidebar();
      }
    });

    this.startWatchingState();
  }

  private startWatchingState() {
    this.stateWatcher?.dispose();
    const stateFsPath = defaultStatePath();
    const baseDir = path.dirname(stateFsPath);
    const fileName = path.basename(stateFsPath);
    const pattern = new vscode.RelativePattern(baseDir, fileName);
    this.stateWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    const refresh = () => this.postSnapshot().catch(() => {});
    this.stateWatcher.onDidCreate(refresh);
    this.stateWatcher.onDidChange(refresh);
    this.stateWatcher.onDidDelete(refresh);
  }

  private async postSnapshot() {
    if (!this.view) return;
    const state = await readState();
    const packs = await loadPacksWithDirs();
    const sprite = await buildSpritePayload(state, packs);
    this.view.webview.postMessage({
      type: "snapshot",
      state,
      packs: packs.map((p) => p.manifest),
      sprite
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cursor Pets</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 10px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; }
      .card { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 12px; padding: 10px; }
      .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
      .pet { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 18px; padding: 10px 8px; border-radius: 10px; background: color-mix(in srgb, currentColor 6%, transparent); white-space: pre; overflow: hidden; text-overflow: ellipsis; }
      button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 8px; background: color-mix(in srgb, currentColor 10%, transparent); border: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
      button:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
      select { width: 100%; padding: 6px 8px; border-radius: 8px; background: transparent; color: inherit; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
      .muted { opacity: 0.7; font-size: 12px; }
      .ctx-menu {
        position: fixed;
        z-index: 9999;
        min-width: 160px;
        padding: 4px;
        border-radius: 8px;
        background: var(--vscode-menu-background, #2b2b2b);
        color: var(--vscode-menu-foreground, inherit);
        border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        display: none;
        font-size: 13px;
        user-select: none;
      }
      .ctx-menu.open { display: block; }
      .ctx-item {
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
      }
      .ctx-item:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
      .ctx-sep { height: 1px; margin: 4px 2px; background: color-mix(in srgb, currentColor 20%, transparent); }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="row">
        <button id="btnSelect">Select</button>
        <div class="muted" id="subtitle">Loading…</div>
      </div>
      <div style="height:8px"></div>
      <canvas id="sprite" width="128" height="128" style="display:none;width:100%;height:128px;border-radius:10px;background: color-mix(in srgb, currentColor 6%, transparent);"></canvas>
      <div class="pet" id="pet">(loading)</div>
      <div style="height:8px"></div>
      <div class="row">
        <button id="btnToggleRenderer">Toggle renderer</button>
        <button id="btnReset">Reset</button>
      </div>
    </div>

    <div id="ctxMenu" class="ctx-menu" role="menu" aria-hidden="true">
      <div class="ctx-item" data-action="actions" role="menuitem">Actions…</div>
      <div class="ctx-item" data-action="toggleRenderer" role="menuitem">Toggle renderer</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-action="reset" role="menuitem">Reset</div>
      <div class="ctx-item" data-action="hide" role="menuitem">Hide</div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const elPet = document.getElementById('pet');
      const elSprite = document.getElementById('sprite');
      const elSubtitle = document.getElementById('subtitle');

      let snapshot = { state: null, packs: [], sprite: null };
      let frame = 0;
      let timer = null;

      function getAsciiFrames() {
        const state = snapshot.state;
        const packs = snapshot.packs || [];
        if (!state) return ['(no state)'];
        const pack = packs.find(p => p.id === state.selectedPetId);
        const ascii = (pack?.renderers || []).find(r => r.kind === 'ascii');
        const def = ascii?.states?.[state.currentState] || ascii?.states?.idle;
        const frames = def?.frames || ['(no frames)'];
        return frames;
      }

      function getFrameMs() {
        const state = snapshot.state;
        const packs = snapshot.packs || [];
        if (!state) return 400;
        if (state.selectedRendererKind === 'sprite' && snapshot.sprite?.frameMs) return snapshot.sprite.frameMs;
        const pack = packs.find(p => p.id === state.selectedPetId);
        const ascii = (pack?.renderers || []).find(r => r.kind === 'ascii');
        const def = ascii?.states?.[state.currentState] || ascii?.states?.idle;
        return def?.frameMs || ascii?.frameMs || 250;
      }

      let spriteImg = null;

      function renderSpriteOnce() {
        const s = snapshot.state;
        const sp = snapshot.sprite;
        if (!s || !sp) return;
        if (!spriteImg || spriteImg.src !== sp.dataUrl) {
          spriteImg = new Image();
          spriteImg.src = sp.dataUrl;
        }
        const atlas = sp.atlas;
        const ctx = elSprite.getContext('2d');
        if (!ctx) return;
        const idx = Math.floor(Date.now() / sp.frameMs) % Math.max(1, sp.frameCount);
        const sx = idx * atlas.cellWidth;
        const sy = sp.row * atlas.cellHeight;
        ctx.clearRect(0, 0, elSprite.width, elSprite.height);
        // scale to fit
        const scale = Math.min(elSprite.width / atlas.cellWidth, elSprite.height / atlas.cellHeight);
        const dw = atlas.cellWidth * scale;
        const dh = atlas.cellHeight * scale;
        const dx = (elSprite.width - dw) / 2;
        const dy = (elSprite.height - dh) / 2;
        spriteImg.onload = () => {};
        try {
          ctx.drawImage(spriteImg, sx, sy, atlas.cellWidth, atlas.cellHeight, dx, dy, dw, dh);
        } catch {}
      }

      function renderOnce() {
        const s = snapshot.state;
        elSubtitle.textContent = s
          ? \`\${s.selectedPetId} • \${s.currentState} • \${s.selectedRendererKind}\`
          : 'No state yet';

        if (s?.selectedRendererKind === 'sprite' && snapshot.sprite) {
          elSprite.style.display = 'block';
          elPet.style.display = 'none';
          renderSpriteOnce();
          return;
        }

        elSprite.style.display = 'none';
        elPet.style.display = 'block';
        const frames = getAsciiFrames();
        const f = frames[frame % frames.length];
        elPet.textContent = f;
        frame = (frame + 1) % 1000000;
      }

      function restart() {
        if (timer) clearInterval(timer);
        frame = 0;
        renderOnce();
        timer = setInterval(renderOnce, getFrameMs());
      }

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg?.type === 'snapshot') {
          snapshot = { state: msg.state, packs: msg.packs || [], sprite: msg.sprite || null };
          restart();
        }
      });

      document.getElementById('btnSelect').addEventListener('click', () => vscode.postMessage({ type: 'selectPet' }));
      document.getElementById('btnReset').addEventListener('click', () => vscode.postMessage({ type: 'reset' }));
      document.getElementById('btnToggleRenderer').addEventListener('click', () => vscode.postMessage({ type: 'toggleRenderer' }));
      elPet.addEventListener('click', () => vscode.postMessage({ type: 'actions' }));
      elSprite.addEventListener('click', () => vscode.postMessage({ type: 'actions' }));

      const elCtxMenu = document.getElementById('ctxMenu');

      function openCtxMenu(x, y) {
        elCtxMenu.style.left = '0px';
        elCtxMenu.style.top = '0px';
        elCtxMenu.classList.add('open');
        elCtxMenu.setAttribute('aria-hidden', 'false');
        const rect = elCtxMenu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const px = Math.max(4, Math.min(x, vw - rect.width - 4));
        const py = Math.max(4, Math.min(y, vh - rect.height - 4));
        elCtxMenu.style.left = px + 'px';
        elCtxMenu.style.top = py + 'px';
      }

      function closeCtxMenu() {
        elCtxMenu.classList.remove('open');
        elCtxMenu.setAttribute('aria-hidden', 'true');
      }

      function onContextMenu(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openCtxMenu(ev.clientX, ev.clientY);
      }

      elPet.addEventListener('contextmenu', onContextMenu);
      elSprite.addEventListener('contextmenu', onContextMenu);

      elCtxMenu.addEventListener('click', (ev) => {
        const target = ev.target instanceof Element ? ev.target.closest('.ctx-item') : null;
        if (!target) return;
        const action = target.getAttribute('data-action');
        closeCtxMenu();
        if (!action) return;
        vscode.postMessage({ type: action });
      });

      window.addEventListener('click', (ev) => {
        if (!elCtxMenu.classList.contains('open')) return;
        if (ev.target instanceof Node && elCtxMenu.contains(ev.target)) return;
        closeCtxMenu();
      });
      window.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') closeCtxMenu();
      });
      window.addEventListener('blur', closeCtxMenu);
      window.addEventListener('resize', closeCtxMenu);
      window.addEventListener('scroll', closeCtxMenu, true);

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}

async function ensureInitialState(ctx: vscode.ExtensionContext) {
  const packsDir = defaultPacksDir();
  await fs.mkdir(packsDir, { recursive: true });
  await ensureBuiltinAsciiPack(packsDir);
  await ensureBundledSpritePacks(ctx, packsDir);
  const state = await readState();
  if (state) return;

  const packs = await loadPacksWithDirs();
  const petId = packs[0]?.manifest?.id ?? "ascii-cat";
  const state0 = createDefaultState(petId);
  const selected = packs.find((p) => p.manifest?.id === petId)?.manifest;
  if (selected?.renderers?.some((r: any) => r.kind === "sprite")) {
    state0.selectedRendererKind = "sprite";
  }
  await writeState(state0);
}

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

async function buildSpritePayload(
  state: any,
  packs: Array<{ dir: string; manifest: any }>
): Promise<
  | null
  | {
      dataUrl: string;
      atlas: any;
      frameMs: number;
      row: number;
      frameCount: number;
    }
> {
  if (!state) return null;
  if (state.selectedRendererKind !== "sprite") return null;

  const pack = packs.find((p) => p.manifest?.id === state.selectedPetId);
  const sprite = pack?.manifest?.renderers?.find((r: any) => r.kind === "sprite");
  if (!pack || !sprite) return null;

  const sheetPath = path.join(pack.dir, sprite.spritesheet?.path ?? "");
  const raw = await fs.readFile(sheetPath);
  const mime = sprite.spritesheet?.mime ?? "image/png";
  const dataUrl = `data:${mime};base64,${raw.toString("base64")}`;

  const anim = sprite.animation?.states?.[state.currentState] ?? sprite.animation?.states?.idle;
  const atlas = sprite.atlas;
  const frameCount = anim?.frameCount ?? atlas?.columns ?? 1;
  const frameMs = anim?.frameMs ?? 200;
  const row = anim?.row ?? 0;

  return { dataUrl, atlas, frameMs, row, frameCount };
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
}

async function resetState() {
  const packs = await loadPacksWithDirs();
  const petId = packs[0]?.manifest?.id ?? "ascii-cat";
  const state0 = createDefaultState(petId);
  const selected = packs.find((p) => p.manifest?.id === petId)?.manifest;
  if (selected?.renderers?.some((r: any) => r.kind === "sprite")) {
    state0.selectedRendererKind = "sprite";
  }
  await writeState(state0);
}

async function toggleRendererKind() {
  const state = await readState();
  if (!state) return;
  state.selectedRendererKind = state.selectedRendererKind === "ascii" ? "sprite" : "ascii";
  state.lastActivityAt = new Date().toISOString();
  await writeState(state);
}

async function hideSidebar() {
  // Prefer toggling sidebar visibility; this is a safe, built-in VS Code command.
  try {
    await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
  } catch {
    try {
      await vscode.commands.executeCommand("workbench.action.closeSidebar");
    } catch {
      // ignore: the host did not expose either command
    }
  }
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

  // Pluggable provider selection (default = none).
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
    // Stub: create a placeholder pack so the flow is end-to-end without network calls.
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
  ${[0,1,2,3].map((i) => `
  <g transform="translate(${i * 64},0)">
    <rect x="12" y="12" width="40" height="40" rx="14" fill="#a78bfa" stroke="#111827" stroke-width="2"/>
    <circle cx="26" cy="30" r="3" fill="#111827"/><circle cx="38" cy="30" r="3" fill="#111827"/>
    <path d="M24 40 C 30 ${44 - i}, 34 ${44 - i}, 40 40" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round"/>
    <text x="32" y="60" text-anchor="middle" font-size="9" fill="#111827" font-family="ui-sans-serif,system-ui">${label}</text>
  </g>`).join("")}
</svg>`;
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new CursorPetsViewProvider(context);
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CursorPetsViewProvider.viewId, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorPets.selectPet", () => selectPetFlow()),
    vscode.commands.registerCommand("cursorPets.toggle", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.cursorPets.container");
    }),
    vscode.commands.registerCommand("cursorPets.resetState", () => resetState()),
    vscode.commands.registerCommand("cursorPets.actions", () => actionsFlow()),
    vscode.commands.registerCommand("cursorPets.hide", () => hideSidebar()),
    vscode.commands.registerCommand("cursorPets.generatePet", () => generatePetFlow())
  );
}

export function deactivate() {}

