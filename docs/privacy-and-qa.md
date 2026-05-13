# Privacy And QA Notes

## Local-Only Checks

- No feature uploads camera, microphone, blobs, thumbnails, filenames, or markers.
- No analytics package or runtime CDN dependency is included.
- Web downloads use object URLs and revoke them after use.
- Browser MP4 review uses bundled FFmpeg.wasm assets and local object URLs.
- Electron MP4 review/export uses local temporary files and bundled FFmpeg.
- Camera and microphone tracks are stopped after recording.
- Device Native microphone capture does not request app audio cleanup constraints and its MP4 review skips app voice mastering, FFmpeg audio filters, and forced sample-rate conversion.

## Browser Codec Checks

- Codec choice is based on `MediaRecorder.isTypeSupported()`.
- MP4 is preferred when supported for capture.
- WebM fallback is labeled during capture, then rendered into MP4 before download.
- Unsupported `MediaRecorder` states surface an error instead of starting a broken recording.

## AutoPatch And Review Checks

- AutoPatch strength can be set to 0 for a raw path or raised for broadcast polish.
- Stop should create a previewable MP4 before download/save is enabled.
- Changing trim or AutoPatch after render should mark the MP4 stale and require rerender.
- Render progress should be announced with live status text and progressbar semantics.
- The camera stage should preserve 16:9 video without stretching in live preview or MP4 review.
- Device Native should record from the selected/default microphone as-is, then still produce an MP4 review without app audio cleanup or mastering.

## Manual QA Matrix

- Chrome or Edge: preview, choose 60 FPS, record, pause, resume, stop, wait for MP4 render, revise trim/AutoPatch, rerender, download MP4.
- Firefox: verify WebM capture fallback is rendered to MP4 before download.
- Safari where available: verify native MP4 capture still goes through the MP4 review flow.
- Electron on Windows: record, render MP4, preview the rendered file, save MP4, play the file, repeat while offline.
- Device Native: select the mic profile, enable preview, record, stop, verify the review/export succeeds and voice polish controls do not affect that recording.
