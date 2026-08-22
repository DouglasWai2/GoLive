import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@golive/core": fileURLToPath(
        new URL("../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
      "/room": {
        target: "http://localhost:3000",
        bypass: (req) => {
          if (req.method !== "POST") {
            return req.url;
          }
        },
      },
      "/invite": {
        target: "http://localhost:3000",
        bypass: (req) => {
          if (req.method !== "POST") {
            return req.url;
          }
        },
      },
      "/session": {
        target: "http://localhost:3000",
      },
    },
  },
});
