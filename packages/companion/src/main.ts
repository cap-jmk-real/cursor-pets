import { app, BrowserWindow, ipcMain, Menu, screen } from "electron";
import path from "node:path";
import chokidar from "chokidar";
import {
  createDefaultState,
  defaultPacksDir,
  defaultStatePath,
  listPackDirs,
  listPacks,
  loadPackManifest,
  readState,
  writeState,
  type PetPackManifest,
  type PetStandardState,
  type SpriteRendererDef,
  type SpriteStateDef
} from "@cursor-pets/core";
import fs from "node:fs/promises";
import fsSync from "node:fs";

let win: BrowserWindow | null = null;

(() => {
  const userDataOverride = process.env.CURSOR_PETS_USERDATA;
  const cacheOverride = process.env.CURSOR_PETS_CACHE;
  try {
    if (userDataOverride) {
      fsSync.mkdirSync(userDataOverride, { recursive: true });
      app.setPath("userData", userDataOverride);
    }
    if (cacheOverride) {
      fsSync.mkdirSync(cacheOverride, { recursive: true });
      try {
        app.setPath("cache", cacheOverride);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
})();

export type AsciiPetSnapshot = {
  mode: "ascii";
  frames: string[];
  frameMs: number;
  subtitle: string;
};

export type SpritePetSnapshot = {
  mode: "sprite";
  imageDataUrl: string;
  mime: string;
  pixelated: boolean;
  atlas: { columns: number; rows: number; cellWidth: number; cellHeight: number };
  row: number;
  frameCount: number;
  frameMs: number;
  subtitle: string;
};

export type PetSnapshot = AsciiPetSnapshot | SpritePetSnapshot;

function pickDefaultPetId(packs: PetPackManifest[]): string {
  const sprite = packs.find((p) => p.renderers?.some((r) => r.kind === "sprite"));
  if (sprite) return sprite.id;
  return packs[0]?.id ?? "ascii-cat";
}

async function findPackDir(petId: string): Promise<string | null> {
  const dirs = await listPackDirs();
  for (const dir of dirs) {
    try {
      const m = await loadPackManifest(dir);
      if (m.id === petId) return dir;
    } catch {
      // ignore
    }
  }
  return null;
}

function resolveSpriteTiming(
  sprite: SpriteRendererDef,
  stateName: PetStandardState
): { row: number; frameCount: number; frameMs: number } {
  const atlas = sprite.atlas;
  const anim = sprite.animation;
  const states = anim?.states ?? {};
  const def: SpriteStateDef =
    states[stateName] ??
    states.idle ??
    ({
      row: 0,
      frameCount: atlas.columns,
      frameMs: 200
    } as SpriteStateDef);
  const frameCount = def.frameCount ?? atlas.columns;
  const frameMs = def.frameMs ?? 200;
  return { row: def.row, frameCount: Math.max(1, frameCount), frameMs };
}

async function readSpritesheetDataUrl(
  packDir: string,
  sheet: SpriteRendererDef["spritesheet"]
): Promise<{ dataUrl: string; mime: string; pixelated: boolean }> {
  const abs = path.join(packDir, sheet.path);
  const buf = await fs.readFile(abs);
  const mime = sheet.mime ?? "application/octet-stream";
  const pixelated =
    mime === "image/png" || mime === "image/webp" || /\.png$/i.test(sheet.path);
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  return { dataUrl, mime, pixelated };
}

async function computeAsciiSnapshot(): Promise<AsciiPetSnapshot> {
  const state = await readState();
  const packs = await listPacks();
  if (!state) {
    return { mode: "ascii", frames: ["(no state)"], frameMs: 500, subtitle: "no-state" };
  }
  const pack = packs.find((p) => p.id === state.selectedPetId);
  const ascii = pack?.renderers?.find((r) => r.kind === "ascii") as any | undefined;
  const def = ascii?.states?.[state.currentState] ?? ascii?.states?.idle;
  const frames = def?.frames ?? ["(no frames)"];
  const frameMs = def?.frameMs ?? ascii?.frameMs ?? 250;
  const subtitle = `${state.selectedPetId} • ${state.currentState} • ${state.selectedRendererKind}`;
  return { mode: "ascii", frames, frameMs, subtitle };
}

async function computeSpriteSnapshot(
  state: NonNullable<Awaited<ReturnType<typeof readState>>>,
  packDir: string,
  sprite: SpriteRendererDef
): Promise<SpritePetSnapshot | null> {
  try {
    const { dataUrl, mime, pixelated } = await readSpritesheetDataUrl(packDir, sprite.spritesheet);
    const timing = resolveSpriteTiming(sprite, state.currentState);
    const subtitle = `${state.selectedPetId} • ${state.currentState} • sprite`;
    return {
      mode: "sprite",
      imageDataUrl: dataUrl,
      mime,
      pixelated,
      atlas: {
        columns: sprite.atlas.columns,
        rows: sprite.atlas.rows,
        cellWidth: sprite.atlas.cellWidth,
        cellHeight: sprite.atlas.cellHeight
      },
      row: timing.row,
      frameCount: timing.frameCount,
      frameMs: timing.frameMs,
      subtitle
    };
  } catch {
    return null;
  }
}

async function computePetSnapshot(): Promise<PetSnapshot> {
  const state = await readState();
  const packs = await listPacks();
  if (!state) {
    return { mode: "ascii", frames: ["(no state)"], frameMs: 500, subtitle: "no-state" };
  }

  const pack = packs.find((p) => p.id === state.selectedPetId);
  const wantsSprite = state.selectedRendererKind === "sprite";
  const spriteRenderer = pack?.renderers?.find((r) => r.kind === "sprite") as
    | SpriteRendererDef
    | undefined;

  if (wantsSprite && spriteRenderer) {
    const dir = await findPackDir(state.selectedPetId);
    if (dir) {
      const sp = await computeSpriteSnapshot(state, dir, spriteRenderer);
      if (sp) return sp;
    }
  }

  return computeAsciiSnapshot();
}

async function ensureBundledSpritePacks() {
  const bundledRoot = path.resolve(__dirname, "../media/packs");
  const userPacks = defaultPacksDir();
  await fs.mkdir(userPacks, { recursive: true });
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(bundledRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    const dst = path.join(userPacks, name);
    const dstManifest = path.join(dst, "pet.json");
    try {
      await fs.readFile(dstManifest, "utf8");
      continue;
    } catch {
      // install
    }
    await fs.cp(path.join(bundledRoot, name), dst, { recursive: true });
  }
}

async function ensureStateExists() {
  await ensureBundledSpritePacks();
  await ensureBuiltinAsciiPack();
  const packs = await listPacks();
  const petId = pickDefaultPetId(packs);
  const existing = await readState();
  if (existing) return existing;
  const s = createDefaultState(petId);
  const chosen = packs.find((p) => p.id === petId);
  if (chosen?.renderers?.some((r) => r.kind === "sprite")) {
    s.selectedRendererKind = "sprite";
  }
  await writeState(s);
  return s;
}

async function ensureBuiltinAsciiPack() {
  const packsDir = defaultPacksDir();
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
    description: "Built-in fallback pack (companion).",
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

async function sendSnapshot() {
  if (!win) return;
  const snap = await computePetSnapshot();
  win.webContents.send("pet:snapshot", snap);
}

async function applyPetId(petId: string) {
  const state = await ensureStateExists();
  state.selectedPetId = petId;
  const packs = await listPacks();
  const pack = packs.find((p) => p.id === petId);
  if (pack?.renderers?.some((r) => r.kind === "sprite")) {
    state.selectedRendererKind = "sprite";
  } else {
    state.selectedRendererKind = "ascii";
  }
  state.lastActivityAt = new Date().toISOString();
  await writeState(state);
  await sendSnapshot();
}

async function resetCompanionState() {
  const packs = await listPacks();
  const petId = pickDefaultPetId(packs);
  const s = createDefaultState(petId);
  if (packs.find((p) => p.id === petId)?.renderers?.some((r) => r.kind === "sprite")) {
    s.selectedRendererKind = "sprite";
  }
  await writeState(s);
  await sendSnapshot();
}

function companionBoundsPath() {
  return path.join(app.getPath("userData"), "companion-window.json");
}

function loadSavedBounds(): Electron.Rectangle | null {
  try {
    const raw = fsSync.readFileSync(companionBoundsPath(), "utf8");
    const b = JSON.parse(raw) as Electron.Rectangle;
    if (typeof b.x === "number" && typeof b.y === "number" && b.width >= 200 && b.height >= 100) {
      return b;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveWindowBounds(w: BrowserWindow) {
  try {
    fsSync.writeFileSync(companionBoundsPath(), JSON.stringify(w.getBounds()), "utf8");
  } catch {
    // ignore
  }
}

async function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const defaultW = 400;
  const defaultH = 220;
  const saved = loadSavedBounds();
  let width = saved?.width ?? defaultW;
  let height = saved?.height ?? defaultH;
  let x =
    saved?.x ?? Math.max(0, primary.workArea.x + primary.workArea.width - width - 24);
  let y =
    saved?.y ?? Math.max(0, primary.workArea.y + primary.workArea.height - height - 48);

  const wa = primary.workArea;
  width = Math.min(width, wa.width);
  height = Math.min(height, wa.height);
  x = Math.min(Math.max(wa.x, x), wa.x + wa.width - width);
  y = Math.min(Math.max(wa.y, y), wa.y + wa.height - height);

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 280,
    minHeight: 140,
    frame: false,
    transparent: true,
    resizable: true,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.resolve(__dirname, "../dist/preload.cjs")
    }
  });

  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true);
  win.setSkipTaskbar(true);

  win.on("moved", () => {
    if (win) saveWindowBounds(win);
  });
  win.on("resized", () => {
    if (win) saveWindowBounds(win);
  });

  win.show();
  win.focus();

  win.loadFile(path.resolve(__dirname, "../renderer/index.html"));

  win.on("closed", () => {
    win = null;
  });

  await sendSnapshot();

  const watcher = chokidar.watch([defaultStatePath(), defaultPacksDir()], {
    ignoreInitial: true
  });
  watcher.on("all", () => sendSnapshot().catch(() => {}));
  win.on("closed", () => watcher.close().catch(() => {}));
}

ipcMain.handle("pet:getSnapshot", async () => computePetSnapshot());
ipcMain.handle("pet:listPacks", async () => {
  const packs = await listPacks();
  return packs.map((p) => ({ id: p.id, displayName: p.displayName }));
});

ipcMain.handle("pet:selectPet", async (_evt, args: { petId: string }) => {
  await applyPetId(args.petId);
  return true;
});

ipcMain.handle("pet:toggleRenderer", async () => {
  const state = await ensureStateExists();
  state.selectedRendererKind = state.selectedRendererKind === "ascii" ? "sprite" : "ascii";
  state.lastActivityAt = new Date().toISOString();
  await writeState(state);
  await sendSnapshot();
  return true;
});

ipcMain.handle("pet:resetState", async () => {
  await resetCompanionState();
  return true;
});

ipcMain.handle("pet:close", async () => {
  win?.close();
  return true;
});

ipcMain.handle(
  "pet:showNativeMenu",
  async (event, point: { x: number; y: number }) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) return;
    const packs = await listPacks();
    const petItems: Electron.MenuItemConstructorOptions[] =
      packs.length > 0
        ? packs.map((p) => ({
            label: `${p.displayName}  (${p.id})`,
            click: () => {
              void applyPetId(p.id);
            }
          }))
        : [{ label: "No packs — add folders under ~/.cursor-pets/packs", enabled: false }];

    const template: Electron.MenuItemConstructorOptions[] = [
      { label: "Switch pet", submenu: petItems },
      { type: "separator" },
      {
        label: "Toggle renderer",
        click: () => {
          void (async () => {
            const state = await ensureStateExists();
            state.selectedRendererKind =
              state.selectedRendererKind === "ascii" ? "sprite" : "ascii";
            state.lastActivityAt = new Date().toISOString();
            await writeState(state);
            await sendSnapshot();
          })();
        }
      },
      {
        label: "Reset state",
        click: () => {
          void resetCompanionState();
        }
      },
      { type: "separator" },
      {
        label: "Always on top",
        type: "checkbox",
        checked: w.isAlwaysOnTop(),
        click: (item) => {
          w.setAlwaysOnTop(item.checked);
        }
      },
      { type: "separator" },
      {
        label: "Close window",
        click: () => w.close()
      },
      {
        label: "Quit companion",
        click: () => app.quit()
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: w,
      x: Math.round(point.x),
      y: Math.round(point.y)
    });
  }
);

app.whenReady().then(async () => {
  await ensureStateExists();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
