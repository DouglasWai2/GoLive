import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
      "/turn-credentials": {
        target: "http://localhost:3000",
      },
    },
  },
});
