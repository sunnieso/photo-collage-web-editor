import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // The HEIC worker imports libheif-js, so it must be a module worker.
  worker: { format: "es" },
  // Only reached from inside the worker, which Vite's dev-time scanner misses.
  optimizeDeps: { include: ["libheif-js/wasm-bundle"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
