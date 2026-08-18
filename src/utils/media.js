// A gear_photos.storage_path can now point at a video (see 2026-08-18
// migration widening the bucket's allowed_mime_types) — this is the one
// place that decides "photo or video" so every thumbnail/lightbox agrees.
const VIDEO_EXT_RE = /\.(mp4|mov|webm|3gp|m4v)$/i

export function isVideoPath(path) {
  return VIDEO_EXT_RE.test(path || '')
}
