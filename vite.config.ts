import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// GitHub Pages serves the site from /roseberry-till/, not the domain root.
// Two pages: the till at the root and the Zeller test page at test.html.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/roseberry-till/" : "/",
  build: {
    rollupOptions: {
      input: {
        till: resolve(__dirname, "index.html"),
        test: resolve(__dirname, "test.html"),
      },
    },
  },
}));
