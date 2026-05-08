import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cursorPets", {
  getSnapshot: () => ipcRenderer.invoke("pet:getSnapshot"),
  onSnapshot: (cb: (snap: any) => void) => {
    const handler = (_: any, snap: any) => cb(snap);
    ipcRenderer.on("pet:snapshot", handler);
    return () => ipcRenderer.off("pet:snapshot", handler);
  }
});

