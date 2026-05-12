import { describe, expect, it, vi } from "vitest";
import { buildExportFileName, canUseDesktopSaver, downloadRecording, saveRenderedMp4 } from "./exportService";

describe("buildExportFileName", () => {
  it("uses the selected codec extension instead of pretending every file is mp4", () => {
    const name = buildExportFileName("studio test", "webm", new Date("2026-05-12T18:30:00Z"));

    expect(name).toBe("studio-test-2026-05-12-183000.webm");
  });

  it("normalizes blank titles to streaming-app", () => {
    const name = buildExportFileName("   ", "mp4", new Date("2026-05-12T18:30:00Z"));

    expect(name).toBe("streaming-app-2026-05-12-183000.mp4");
  });
});

describe("canUseDesktopSaver", () => {
  it("detects the Electron preload bridge", () => {
    expect(canUseDesktopSaver({ streamingApp: { saveMp4: vi.fn() } })).toBe(true);
    expect(canUseDesktopSaver({})).toBe(false);
  });
});

describe("downloadRecording", () => {
  it("creates and revokes an object URL for web downloads", () => {
    const appendChild = vi.spyOn(document.body, "appendChild");
    const anchor = document.createElement("a");
    const remove = vi.spyOn(anchor, "remove").mockImplementation(() => undefined);
    const click = vi.spyOn(anchor, "click").mockImplementation(() => undefined);
    const createElement = vi.spyOn(document, "createElement").mockReturnValue(anchor);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    downloadRecording(new Blob(["sample"]), "clip.webm");

    expect(createElement).toHaveBeenCalledWith("a");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});

describe("saveRenderedMp4", () => {
  it("saves rendered MP4 bytes through the desktop bridge", async () => {
    const saveMp4 = vi.fn().mockResolvedValue({ canceled: false, filePath: "C:\\recording.mp4" });
    const blob = new Blob(["mp4"], { type: "video/mp4" });

    const result = await saveRenderedMp4(blob, "review.mp4", {
      streamingApp: { saveMp4, isDesktop: true }
    } as unknown as Window);

    expect(result).toEqual({ canceled: false, filePath: "C:\\recording.mp4" });
    expect(saveMp4).toHaveBeenCalledWith({
      data: await blob.arrayBuffer(),
      suggestedName: "review.mp4"
    });
  });
});
