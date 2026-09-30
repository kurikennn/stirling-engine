import { defineConfig } from "vitest/config";

export default defineConfig({
  // Served from https://kurikennn.github.io/stirling-engine/
  base: "/stirling-engine/",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
