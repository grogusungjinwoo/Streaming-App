# Privacy And QA Notes

## Local-Only Checks

- No feature uploads camera, microphone, blobs, thumbnails, filenames, or markers.
- No analytics package or runtime CDN dependency is included.
- Web downloads use object URLs and revoke them after use.
- Electron MP4 export uses local temporary files and bundled FFmpeg.
- Camera and microphone tracks are stopped after recording.

## Browser Codec Checks

- Codec choice is based on `MediaRecorder.isTypeSupported()`.
- MP4 is preferred when supported.
- WebM fallback is labeled honestly and downloaded with `.webm`.
- Unsupported `MediaRecorder` states surface an error instead of starting a broken recording.

## Manual QA Matrix

- Chrome or Edge: preview, record, pause, resume, stop, marker, download.
- Firefox: verify WebM fallback and correct extension.
- Safari where available: verify native MP4 support behavior.
- Electron on Windows: record, export MP4, play the file, repeat while offline.

