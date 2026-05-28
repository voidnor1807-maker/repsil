/**
 * Image extensions that the OCR pipeline can rasterize and read. Shared by the
 * extraction worker and the queue classifier so the two never drift (IN-04).
 * Note: SVG/GIF are intentionally absent — they are previewable but not OCR'd.
 */
export const OCR_IMAGE_EXTS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'tiff',
  'tif',
  'bmp',
  'webp'
])

/** Extensions the renderer can show inline (superset of OCR_IMAGE_EXTS). */
export const PREVIEW_IMAGE_EXTS: ReadonlySet<string> = new Set([
  ...OCR_IMAGE_EXTS,
  'gif',
  'svg'
])
