import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Pages: the till at the root, the customer receipt (from the QR code) at receipt.html,
// and the Zeller test page at test.html.
export default defineConfig(() => ({
  plugins: [react()],
  // Firebase Hosting serves from the root.
  base: "/",
  build: {
    rollupOptions: {
      input: {
        till: resolve(__dirname, "index.html"),
        receipt: resolve(__dirname, "receipt.html"),
        test: resolve(__dirname, "test.html"),
      },
    },
  },
}));
