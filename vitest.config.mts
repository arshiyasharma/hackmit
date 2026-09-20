import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // the same "@/*" -> "./*" alias tsconfig.json gives the app, so a test can
    // import a module that reads a committed data file by its app-style path
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // ref/ holds cloned reference repos we read but never ship; they carry
    // their own test files and their own toolchain, so keep them out of ours.
    exclude: ["node_modules/**", ".next/**", "ref/**", ".claude/**"],
  },
});
