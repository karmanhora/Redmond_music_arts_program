import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";

export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  // The WGSL loader prepares the landing-page note shader at build time, so the
  // WGSL parser never ships to the browser. It is only reached through the
  // landing page's lazy `notes` chunk, so first paint is unaffected.
  plugins: [react(), tailwindcss(), wgslVitePlugin()],
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
