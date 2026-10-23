import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site from /roseberry-till/, not the domain root.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/roseberry-till/" : "/",
}));
