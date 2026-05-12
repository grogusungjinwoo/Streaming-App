import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("streamingApp", {
  isDesktop: true,
  exportMp4: (payload: { data: ArrayBuffer; inputExtension: string; suggestedName: string }) =>
    ipcRenderer.invoke("streaming-app:export-mp4", payload)
});

