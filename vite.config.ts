import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  // Keep the runtime identical in local preview and production. The legacy
  // component tagger wrapped every function component with a ref, which
  // caused React warnings and could prevent lazy routes from mounting.
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor libraries out of the shared
        // entry chunk so they cache independently of app code (which
        // changes every deploy) and can download in parallel.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-router")) return "vendor-router";
          if (/[\\/]react(-dom)?[\\/]|[\\/]scheduler[\\/]/.test(id)) return "vendor-react";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("jspdf") || id.includes("html2canvas")) return "vendor-pdf";
        },
      },
    },
  },
}));
