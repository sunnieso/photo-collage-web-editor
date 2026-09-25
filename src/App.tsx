import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// @ts-ignore
import Cropper from "react-easy-crop";
import { jsPDF } from "jspdf";
import { heicToJpeg, isHeicFile, needsHeicDecode } from "./utils/heic";

// Helpers
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

type LibraryPhoto = {
  id: string;
  src: string;
  name: string;
  width: number;
  height: number;
};

type CellFilters = {
  brightness: number;
  contrast: number;
  saturate: number;
  grayscale: number;
  blur: number;
  hue: number;
};

type CellPhoto = {
  libraryId: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number; // 0,90,180,270
  flipH: boolean;
  flipV: boolean;
  filters: CellFilters;
};

type Cell = {
  id: string;
  index: number;
  photo: CellPhoto | null;
};

type PageConfig = {
  width: number;
  height: number;
  background: string;
};

type GridConfig = {
  cols: number;
  rows: number;
  gap: number;
  padding: number;
  radius: number;
};

const PAGE_PRESETS = [
  { label: "Instagram Sq", w: 1080, h: 1080 },
  { label: "Instagram 4:5", w: 1080, h: 1350 },
  { label: "Story 9:16", w: 1080, h: 1920 },
  { label: "A4 Portrait", w: 2480, h: 3508 },
  { label: "A4 Landscape", w: 3508, h: 2480 },
  { label: "4×6 Print", w: 1200, h: 1800 },
  { label: "8×10", w: 2400, h: 3000 },
  { label: "HD 16:9", w: 1920, h: 1080 },
];

const defaultFilters: CellFilters = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  grayscale: 0,
  blur: 0,
  hue: 0,
};

function cssFilterString(f: CellFilters) {
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) blur(${f.blur}px) hue-rotate(${f.hue}deg)`;
}

function canvasFilterString(f: CellFilters) {
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) blur(${f.blur}px) hue-rotate(${f.hue}deg)`;
}

// Load image file, converting HEIC/HEIF to JPEG first
async function loadImageFile(file: File): Promise<LibraryPhoto> {
  let blob: Blob = file;
  let name = file.name;

  if (await needsHeicDecode(file)) {
    blob = await heicToJpeg(file);
    name = name.replace(/\.(heic|heif)$/i, ".jpg");
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () =>
      resolve({ id: uid(), src: url, name, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not decode ${file.name}`));
    };
    img.src = url;
  });
}

// Cropper util for react-easy-crop
async function getCroppedImgEasy(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number }
): Promise<{ url: string; width: number; height: number }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );
  return {
    url: canvas.toDataURL("image/jpeg", 0.94),
    width: pixelCrop.width,
    height: pixelCrop.height,
  };
}

export default function App() {
  const [page, setPage] = useState<PageConfig>({
    width: 1080,
    height: 1350,
    background: "#ffffff",
  });
  const [grid, setGrid] = useState<GridConfig>({
    cols: 3,
    rows: 3,
    gap: 14,
    padding: 32,
    radius: 14,
  });
  const [library, setLibrary] = useState<LibraryPhoto[]>([]);
  const [cells, setCells] = useState<Cell[]>(() =>
    Array.from({ length: 9 }, (_, i) => ({ id: uid(), index: i, photo: null }))
  );
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);

  // Keep cells count in sync with grid
  useEffect(() => {
    const total = grid.cols * grid.rows;
    setCells((prev) => {
      const next: Cell[] = Array.from({ length: total }, (_, i) => {
        const existing = prev[i];
        return existing ? { ...existing, index: i } : { id: uid(), index: i, photo: null };
      });
      return next;
    });
    setSelectedCellId((s) => {
      if (!s) return s;
      const idx = cells.findIndex((c) => c.id === s);
      if (idx >= 0 && idx < total) return s;
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.cols, grid.rows]);

  const selectedCell = useMemo(
    () => cells.find((c) => c.id === selectedCellId) || null,
    [cells, selectedCellId]
  );

  // Photo upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || isHeicFile(f)
    );
    if (accepted.length === 0) return;

    setImportError(null);
    setImporting((n) => n + accepted.length);
    // One slow file must not take the rest of the batch down with it.
    const results = await Promise.allSettled(
      accepted.map((f) => loadImageFile(f).finally(() => setImporting((n) => n - 1)))
    );
    const loaded = results
      .filter((r): r is PromiseFulfilledResult<LibraryPhoto> => r.status === "fulfilled")
      .map((r) => r.value);
    const failed = accepted
      .map((f, i) => ({ f, r: results[i] }))
      .filter((x): x is { f: File; r: PromiseRejectedResult } => x.r.status === "rejected");
    if (failed.length > 0) {
      setImportError(
        failed.map(({ f, r }) => `Couldn't read ${f.name} — ${r.reason?.message ?? r.reason}`).join("; ")
      );
    }
    if (loaded.length === 0) return;

    setLibrary((l) => [...loaded, ...l]);
    // Auto fill empty cells
    setCells((prev) => {
      const next = [...prev];
      let libIdx = 0;
      for (let i = 0; i < next.length && libIdx < loaded.length; i++) {
        if (!next[i].photo) {
          const p = loaded[libIdx++];
          next[i] = {
            ...next[i],
            photo: {
              libraryId: p.id,
              src: p.src,
              naturalWidth: p.width,
              naturalHeight: p.height,
              scale: 1,
              offsetX: 0,
              offsetY: 0,
              rotation: 0,
              flipH: false,
              flipV: false,
              filters: { ...defaultFilters },
            },
          };
        }
      }
      return next;
    });
  }, []);

  // Assign photo to cell
  const assignPhotoToCell = useCallback((cellId: string, libPhoto: LibraryPhoto) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId
          ? {
              ...c,
              photo: {
                libraryId: libPhoto.id,
                src: libPhoto.src,
                naturalWidth: libPhoto.width,
                naturalHeight: libPhoto.height,
                scale: 1,
                offsetX: 0,
                offsetY: 0,
                rotation: 0,
                flipH: false,
                flipV: false,
                filters: { ...defaultFilters },
              },
            }
          : c
      )
    );
    setSelectedCellId(cellId);
  }, []);

  const updateCellPhoto = useCallback((cellId: string, patch: Partial<CellPhoto>) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId && c.photo ? { ...c, photo: { ...c.photo, ...patch } } : c
      )
    );
  }, []);

  const updateCellFilters = useCallback(
    (cellId: string, filtersPatch: Partial<CellFilters>) => {
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId && c.photo
            ? { ...c, photo: { ...c.photo, filters: { ...c.photo.filters, ...filtersPatch } } }
            : c
        )
      );
    },
    []
  );

  // Clear cell
  const clearCellPhoto = useCallback((cellId: string) => {
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, photo: null } : c))
    );
  }, []);

  // Replace photo input
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Canvas workspace scaling
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceSize, setWorkspaceSize] = useState({ w: 900, h: 600 });
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWorkspaceSize({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const canvasZoomPreset = useState(100)[0]; // just static for now; we auto-fit
  const fitScale = useMemo(() => {
    const pad = 52;
    const maxW = workspaceSize.w - pad * 2;
    const maxH = workspaceSize.h - pad * 2;
    const s = Math.min(maxW / page.width, maxH / page.height, 1);
    return clamp(s, 0.085, 1.2);
  }, [workspaceSize, page.width, page.height]);

  const displayScale = fitScale * (canvasZoomPreset / 100);
  const displayPageW = page.width * displayScale;
  const displayPageH = page.height * displayScale;

  const cellLayout = useMemo(() => {
    const innerW = page.width - grid.padding * 2;
    const innerH = page.height - grid.padding * 2;
    const cellW = (innerW - grid.gap * (grid.cols - 1)) / grid.cols;
    const cellH = (innerH - grid.gap * (grid.rows - 1)) / grid.rows;
    const items = cells.map((c) => {
      const col = c.index % grid.cols;
      const row = Math.floor(c.index / grid.cols);
      const x = grid.padding + col * (cellW + grid.gap);
      const y = grid.padding + row * (cellH + grid.gap);
      return { ...c, col, row, x, y, w: cellW, h: cellH };
    });
    return items;
  }, [cells, grid, page.width, page.height]);

  // Export
  const [isExporting, setIsExporting] = useState(false);
  const [exportScale, setExportScale] = useState(1);

  const renderCollageToCanvas = useCallback(
    async (outScale = 1, mime: "image/png" | "image/jpeg" = "image/png", quality = 0.92) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(page.width * outScale);
      canvas.height = Math.round(page.height * outScale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas ctx");

      // background
      ctx.fillStyle = page.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Preload images
      const uniqueSrcs = Array.from(
        new Set(cellLayout.map((c) => c.photo?.src).filter(Boolean) as string[])
      );
      const imgMap = new Map<string, HTMLImageElement>();
      await Promise.all(
        uniqueSrcs.map(
          (src) =>
            new Promise<void>((res) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                imgMap.set(src, img);
                res();
              };
              img.onerror = () => res();
              img.src = src;
            })
        )
      );

      const innerW = page.width - grid.padding * 2;
      const innerH = page.height - grid.padding * 2;
      const cellW = (innerW - grid.gap * (grid.cols - 1)) / grid.cols;
      const cellH = (innerH - grid.gap * (grid.rows - 1)) / grid.rows;

      const radius = grid.radius * outScale;
      const roundRect = (
        c: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        r: number
      ) => {
        const rr = Math.min(r, w / 2, h / 2);
        c.beginPath();
        c.moveTo(x + rr, y);
        c.arcTo(x + w, y, x + w, y + h, rr);
        c.arcTo(x + w, y + h, x, y + h, rr);
        c.arcTo(x, y + h, x, y, rr);
        c.arcTo(x, y, x + w, y, rr);
        c.closePath();
      };

      for (let idx = 0; idx < cells.length; idx++) {
        const col = idx % grid.cols;
        const row = Math.floor(idx / grid.cols);
        const x = (grid.padding + col * (cellW + grid.gap)) * outScale;
        const y = (grid.padding + row * (cellH + grid.gap)) * outScale;
        const w = cellW * outScale;
        const h = cellH * outScale;

        const cell = cells[idx];
        ctx.save();
        roundRect(ctx, x, y, w, h, radius);
        ctx.clip();

        // light cell background
        ctx.fillStyle = "#e9e9ee";
        ctx.fillRect(x, y, w, h);

        if (cell.photo) {
          const p = cell.photo;
          const img = imgMap.get(p.src);
          if (img) {
            ctx.filter = canvasFilterString(p.filters);
            const baseScale = Math.max(w / p.naturalWidth, h / p.naturalHeight);
            const drawScale = baseScale * p.scale;
            const drawW = p.naturalWidth * drawScale;
            const drawH = p.naturalHeight * drawScale;
            const cx = x + w / 2 + p.offsetX * outScale;
            const cy = y + h / 2 + p.offsetY * outScale;

            ctx.save();
            ctx.translate(cx, cy);
            const rot = ((p.rotation % 360) * Math.PI) / 180;
            ctx.rotate(rot);
            ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
            ctx.filter = "none";
          }
        }
        ctx.restore();
      }

      return { canvas, dataUrl: canvas.toDataURL(mime, quality) };
    },
    [page, grid, cells, cellLayout]
  );

  const downloadImage = useCallback(
    async (type: "png" | "jpeg" | "pdf") => {
      setIsExporting(true);
      try {
        const scale = exportScale;
        if (type === "pdf") {
          const { dataUrl } = await renderCollageToCanvas(scale, "image/jpeg", 0.94);
          const pdf = new jsPDF({
            orientation: page.width > page.height ? "l" : "p",
            unit: "px",
            format: [page.width, page.height],
            hotfixes: ["px_scaling"],
          });
          pdf.addImage(dataUrl, "JPEG", 0, 0, page.width, page.height, undefined, "FAST");
          pdf.save(`collage-${page.width}x${page.height}.pdf`);
        } else {
          const mime = type === "png" ? "image/png" : "image/jpeg";
          const { dataUrl } = await renderCollageToCanvas(scale, mime, 0.93);
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `collage-${page.width}x${page.height}.${type === "jpeg" ? "jpg" : "png"}`;
          a.click();
        }
      } finally {
        setIsExporting(false);
      }
    },
    [renderCollageToCanvas, exportScale, page.width, page.height]
  );

  // Drag photo transform state
  const dragState = useRef<{
    cellId: string;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const st = dragState.current;
      if (!st) return;
      const cell = cells.find((c) => c.id === st.cellId)?.photo;
      if (!cell) return;
      const dx = (e.clientX - st.startX) / displayScale;
      const dy = (e.clientY - st.startY) / displayScale;
      updateCellPhoto(st.cellId, {
        offsetX: st.origOffsetX + dx,
        offsetY: st.origOffsetY + dy,
      });
    };
    const up = () => {
      dragState.current = null;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [cells, displayScale, updateCellPhoto]);

  // Crop modal
  const [cropModal, setCropModal] = useState<{
    open: boolean;
    cellId: string | null;
    src: string;
    width: number;
    height: number;
  }>({ open: false, cellId: null, src: "", width: 1, height: 1 });

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const openCropModal = useCallback(() => {
    if (!selectedCell?.photo) return;
    setCrop({ x: 0, y: 0 });
    setCropZoom(1);
    setCroppedAreaPixels(null);
    setCropModal({
      open: true,
      cellId: selectedCell.id,
      src: selectedCell.photo.src,
      width: selectedCell.photo.naturalWidth,
      height: selectedCell.photo.naturalHeight,
    });
  }, [selectedCell]);

  const applyCrop = useCallback(async () => {
    if (!cropModal.cellId || !croppedAreaPixels) return;
    const res = await getCroppedImgEasy(cropModal.src, croppedAreaPixels);
    const newLib: LibraryPhoto = {
      id: uid(),
      src: res.url,
      name: "cropped.jpg",
      width: res.width,
      height: res.height,
    };
    setLibrary((l) => [newLib, ...l]);
    setCells((prev) =>
      prev.map((c) =>
        c.id === cropModal.cellId && c.photo
          ? {
              ...c,
              photo: {
                ...c.photo,
                libraryId: newLib.id,
                src: newLib.src,
                naturalWidth: newLib.width,
                naturalHeight: newLib.height,
                scale: 1,
                offsetX: 0,
                offsetY: 0,
                rotation: 0,
                flipH: false,
                flipV: false,
              },
            }
          : c
      )
    );
    setCropModal({ open: false, cellId: null, src: "", width: 1, height: 1 });
  }, [cropModal, croppedAreaPixels]);

  const clearAllCells = useCallback(() => {
    setCells((prev) => prev.map((c) => ({ ...c, photo: null })));
    setSelectedCellId(null);
  }, []);
  const shufflePhotos = useCallback(() => {
    setCells((prev) => {
      const photos = prev.map((c) => c.photo).filter(Boolean);
      for (let i = photos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [photos[i], photos[j]] = [photos[j], photos[i]];
      }
      let pi = 0;
      return prev.map((c) => ({
        ...c,
        photo: photos[pi++] ?? null,
      }));
    });
  }, []);
  const autoFillEmpty = useCallback(() => {
    if (library.length === 0) return;
    setCells((prev) => {
      let li = 0;
      return prev.map((c) => {
        if (c.photo) return c;
        const lp = library[li % library.length];
        li++;
        return {
          ...c,
          photo: {
            libraryId: lp.id,
            src: lp.src,
            naturalWidth: lp.width,
            naturalHeight: lp.height,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            rotation: 0,
            flipH: false,
            flipV: false,
            filters: { ...defaultFilters },
          },
        };
      });
    });
  }, [library]);

  const selectedCellLayout = selectedCell
    ? cellLayout.find((c) => c.id === selectedCell.id)
    : null;

  return (
    <div className="min-h-screen text-zinc-800 bg-[#f5f3f0]" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}>
      <div className="flex h-screen">
        {/* Left Sidebar */}
        <aside className="w-[340px] shrink-0 border-r border-zinc-200 bg-white/80 backdrop-blur overflow-y-auto">
          <div className="px-5 pt-5 pb-4 border-b border-zinc-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white grid place-items-center font-semibold">CL</div>
              <div>
                <div className="text-[17px] font-[700] tracking-tight">CollageLab</div>
                <div className="text-[12px] text-zinc-500 -mt-0.5">Pixel-perfect collage editor</div>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-6">
            {/* Page */}
            <section>
              <div className="text-[11.5px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">Page Setup</div>
              <div className="rounded-[18px] border border-zinc-200 bg-zinc-50/80 p-3.5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-zinc-600">Width (px)
                    <input
                      type="number"
                      min={200}
                      max={8000}
                      value={page.width}
                      onChange={(e) => setPage(p => ({ ...p, width: clamp(parseInt(e.target.value)||1080, 200, 8000)}))}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
                    />
                  </label>
                  <label className="text-xs text-zinc-600">Height (px)
                    <input
                      type="number"
                      min={200}
                      max={8000}
                      value={page.height}
                      onChange={(e) => setPage(p => ({ ...p, height: clamp(parseInt(e.target.value)||1350, 200, 8000)}))}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PAGE_PRESETS.map(pr => (
                    <button key={pr.label}
                      onClick={() => setPage(p => ({ ...p, width: pr.w, height: pr.h }))}
                      className="px-2.5 py-1.5 rounded-full bg-white border border-zinc-200 text-[11.5px] text-zinc-700 hover:bg-zinc-50 transition"
                    >{pr.label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-zinc-600 flex-1">Background
                    <div className="flex mt-1 items-center gap-2">
                      <input
                        type="color"
                        value={page.background}
                        onChange={(e) => setPage(p => ({ ...p, background: e.target.value }))}
                        className="h-[38px] w-12 rounded-lg border border-zinc-300 bg-white p-1"
                      />
                      <input
                        value={page.background}
                        onChange={(e)=> setPage(p=>({...p, background: e.target.value}))}
                        className="flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                  </label>
                  <button
                    onClick={()=> setPage(p=>({...p, width: p.height, height: p.width}))}
                    className="mt-[18px] px-3 py-2 rounded-xl border border-zinc-300 bg-white text-xs hover:bg-zinc-50"
                    title="Swap width / height"
                  >⇄</button>
                </div>
                <div className="text-[11px] text-zinc-500">Total pixels: {(page.width*page.height).toLocaleString()}</div>
              </div>
            </section>

            {/* Grid */}
            <section>
              <div className="text-[11.5px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">Grid Template</div>
              <div className="rounded-[18px] border border-zinc-200 bg-zinc-50/80 p-3.5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-zinc-600">Columns
                    <input type="number" min={1} max={20} value={grid.cols}
                      onChange={e=>setGrid(g=>({...g, cols: clamp(parseInt(e.target.value)||1,1,20)}))}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs text-zinc-600">Rows
                    <input type="number" min={1} max={20} value={grid.rows}
                      onChange={e=>setGrid(g=>({...g, rows: clamp(parseInt(e.target.value)||1,1,20)}))}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <label className="text-xs text-zinc-600">Gap
                    <input type="number" min={0} max={240} value={grid.gap}
                      onChange={e=>setGrid(g=>({...g, gap: clamp(parseInt(e.target.value)||0,0,240)}))}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs text-zinc-600">Padding
                    <input type="number" min={0} max={400} value={grid.padding}
                      onChange={e=>setGrid(g=>({...g, padding: clamp(parseInt(e.target.value)||0,0,400)}))}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs text-zinc-600">Radius
                    <input type="number" min={0} max={120} value={grid.radius}
                      onChange={e=>setGrid(g=>({...g, radius: clamp(parseInt(e.target.value)||0,0,120)}))}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={autoFillEmpty} className="px-3 py-1.5 rounded-lg bg-white border border-zinc-300 text-xs hover:bg-zinc-50">Auto-fill</button>
                  <button onClick={shufflePhotos} className="px-3 py-1.5 rounded-lg bg-white border border-zinc-300 text-xs hover:bg-zinc-50">Shuffle</button>
                  <button onClick={clearAllCells} className="px-3 py-1.5 rounded-lg bg-white border border-zinc-300 text-xs hover:bg-zinc-50">Clear all</button>
                </div>
                <div className="text-[11px] text-zinc-500">{grid.cols} × {grid.rows} = {grid.cols*grid.rows} cells</div>
              </div>
            </section>

            {/* Export */}
            <section>
              <div className="text-[11.5px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">Export</div>
              <div className="rounded-[18px] border border-zinc-200 bg-zinc-50/80 p-3.5 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    disabled={isExporting}
                    onClick={() => downloadImage("png")}
                    className="rounded-xl bg-zinc-900 text-white text-[13px] font-medium py-2.5 hover:bg-zinc-800 disabled:opacity-60"
                  >PNG</button>
                  <button
                    disabled={isExporting}
                    onClick={() => downloadImage("jpeg")}
                    className="rounded-xl bg-zinc-900 text-white text-[13px] font-medium py-2.5 hover:bg-zinc-800 disabled:opacity-60"
                  >JPEG</button>
                  <button
                    disabled={isExporting}
                    onClick={() => downloadImage("pdf")}
                    className="rounded-xl bg-zinc-900 text-white text-[13px] font-medium py-2.5 hover:bg-zinc-800 disabled:opacity-60"
                  >PDF</button>
                </div>
                <label className="block text-xs text-zinc-600">
                  Export resolution scale
                  <div className="flex items-center gap-3 mt-1">
                    <input
                      type="range" min={0.5} max={3} step={0.25}
                      value={exportScale}
                      onChange={(e)=>setExportScale(parseFloat(e.target.value))}
                      className="flex-1 accent-zinc-900"
                    />
                    <div className="text-[12px] font-medium w-20 text-right">{exportScale.toFixed(2)}×</div>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    Output: {Math.round(page.width*exportScale)} × {Math.round(page.height*exportScale)} px
                  </div>
                </label>
                <div className="text-[11px] text-zinc-500">
                  Exports at full pixel fidelity. PDF matches page size.
                </div>
              </div>
            </section>

            <div className="rounded-[18px] bg-amber-50 border border-amber-200 text-amber-900 text-[12px] px-3.5 py-3 leading-relaxed">
              Tip: drag photos in the canvas to reposition. Scroll to zoom. Click a cell to edit it on the right.
            </div>
          </div>
        </aside>

        {/* Canvas */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#ece8e3]">
          {/* Toolbar */}
          <div className="h-[56px] border-b border-zinc-200 bg-white flex items-center px-4 gap-3">
            <div className="text-sm text-zinc-600">
              {page.width} × {page.height}px • {grid.cols}×{grid.rows}
            </div>
            <div className="flex-1" />
            <button
              onClick={()=>fileInputRef.current?.click()}
              className="px-3.5 py-2 rounded-full bg-zinc-900 text-white text-[13px] font-medium hover:bg-zinc-800"
            >Add photos</button>
            <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.heic,.heif" multiple onChange={e=>{ addFiles(e.target.files); e.currentTarget.value=''; }} />
            <div className="text-xs text-zinc-500">Fit: {Math.round(fitScale*100)}%</div>
          </div>

          <div ref={workspaceRef} className="flex-1 relative overflow-auto">
            {/* Checker / dot bg */}
            <div className="absolute inset-0" style={{
              backgroundImage: "radial-gradient(rgba(0,0,0,.12) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
              backgroundPosition: "0 0",
            }}/>
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                style={{
                  width: displayPageW,
                  height: displayPageH,
                  background: page.background,
                  boxShadow: "0 24px 70px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.07)",
                  position: "relative",
                  borderRadius: 14,
                }}
              >
                {/* Cells */}
                {cellLayout.map((cell) => {
                  const x = cell.x * displayScale;
                  const y = cell.y * displayScale;
                  const w = cell.w * displayScale;
                  const h = cell.h * displayScale;
                  const isSelected = cell.id === selectedCellId;
                  const p = cell.photo;
                  return (
                    <div
                      key={cell.id}
                      onClick={() => setSelectedCellId(cell.id)}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const libId = e.dataTransfer.getData("text/photo-id");
                        const lp = library.find(l=>l.id===libId);
                        if (lp) assignPhotoToCell(cell.id, lp);
                      }}
                      style={{
                        position: "absolute",
                        left: x,
                        top: y,
                        width: w,
                        height: h,
                        borderRadius: grid.radius * displayScale,
                        outline: isSelected ? "2.5px solid #2563eb" : "1px solid rgba(0,0,0,.09)",
                        outlineOffset: isSelected ? "0px" : "0px",
                        overflow: "hidden",
                        background: "#e8e6e3",
                        cursor: p ? "grab" : "pointer",
                      }}
                    >
                      {p ? (
                        <div
                          className="w-full h-full relative"
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            setSelectedCellId(cell.id);
                            dragState.current = {
                              cellId: cell.id,
                              startX: e.clientX,
                              startY: e.clientY,
                              origOffsetX: p.offsetX,
                              origOffsetY: p.offsetY,
                            };
                            document.body.style.cursor = "grabbing";
                            e.preventDefault();
                          }}
                          onWheel={(e) => {
                            e.preventDefault();
                            const delta = -e.deltaY * 0.0018;
                            const next = clamp(p.scale * (1 + delta), 0.4, 5);
                            updateCellPhoto(cell.id, { scale: next });
                          }}
                        >
                          <img
                            src={p.src}
                            alt=""
                            draggable={false}
                            style={{
                              position: "absolute",
                              left: "50%",
                              top: "50%",
                              width: p.naturalWidth,
                              height: p.naturalHeight,
                              transform: `translate(calc(-50% + ${p.offsetX * displayScale}px), calc(-50% + ${p.offsetY * displayScale}px)) scale(${ (Math.max(w / p.naturalWidth, h / p.naturalHeight) * p.scale )}) rotate(${p.rotation}deg) scaleX(${p.flipH ? -1 : 1}) scaleY(${p.flipV ? -1 : 1})`,
                              transformOrigin: "center",
                              filter: cssFilterString(p.filters),
                              userSelect: "none",
                              pointerEvents: "none",
                              maxWidth: "none",
                            }}
                          />
                        </div>
                      ) : (
                        <div className="w-full h-full grid place-items-center text-zinc-400 text-[11px]">
                          Drop photo
                        </div>
                      )}
                      <div className="absolute top-1.5 left-1.5 text-[10px] bg-white/85 px-1.5 py-0.5 rounded-md text-zinc-600 shadow-sm">
                        {cell.row+1}·{cell.col+1}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="h-10 border-t border-zinc-200 bg-white px-4 text-[12px] text-zinc-600 flex items-center gap-4">
            {selectedCell && selectedCell.photo ? (
              <>
                <span>Cell { (selectedCellLayout?.row ?? 0)+1 } / { (selectedCellLayout?.col ?? 0)+1 }</span>
                <span>•</span>
                <span>Zoom {Math.round(selectedCell.photo.scale*100)}%</span>
                <span>• Drag to pan • Scroll to zoom</span>
              </>
            ) : (
              <span>Click a cell to edit. Drag photos from the right library onto cells.</span>
            )}
          </div>
        </main>

        {/* Right Sidebar */}
        <aside className="w-[375px] shrink-0 border-l border-zinc-200 bg-white overflow-y-auto">
          <div className="p-5">
            {selectedCell ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11.5px] uppercase tracking-wider text-zinc-500 font-semibold">Cell Editor</div>
                    <div className="text-[13px] text-zinc-600">Row {(selectedCellLayout?.row ?? 0)+1}, Col {(selectedCellLayout?.col ?? 0)+1}</div>
                  </div>
                  <button
                    onClick={()=> setSelectedCellId(null)}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-zinc-50 hover:bg-zinc-100"
                  >Done</button>
                </div>

                {selectedCell.photo ? (
                  <>
                    <div className="rounded-[16px] border border-zinc-200 bg-zinc-50 p-3">
                      <div className="flex gap-3">
                        <img src={selectedCell.photo.src} className="w-20 h-20 object-cover rounded-xl ring-1 ring-zinc-200" />
                        <div className="text-[12px] text-zinc-600 leading-relaxed">
                          {selectedCell.photo.naturalWidth} × {selectedCell.photo.naturalHeight}px<br/>
                          Scale {Math.round(selectedCell.photo.scale*100)}%<br/>
                          Offset {Math.round(selectedCell.photo.offsetX)}, {Math.round(selectedCell.photo.offsetY)}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={()=> replaceInputRef.current?.click()}
                          className="flex-1 py-2 rounded-xl bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800"
                        >Replace</button>
                        <input
                          ref={replaceInputRef}
                          type="file"
                          accept="image/*,.heic,.heif"
                          className="hidden"
                          onChange={async (e)=>{
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const lp = await loadImageFile(f);
                            setLibrary(l=>[lp, ...l]);
                            assignPhotoToCell(selectedCell.id, lp);
                            e.currentTarget.value = "";
                          }}
                        />
                        <button
                          onClick={()=> clearCellPhoto(selectedCell.id)}
                          className="px-3 py-2 rounded-xl border border-zinc-300 bg-white text-xs hover:bg-zinc-50"
                        >Remove</button>
                      </div>
                    </div>

                    {/* Transform */}
                    <div>
                      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Transform</div>
                      <div className="rounded-[16px] border border-zinc-200 p-3.5 space-y-3 bg-zinc-50/70">
                        <label className="block text-xs text-zinc-700">
                          Zoom
                          <input
                            type="range" min={0.4} max={4} step={0.01}
                            value={selectedCell.photo.scale}
                            onChange={(e)=>updateCellPhoto(selectedCell.id, { scale: parseFloat(e.target.value) })}
                            className="w-full accent-zinc-900 mt-1"
                          />
                        </label>
                        <div className="flex gap-2 text-xs">
                          <button
                            onClick={()=> updateCellPhoto(selectedCell!.id, { offsetX: 0, offsetY: 0, scale: 1 })}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-50"
                          >Reset pos</button>
                          <button onClick={()=> updateCellPhoto(selectedCell!.id, { scale: 1, offsetX:0, offsetY:0 })} className="px-2.5 py-1.5 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-50">Fit Cover</button>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {[0,90,180,270].map(r=>(
                            <button key={r}
                              onClick={()=> updateCellPhoto(selectedCell!.id, { rotation: r })}
                              className={`px-2.5 py-1.5 rounded-lg border text-xs ${selectedCell.photo?.rotation===r ? "bg-zinc-900 text-white border-zinc-900":"bg-white border-zinc-300 hover:bg-zinc-50"}`}
                            >{r}°</button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={()=> updateCellPhoto(selectedCell!.id, { flipH: !selectedCell.photo?.flipH })}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs ${selectedCell.photo?.flipH ? "bg-zinc-900 text-white border-zinc-900":"bg-white border-zinc-300"}`}
                          >Flip H</button>
                          <button
                            onClick={()=> updateCellPhoto(selectedCell!.id, { flipV: !selectedCell.photo?.flipV })}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs ${selectedCell.photo?.flipV ? "bg-zinc-900 text-white border-zinc-900":"bg-white border-zinc-300"}`}
                          >Flip V</button>
                        </div>
                        <button
                          onClick={openCropModal}
                          className="w-full py-2 rounded-xl bg-white border border-zinc-300 text-xs font-medium hover:bg-zinc-50"
                        >Open Crop Editor…</button>
                      </div>
                    </div>

                    {/* Adjust */}
                    <div>
                      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Adjust</div>
                      <div className="rounded-[16px] border border-zinc-200 p-3.5 space-y-3 bg-zinc-50/70">
                        {([
                          ["Brightness", "brightness", 0, 200],
                          ["Contrast", "contrast", 0, 200],
                          ["Saturation", "saturate", 0, 200],
                          ["Grayscale", "grayscale", 0, 100],
                          ["Blur", "blur", 0, 8],
                          ["Hue", "hue", -180, 180],
                        ] as const).map(([label, key, min, max]) => (
                          <label key={key} className="block text-xs text-zinc-700">
                            <div className="flex justify-between"><span>{label}</span><span className="text-zinc-500">{selectedCell.photo?.filters[key as keyof CellFilters]}{key==="blur"?"px":key==="hue"?"°":"%"}</span></div>
                            <input
                              type="range"
                              min={min}
                              max={max}
                              step={key==="blur"?0.1:1}
                              value={selectedCell.photo?.filters[key as keyof CellFilters]}
                              onChange={(e)=> updateCellFilters(selectedCell.id, { [key]: parseFloat(e.target.value) } as any)}
                              className="w-full accent-zinc-900"
                            />
                          </label>
                        ))}
                        <button
                          onClick={()=> updateCellPhoto(selectedCell.id, { filters: { ...defaultFilters }})}
                          className="text-xs px-3 py-1.5 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-50"
                        >Reset filters</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-[16px] border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-600">
                    This cell is empty.<br/>
                    Drop a photo from the Library below, or click a library image to assign.
                  </div>
                )}

                <div className="pt-2 border-t border-zinc-200">
                  <div className="text-[11.5px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">Photo Library</div>
                  <ImportStatus importing={importing} error={importError} />
                  <LibraryGrid
                    library={library}
                    selectedCellId={selectedCell.id}
                    onPick={(lp)=>assignPhotoToCell(selectedCell.id, lp)}
                    onDelete={(id)=> {
                      setLibrary(l=> l.filter(x=>x.id!==id));
                      setCells(cs=> cs.map(c=> c.photo?.libraryId===id ? {...c, photo: null} : c));
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="text-[11.5px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Photo Library</div>
                  <div className="text-[13px] text-zinc-600">Upload images and click a cell to place them.</div>
                </div>
                <UploadDrop onFiles={addFiles} />
                <ImportStatus importing={importing} error={importError} />
                <LibraryGrid
                  library={library}
                  selectedCellId={null}
                  onPick={(lp)=>{
                    const empty = cells.find(c=>!c.photo);
                    if (empty) assignPhotoToCell(empty.id, lp);
                    else if (cells[0]) assignPhotoToCell(cells[0].id, lp);
                  }}
                  onDelete={(id)=> {
                    setLibrary(l=> l.filter(x=>x.id!==id));
                    setCells(cs=> cs.map(c=> c.photo?.libraryId===id ? {...c, photo: null} : c));
                  }}
                />
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Crop Modal */}
      {cropModal.open && selectedCell?.photo && (
        <div className="fixed inset-0 bg-black/70 z-50 grid place-items-center p-6">
          <div className="w-full max-w-5xl bg-white rounded-[22px] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
              <div className="font-semibold">Crop Image</div>
              <button onClick={()=> setCropModal({open:false, cellId:null, src:"", width:1, height:1})}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-sm">Close</button>
            </div>
            <div className="grid md:grid-cols-[1fr_300px] gap-0">
              <div className="relative h-[520px] bg-zinc-950">
                <Cropper
                  image={cropModal.src}
                  crop={crop}
                  zoom={cropZoom}
                  aspect={(selectedCellLayout?.w ?? 4) / (selectedCellLayout?.h ?? 3)}
                  onCropChange={setCrop}
                  onZoomChange={setCropZoom}
                  onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
                />
              </div>
              <div className="p-5 border-l border-zinc-200 bg-zinc-50">
                <div className="text-sm font-medium mb-2">Crop to cell aspect</div>
                <div className="text-xs text-zinc-600 mb-4">
                  Cell: {Math.round(selectedCellLayout?.w ?? 0)} × {Math.round(selectedCellLayout?.h ?? 0)} px<br/>
                  Original: {cropModal.width} × {cropModal.height}px
                </div>
                <label className="block text-xs mb-4">Zoom
                  <input type="range" min={1} max={3} step={0.01} value={cropZoom} onChange={e=>setCropZoom(parseFloat(e.target.value))} className="w-full accent-zinc-900"/>
                </label>
                <button
                  onClick={applyCrop}
                  className="w-full py-3 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800"
                >Crop & Replace cell photo</button>
                <div className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
                  This creates a new cropped copy in your library (non-destructive to the original). The cell will be reset to default transform after cropping.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global styles */}
      <style>{`
        /* react-easy-crop basic styles fallback */
        .reactEasyCrop_Container { position: absolute; top:0; left:0; right:0; bottom:0; overflow:hidden; user-select:none; touch-action:none; cursor: move;}
        .reactEasyCrop_Image, .reactEasyCrop_Video { max-width: 100%; max-height: 100%; margin: auto; position: absolute; top:0; bottom:0; left:0; right:0; will-change: transform;}
        .reactEasyCrop_CropArea { position: absolute; left:50%; top:50%; transform: translate(-50%, -50%); border:1px solid rgba(255,255,255,.5); box-sizing:border-box; box-shadow: 0 0 0 9999em rgba(0,0,0,.5); overflow:hidden;}
      `}</style>
    </div>
  );
}

function UploadDrop({ onFiles }: { onFiles: (files: FileList | null) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e)=> { e.preventDefault(); setOver(true); }}
      onDragLeave={()=> setOver(false)}
      onDrop={(e)=> { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
      onClick={()=> inputRef.current?.click()}
      className={`rounded-[16px] border-2 border-dashed px-4 py-7 text-center cursor-pointer transition ${over ? "border-zinc-900 bg-zinc-50" : "border-zinc-300 bg-zinc-50/60 hover:bg-zinc-50"}`}
    >
      <div className="text-sm font-medium">Drop images here</div>
      <div className="text-[12px] text-zinc-500 mt-1">or click to browse — JPG, PNG, WebP, HEIC</div>
      <input ref={inputRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={e=>{ onFiles(e.target.files); e.currentTarget.value=''; }} />
    </div>
  );
}

function ImportStatus({ importing, error }: { importing: number; error: string | null }) {
  if (!importing && !error) return null;
  return (
    <div className="space-y-2 mb-3">
      {importing > 0 && (
        <div className="flex items-center gap-2 rounded-[12px] bg-zinc-100 px-3 py-2 text-[12px] text-zinc-600">
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
          Importing {importing} photo{importing > 1 ? "s" : ""}… HEIC files take a few seconds.
        </div>
      )}
      {error && (
        <div className="rounded-[12px] bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>
      )}
    </div>
  );
}

function LibraryGrid({ library, selectedCellId, onPick, onDelete }: {
  library: LibraryPhoto[];
  selectedCellId: string | null;
  onPick: (p: LibraryPhoto) => void;
  onDelete: (id: string) => void;
}) {
  if (library.length === 0) {
    return (
      <div className="text-[13px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-5">
        No photos yet. Upload images to start building your collage.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {library.map(p => (
        <div key={p.id} className="group relative rounded-[14px] overflow-hidden ring-1 ring-zinc-200 bg-white">
          <img
            src={p.src}
            alt=""
            draggable
            onDragStart={(e)=> e.dataTransfer.setData("text/photo-id", p.id)}
            onClick={()=> onPick(p)}
            className="w-full aspect-square object-cover cursor-pointer"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2 text-[11px] text-white flex items-center justify-between opacity-0 group-hover:opacity-100 transition">
            <span className="truncate">{p.width}×{p.height}</span>
            <button
              onClick={(e)=>{ e.stopPropagation(); onDelete(p.id); }}
              className="px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25"
            >✕</button>
          </div>
          {selectedCellId && (
            <button
              onClick={()=> onPick(p)}
              className="absolute top-2 right-2 text-[11px] px-2 py-1 rounded-full bg-white/90 shadow hover:bg-white"
            >Use</button>
          )}
        </div>
      ))}
    </div>
  );
}