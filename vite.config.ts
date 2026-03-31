import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 8082,
    hmr: {
      overlay: false,
    },
    proxy: {
      // WebSocket — must be proxied before HTTP entries
      "/ws": {
        target: "http://127.0.0.1:8002",
        ws: true,
        changeOrigin: true,
      },
      // REST API
      "/api": {
        target: "http://127.0.0.1:8002",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
