# Fix: HEIC photos fail to upload

## Root cause
`heic2any@0.0.4` (last published 2020) bundles an old libheif. Modern iOS HDR HEICs —
ftyp brands `heic mif1 MiHB MiHE MiPr miaf tmap`, i.e. a `tmap` tone-map primary item —
throw `ERR_LIBHEIF format not supported`. Reproduced in-browser against `IMG_4882.HEIC`.

Secondary: `addFiles` uses `Promise.all`, so one failing file rejects the whole batch
and silently drops every photo the user selected.

## Tasks
- [x] Reproduce and confirm root cause in a real browser
- [x] Verify `heic-to` (libheif-js 1.19.x) decodes the same file
- [x] Add `libheif-js`, remove `heic2any`
- [x] Move conversion into an inlined Web Worker (keeps `vite-plugin-singlefile` build intact)
- [x] `addFiles`: per-file failure tolerance + converting indicator
- [x] Verify in browser: HEIC upload succeeds, UI stays responsive
- [x] Verify production single-file build still works

## Review

**Changes**
- `src/utils/heicWorker.ts` (new) — decodes with `libheif-js` (libheif 1.19.x) and encodes
  via `OffscreenCanvas.convertToBlob`. Wrapper libs (`heic2any`, `heic-to`) all encode through
  `document.createElement("canvas")`, so none of them can run in a worker; using libheif-js
  directly avoids that. `libheif-js/wasm-bundle` inlines the .wasm as base64.
- `src/utils/heic.ts` (new) — single lazily-created worker, id-keyed request map,
  `onerror` rejects everything in flight and drops the worker so the next call gets a fresh one.
  Owns `isHeicFile`, moved out of `App.tsx`.
- `src/App.tsx` — `loadImageFile` calls `heicToJpeg`; `addFiles` uses `Promise.allSettled`
  with an `ImportStatus` spinner/error strip; object URL is revoked on decode failure.
- `vite.config.ts` — `worker.format: "es"` (the default `iife` silently produced a worker
  containing ESM `import`, which failed with an opaque error), and
  `optimizeDeps.include` for `libheif-js/wasm-bundle` since Vite's dev scanner
  doesn't follow into workers.

**Verified in Chrome against the real iOS 18 HDR file (`IMG_4882.HEIC`, 5712×4284)**
- Dev server, via the actual "Add photos" button: imports, lands in the library, auto-fills
  cell 1·1. ~6.5 s conversion.
- Main thread stays responsive during conversion: p95 frame 18 ms (one 294 ms spike when the
  4.9 MB JPEG paints). Previously this was a full main-thread block.
- Truncated file → `Couldn't read broken.heic — libheif could not decode this image`,
  app keeps working, and a good file imported right afterwards on the same worker (~3.3 s warm).
- `npm run build` still emits a single `dist/index.html` (2.5 MB) — the worker is inlined —
  and both paths above were re-verified against that built file.
- `npx tsc --noEmit` clean.

**Follow-up: `IMG_6142.HEIC` — "no image found in file"**

That file is a baseline JPEG (836×627, iPhone 16e, iOS 18.6.2) that merely carries a `.HEIC`
extension — Apple's export/share flows do this regularly. The code trusted the extension and
fed a JPEG to libheif, which correctly reported no HEIF image.

Fix: `needsHeicDecode()` in `src/utils/heic.ts` sniffs the `ftyp` box and major brand
(`heic/heix/heim/heis/hevc/hevx/hevm/hevs/mif1/msf1`) instead of trusting the filename.
AVIF is deliberately excluded — browsers decode it natively and faster. `isHeicFile` is now
only the accept-filter (`.heic` often arrives with an empty MIME type), and `loadImageFile`
decides by content. This also covers the reverse case: a genuine HEIC named `.jpg`.

Verified in Chrome: the mislabeled JPEG imports instantly at 627×836 (EXIF rotation applied),
a genuine HEIC still routes through the worker, and both sit in the library together.

**Notes / possible follow-ups**
- Bundle grew ~1.5 MB from the inlined libheif wasm. If that matters for the single-file
  distribution, the worker could be split out and loaded on demand.
- Conversions are serialized through one worker. Fine for a handful of photos; a pool would
  help for large batches.
