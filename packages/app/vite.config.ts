import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createApiHandler } from "../cli/src/middleware.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Serves the harness file API during `vite dev`, mirroring the production CLI server. */
function harnessApi(): Plugin {
  const dataDir = process.env.ALMOND_DATA_DIR ?? path.resolve(here, "../../examples");
  return {
    name: "almond-harness-api",
    configureServer(server) {
      server.middlewares.use(createApiHandler(dataDir));
    },
  };
}

export default defineConfig({
  plugins: [react(), harnessApi()],
  resolve: {
    alias: {
      "@almond-bot/harness-studio-core": path.resolve(here, "../core/src/index.ts"),
    },
  },
});
