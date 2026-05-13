import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("streamingApp", {
  isDesktop: true,
  renderMp4: (payload: {
    data: ArrayBuffer;
    inputExtension: string;
    suggestedName: string;
    trimRange: { start: number; end: number };
    frameRate: number;
    videoBitsPerSecond: number;
    voicePatchStrength: number;
    perfectPopStrength: number;
    voiceMastering: {
      mode: "off" | "natural" | "broadcast" | "synthetic-pitch-lock";
      masteringStrength: number;
      pitchLockAmount: number;
      frequencySculptor: {
        rumbleCut: number;
        warmth: number;
        presence: number;
        harshness: number;
        deCrackle: number;
      };
    };
  }) => ipcRenderer.invoke("streaming-app:render-mp4", payload),
  saveMp4: (payload: { data: ArrayBuffer; suggestedName: string }) => ipcRenderer.invoke("streaming-app:save-mp4", payload),
  exportMp4: (payload: { data: ArrayBuffer; inputExtension: string; suggestedName: string }) =>
    ipcRenderer.invoke("streaming-app:export-mp4", payload)
});
