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
    //
    // .claude/worktrees/ holds throwaway checkouts an agent works in, each with
    // its own copy of node_modules. Leaving them in turned one run of 125 tests
    // into 12,692 — every dependency's own suite, run from inside our project.
    exclude: [
      "node_modules/**",
      ".next/**",
      "ref/**",
      ".claude/**",
      "**/node_modules/**",
    ],
  },
});
