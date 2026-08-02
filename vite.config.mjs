import { defineConfig } from "vite";

export default defineConfig({
  // Packaged Electron loads dist/index.html through file://. Relative asset
  // URLs keep scripts, styles, and lazy Mermaid chunks inside app.asar.
  base: "./",
});
