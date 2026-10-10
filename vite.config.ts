import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Keep the heavy, rarely-needed bundle out of the first paint: the QR
        // scanner (html5-qrcode + qrcode.react) only matters on the check-in
        // screens, which are behind the sign-in.
        manualChunks(id) {
          if (id.includes("html5-qrcode") || id.includes("qrcode.react")) {
            return "qr";
          }
        },
      },
    },
  },
});
