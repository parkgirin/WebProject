import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    watch: {
      ignored: ["**/.qa-chrome/**", "**/.qa-cdp/**"],
    },
  },
});
