# OCR language data

Place Tesseract traineddata files here to make OCR work **fully offline**:

- `eng.traineddata`
- `ara.traineddata`

Download the standard models from:
https://github.com/tesseract-ocr/tessdata (or `tessdata_fast` for smaller/faster).

When these files are present, `electron-builder` ships them unpacked to
`resources/tessdata/` in the packaged app, and `src/main/extraction/ocr.ts`
points Tesseract at them (no network needed).

If they are absent, the app falls back to downloading language data from the
tesseract.js CDN on first OCR use, cached under the user-data directory so it
only downloads once.

These binaries are intentionally **not committed** (they're ~15–40 MB each).
