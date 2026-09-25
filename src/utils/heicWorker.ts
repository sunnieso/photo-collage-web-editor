// Decodes HEIC/HEIF off the main thread — libheif takes ~10s on a full-size
// iPhone photo, which would otherwise freeze the editor.
// libheif-js is used directly rather than a wrapper like heic-to because the
// wrappers encode via document.createElement("canvas"), which a worker has no
// access to. wasm-bundle inlines the .wasm, keeping the single-file build intact.
import libheif from "libheif-js/wasm-bundle";

type Request = { id: string; blob: Blob };
type Response =
  | { id: string; ok: true; blob: Blob }
  | { id: string; ok: false; error: string };

async function toJpeg(blob: Blob): Promise<Blob> {
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(await blob.arrayBuffer());
  if (!images || images.length === 0) throw new Error("no image found in file");

  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  const imageData = new ImageData(width, height);
  await new Promise<void>((resolve, reject) => {
    image.display(imageData, (result: unknown) =>
      result ? resolve() : reject(new Error("libheif could not decode this image"))
    );
  });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not get a 2d context");
  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, blob } = e.data;
  try {
    self.postMessage({ id, ok: true, blob: await toJpeg(blob) } satisfies Response);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies Response);
  }
};
