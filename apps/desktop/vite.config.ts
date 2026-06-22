import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: desktopRoot,
  plugins: [react()],
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
  },
});
