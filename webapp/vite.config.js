import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const single = process.env.DEV_SINGLE === '1';
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "../dist",
        emptyOutDir: false
    },
    server: {
        port: 5173,
        proxy: single
            ? undefined
            : {
                "/api": "http://localhost:5175",
                "/ws": {
                    target: "ws://localhost:5175",
                    ws: true
                }
            }
    }
});
