import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ExportPayload = {
  data: ArrayBuffer;
  inputExtension: string;
  suggestedName: string;
};

type RenderPayload = {
  data: ArrayBuffer;
  inputExtension: string;
  suggestedName: string;
  trimRange: {
    start: number;
    end: number;
  };
  frameRate: number;
  videoBitsPerSecond: number;
  voicePatchStrength: number;
};

type SavePayload = {
  data: ArrayBuffer;
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
    await runFfmpeg(inputPath, saveResult.filePath, {
      trimRange: { start: 0, end: 0 },
      frameRate: 30,
      videoBitsPerSecond: 6_000_000,
      voicePatchStrength: 0.65,
      useTrim: false
    });
    return { canceled: false, filePath: saveResult.filePath };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle("streaming-app:render-mp4", async (_event, payload: RenderPayload) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "streaming-app-"));
  const safeExtension = payload.inputExtension === "mp4" ? "mp4" : "webm";
  const inputPath = path.join(tempDir, `input.${safeExtension}`);
  const outputPath = path.join(tempDir, "review.mp4");

  try {
    await writeFile(inputPath, Buffer.from(payload.data));
    await runFfmpeg(inputPath, outputPath, { ...payload, useTrim: true });
    const output = await readFile(outputPath);
    return {
      data: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
      mimeType: "video/mp4"
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle("streaming-app:save-mp4", async (_event, payload: SavePayload) => {
  const saveResult = await dialog.showSaveDialog({
    title: "Save rendered MP4",
    defaultPath: payload.suggestedName.endsWith(".mp4") ? payload.suggestedName : `${payload.suggestedName}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  await writeFile(saveResult.filePath, Buffer.from(payload.data));
  return { canceled: false, filePath: saveResult.filePath };
});

function runFfmpeg(
  inputPath: string,
  outputPath: string,
  options: {
    trimRange: {
      start: number;
      end: number;
    };
    frameRate: number;
    videoBitsPerSecond: number;
    voicePatchStrength: number;
    useTrim: boolean;
  }
): Promise<void> {
  const ffmpegPath = ffmpegInstaller.path;
  const trimDuration = Math.max(0, options.trimRange.end - options.trimRange.start);
  const args = [
    "-y",
    "-i",
    inputPath
  ];

  if (options.useTrim && trimDuration > 0) {
    args.push("-ss", formatSeconds(options.trimRange.start), "-t", formatSeconds(trimDuration));
  }

  args.push(
    "-r",
    String(options.frameRate),
    "-vf",
    "format=yuv420p",
    "-af",
    buildAudioPatchFilter(options.voicePatchStrength),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    `${Math.round(options.videoBitsPerSecond / 1000)}k`,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath
  );

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

function buildAudioPatchFilter(strength: number): string {
  const safeStrength = Math.max(0, Math.min(strength, 1));
  if (safeStrength <= 0) return "anull";

  const threshold = Math.round(-28 + safeStrength * 10);
  const ratio = (1.8 + safeStrength * 2.6).toFixed(1);
  const noiseFloor = Math.round(-18 - safeStrength * 10);

  return [
    "highpass=f=85",
    "equalizer=f=3200:t=q:w=1.1:g=2.2",
    `afftdn=nf=${noiseFloor}`,
    `acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=8:release=140:makeup=2`,
    "alimiter=limit=0.92"
  ].join(",");
}

function formatSeconds(value: number): string {
  return Number.isFinite(value) ? Math.max(0, value).toFixed(3).replace(/\.?0+$/, "") : "0";
}
