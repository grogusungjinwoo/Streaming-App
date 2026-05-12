export type ReviewRenderStatus = "idle" | "rendering" | "ready" | "stale" | "error";

export type ReviewRenderState = {
  status: ReviewRenderStatus;
  renderedBlob?: Blob | null;
  renderedObjectUrl?: string;
  error?: string;
  message?: string;
  progress?: number;
  version?: number;
};

export function createReviewRenderState(): ReviewRenderState {
  return {
    status: "idle",
    renderedBlob: null,
    renderedObjectUrl: "",
    error: "",
    message: "",
    progress: 0,
    version: 0
  };
}

export function markReviewRenderRendering(state: ReviewRenderState): ReviewRenderState {
  return {
    ...state,
    status: "rendering",
    error: "",
    progress: 0
  };
}

export function markReviewRenderReady(
  state: ReviewRenderState,
  renderedBlob: Blob,
  renderedObjectUrl = state.renderedObjectUrl
): ReviewRenderState {
  return {
    ...state,
    status: "ready",
    renderedBlob,
    renderedObjectUrl,
    error: "",
    message: "",
    progress: 1,
    version: (state.version ?? 0) + 1
  };
}

export function markReviewRenderStale(state: ReviewRenderState): ReviewRenderState {
  return {
    ...state,
    status: "stale"
  };
}

export function markReviewRenderError(state: ReviewRenderState, error: unknown): ReviewRenderState {
  return {
    ...state,
    status: "error",
    error: error instanceof Error ? error.message : "MP4 render failed."
  };
}

export function clearReviewRenderState(state: ReviewRenderState): ReviewRenderState {
  if (state.renderedObjectUrl) {
    URL.revokeObjectURL(state.renderedObjectUrl);
  }

  return createReviewRenderState();
}

export function canDownloadRenderedMp4(state: ReviewRenderState): boolean {
  return state.status === "ready" && state.renderedBlob?.type === "video/mp4";
}
