import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-monaco": ["monaco-editor", "@monaco-editor/react"],
          "vendor-flow": ["@xyflow/react"],
          "vendor-jose": ["jose"],
          "vendor-ui": ["lucide-react", "zustand", "zod"]
        }
      }
    }
  }
});
