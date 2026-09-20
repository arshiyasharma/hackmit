import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ref/ holds cloned reference repos we read but never ship; they carry
    // their own test files and their own toolchain, so keep them out of ours.
    exclude: ["node_modules/**", ".next/**", "ref/**"],
  },
});
