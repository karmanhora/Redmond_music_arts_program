import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Keep the heavy, rarely-needed bundles out of the first paint: the QR
        // scanner (html5-qrcode + qrcode.react) only matters on the check-in
        // screens, and Clerk only matters before sign-in.
        manualChunks(id) {
          if (id.includes("html5-qrcode") || id.includes("qrcode.react")) {
            return "qr";
          }
          if (id.includes("@clerk")) {
            return "clerk";
          }
        },
      },
    },
  },
});
