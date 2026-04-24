import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "../games/newsroom"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/main.jsx"),
      output: {
        entryFileNames: "assets/radio-main.js",
        chunkFileNames: "assets/radio-[name].js",
        assetFileNames: "assets/radio-[name].[ext]",
      },
    },
  },
});
