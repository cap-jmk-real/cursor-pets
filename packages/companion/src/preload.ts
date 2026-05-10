import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cursorPets", {
  getSnapshot: () => ipcRenderer.invoke("pet:getSnapshot"),
  listPacks: () => ipcRenderer.invoke("pet:listPacks"),
  selectPet: (petId: string) => ipcRenderer.invoke("pet:selectPet", { petId }),
  toggleRenderer: () => ipcRenderer.invoke("pet:toggleRenderer"),
  resetState: () => ipcRenderer.invoke("pet:resetState"),
  close: () => ipcRenderer.invoke("pet:close"),
  showNativeMenu: (x: number, y: number) =>
    ipcRenderer.invoke("pet:showNativeMenu", { x, y }),
  onSnapshot: (cb: (snap: any) => void) => {
    const handler = (_: any, snap: any) => cb(snap);
    ipcRenderer.on("pet:snapshot", handler);
    return () => ipcRenderer.off("pet:snapshot", handler);
  }
});

