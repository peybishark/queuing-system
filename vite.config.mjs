import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(__dirname, "src/renderer");

export default defineConfig({
  root: rendererRoot,
  base: "./",
  publicDir: resolve(rendererRoot, "assets"),
  envDir: __dirname,
  envPrefix: ["VITE_", "FIREBASE_", "QUEUE_"],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(rendererRoot, "index.html"),
        kiosk: resolve(rendererRoot, "kiosk.html"),
        display: resolve(rendererRoot, "display.html"),
        counter: resolve(rendererRoot, "counter.html"),
      },
    },
  },
});
