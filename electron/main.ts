import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySmoothVocalMastering,
  applySyntheticPitchLock,
  buildVoiceMasteringFilter,
  decodePcm16Wav,
  encodePcm16Wav,
  type VoiceMasteringFilterProfile,
  type VoiceMasteringSettings,
  type VoiceRenderDiagnostics
} from "./audioMastering.js";

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
  perfectPopStrength: number;
  audioProcessingMode: AudioProcessingMode;
  voiceMastering: VoiceMasteringSettings;
};

type SavePayload = {
  data: ArrayBuffer;
  suggestedName: string;
};

type AudioProcessingMode = "mastered" | "native";

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
      perfectPopStrength: 0.75,
      audioProcessingMode: "mastered",
      voiceMastering: {
        mode: "broadcast",
        masteringStrength: 0.78,
        pitchLockAmount: 0,
        frequencySculptor: { rumbleCut: 0.65, warmth: 0.45, presence: 0.5, harshness: 0.45, deCrackle: 0.65 },
        voiceCleanup: {
          highPassHz: 90,
          gateThresholdDb: -38,
          gateStrength: 0.72,
          deEssAmount: 0.65,
          transientSmoothing: 0.45,
          vocalLeveling: 0.72
        },
        pitchCorrection: {
          strength: 0.35,
          smoothing: 0.72,
          correctionSpeed: 0.5,
          maxCentsPerSecond: 600,
          targetMode: "speech-smooth",
          scaleKey: "C",
          scaleType: "major"
        }
      },
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
  const extractedAudioPath = path.join(tempDir, "voice-source.wav");
  const masteredAudioPath = path.join(tempDir, "voice-mastered.wav");
  let diagnostics: VoiceRenderDiagnostics | undefined;
  let audioInputPath: string | undefined;

  try {
    await writeFile(inputPath, Buffer.from(payload.data));
    if (
      payload.audioProcessingMode === "mastered" &&
      (payload.voiceMastering.mode === "synthetic-pitch-lock" || payload.voiceMastering.mode === "smooth-vocal")
    ) {
      await extractAudioWav(inputPath, extractedAudioPath);
      const decoded = decodePcm16Wav(await readFile(extractedAudioPath));
      const mastered =
        payload.voiceMastering.mode === "smooth-vocal"
          ? applySmoothVocalMastering(decoded.samples, decoded.sampleRate, payload.voiceMastering)
          : applySyntheticPitchLock(decoded.samples, decoded.sampleRate, payload.voiceMastering);
      await writeFile(masteredAudioPath, Buffer.from(encodePcm16Wav(mastered.samples, decoded.sampleRate)));
      diagnostics = mastered.diagnostics;
      audioInputPath = masteredAudioPath;
    }
    const filterProfile = await runFfmpeg(inputPath, outputPath, { ...payload, audioInputPath, useTrim: true });
    if (diagnostics && filterProfile === "compatible") {
      diagnostics = { ...diagnostics, appliedFilterProfile: `${diagnostics.appliedFilterProfile}-compatible` };
    }
    const output = await readFile(outputPath);
    return {
      data: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
      mimeType: "video/mp4",
      diagnostics
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
    perfectPopStrength: number;
    audioProcessingMode: AudioProcessingMode;
    voiceMastering: VoiceMasteringSettings;
    audioInputPath?: string;
    useTrim: boolean;
  }
): Promise<VoiceMasteringFilterProfile> {
  const ffmpegPath = ffmpegInstaller.path;
  const advancedArgs = buildFfmpegProcessArgs(inputPath, outputPath, options, "advanced");

  return spawnFfmpeg(ffmpegPath, advancedArgs)
    .then(() => "advanced" as const)
    .catch((error: Error) => {
      if (options.audioProcessingMode === "native" || options.voiceMastering.mode === "off" || !shouldRetryWithCompatibleFilter(error)) {
        throw error;
      }
      return spawnFfmpeg(ffmpegPath, buildFfmpegProcessArgs(inputPath, outputPath, options, "compatible")).then(
        () => "compatible" as const
      );
    });
}

function buildFfmpegProcessArgs(
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
    perfectPopStrength: number;
    audioProcessingMode: AudioProcessingMode;
    voiceMastering: VoiceMasteringSettings;
    audioInputPath?: string;
    useTrim: boolean;
  },
  voiceFilterProfile: VoiceMasteringFilterProfile
): string[] {
  const trimDuration = Math.max(0, options.trimRange.end - options.trimRange.start);
  const args = [
    "-y",
    "-i",
    inputPath
  ];

  if (options.audioInputPath) {
    args.push("-i", options.audioInputPath);
  }

  if (options.useTrim && trimDuration > 0) {
    args.push("-ss", formatSeconds(options.trimRange.start), "-t", formatSeconds(trimDuration));
  }

  args.push(
    "-r",
    String(options.frameRate),
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    `${Math.round(options.videoBitsPerSecond / 1000)}k`,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
  );

  if (options.audioProcessingMode === "mastered") {
    args.push("-af", buildVoiceMasteringFilter(options.voiceMastering, voiceFilterProfile), "-ar", "48000");
  }

  if (options.audioInputPath) {
    args.push("-map", "0:v:0?", "-map", "1:a:0", "-shortest");
  }

  args.push(
    "-movflags",
    "+faststart",
    outputPath
  );

  return args;
}

function spawnFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
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

function shouldRetryWithCompatibleFilter(error: Error): boolean {
  return /No such filter|Error initializing filter|Failed to inject frame|Invalid argument/i.test(error.message);
}

function formatSeconds(value: number): string {
  return Number.isFinite(value) ? Math.max(0, value).toFixed(3).replace(/\.?0+$/, "") : "0";
}

function extractAudioWav(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = ffmpegInstaller.path;
  const args = ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", outputPath];

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

      reject(new Error(`FFmpeg audio extraction failed with code ${code ?? "unknown"}: ${errorOutput.slice(-1200)}`));
    });
  });
}
