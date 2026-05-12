import { describe, expect, it } from "vitest";
import { canDownloadRenderedMp4, createReviewRenderState, markReviewRenderReady, markReviewRenderStale } from "./reviewState";

describe("reviewState", () => {
  it("allows download only when the latest MP4 render is ready", () => {
    const ready = markReviewRenderReady(createReviewRenderState(), new Blob(["mp4"], { type: "video/mp4" }));

    expect(canDownloadRenderedMp4(ready)).toBe(true);
    expect(canDownloadRenderedMp4(markReviewRenderStale(ready))).toBe(false);
  });
});
