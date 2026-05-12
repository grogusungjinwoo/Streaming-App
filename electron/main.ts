import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ExportPayload = {
  data: ArrayBuffer;
  inputExtension: string;
  suggestedName: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#080b0e",
    title: "Streaming App",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("streaming-app:export-mp4", async (_event, payload: ExportPayload) => {
  const saveResult = await dialog.showSaveDialog({
    title: "Export MP4",
    defaultPath: payload.suggestedName.endsWith(".mp4") ? payload.suggestedName : `${payload.suggestedName}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "streaming-app-"));
  const safeExtension = payload.inputExtension === "mp4" ? "mp4" : "webm";
  const inputPath = path.join(tempDir, `input.${safeExtension}`);

  try {
    await writeFile(inputPath, Buffer.from(payload.data));
    await runFfmpeg(inputPath, saveResult.filePath);
    return { canceled: false, filePath: saveResult.filePath };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = ffmpegInstaller.path;
  const args = [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let errorOutput = "";

    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg export failed with code ${code ?? "unknown"}: ${errorOutput.slice(-1200)}`));
    });
  });
}
