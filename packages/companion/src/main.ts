import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import chokidar from "chokidar";
import {
  defaultPacksDir,
  defaultStatePath,
  listPacks,
  readState
} from "@cursor-pets/core";

let win: BrowserWindow | null = null;

async function computeAsciiFrames(): Promise<{ frames: string[]; frameMs: number; subtitle: string }> {
  const state = await readState();
  const packs = await listPacks();
  if (!state) {
    return { frames: ["(no state)"], frameMs: 500, subtitle: "no-state" };
  }
  const pack = packs.find((p) => p.id === state.selectedPetId);
  const ascii = pack?.renderers?.find((r: any) => r.kind === "ascii") as any | undefined;
  const def = ascii?.states?.[state.currentState] ?? ascii?.states?.idle;
  const frames = def?.frames ?? ["(no frames)"];
  const frameMs = def?.frameMs ?? ascii?.frameMs ?? 250;
  const subtitle = `${state.selectedPetId} • ${state.currentState} • ${state.selectedRendererKind}`;
  return { frames, frameMs, subtitle };
}

async function sendSnapshot() {
  if (!win) return;
  const snap = await computeAsciiFrames();
  win.webContents.send("pet:snapshot", snap);
}

async function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const width = 220;
  const height = 90;
  const x = Math.max(0, primary.workArea.width - width - 20);
  const y = Math.max(0, primary.workArea.height - height - 60);

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
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

ipcMain.handle("pet:getSnapshot", async () => computeAsciiFrames());

app.whenReady().then(async () => {
  await createWindow();
});

app.on("window-all-closed", () => {
  // Keep running on macOS style; on Windows/Linux quit.
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

