import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8070",
      "/auth": "http://localhost:8070",
      "/Shibboleth.sso": "http://localhost:8070",
    },
  },
  build: {
    outDir: "dist",
  },
});
