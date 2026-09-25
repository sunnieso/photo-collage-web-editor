// Inlined so the single-file build stays a single file.
import HeicWorker from "./heicWorker?worker&inline";

type Pending = {
  resolve: (blob: Blob) => void;
  reject: (err: Error) => void;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();

function getWorker() {
  if (worker) return worker;
  worker = new HeicWorker();
  worker.onmessage = (e: MessageEvent) => {
    const { id, ok, blob, error } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) entry.resolve(blob);
    else entry.reject(new Error(error));
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "HEIC worker crashed");
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    // Next call gets a fresh worker.
    worker?.terminate();
    worker = null;
  };
  return worker;
}

// Only decides whether to *accept* a file — .heic often arrives with an empty
// MIME type, so the extension has to count. Says nothing about the contents.
export function isHeicFile(file: File) {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

// ISO-BMFF brands libheif handles. AVIF is left out on purpose: browsers decode
// it natively and faster than we can.
const HEIF_BRANDS = new Set([
  "heic", "heix", "heim", "heis",
  "hevc", "hevx", "hevm", "hevs",
  "mif1", "msf1",
]);

// Apple hands out plenty of plain JPEGs named *.HEIC, so the extension can't be
// trusted — sniff the ftyp box instead.
export async function needsHeicDecode(file: Blob) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12) return false;
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...head.subarray(from, to));
  return ascii(4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(8, 12));
}

export function heicToJpeg(blob: Blob): Promise<Blob> {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, blob });
  });
}
