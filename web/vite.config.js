import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var certPath = process.env.GOLIVE_HTTPS_CERT;
var keyPath = process.env.GOLIVE_HTTPS_KEY;
if (Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error("Set both GOLIVE_HTTPS_CERT and GOLIVE_HTTPS_KEY to enable HTTPS");
}
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@golive/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
        },
    },
    server: {
        https: certPath && keyPath ? {
            cert: readFileSync(certPath),
            key: readFileSync(keyPath),
        } : undefined,
        proxy: {
            "/ws": {
                target: "ws://localhost:3000",
                ws: true,
            },
            "/room": {
                target: "http://localhost:3000",
                bypass: function (req) {
                    if (req.method !== "POST") {
                        return req.url;
                    }
                },
            },
            "/invite": {
                target: "http://localhost:3000",
                bypass: function (req) {
                    if (req.method !== "POST") {
                        return req.url;
                    }
                },
            },
            "/session": {
                target: "http://localhost:3000",
            },
            "/device": {
                target: "http://localhost:3000",
            },
            "/admin": {
                target: "http://localhost:3000",
                bypass: function (req) {
                    var _a;
                    if (req.method === "GET" && ((_a = req.headers.accept) === null || _a === void 0 ? void 0 : _a.includes("text/html"))) {
                        return "/index.html";
                    }
                },
            },
        },
    },
});
