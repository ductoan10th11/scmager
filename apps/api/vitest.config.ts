/**
 * Kept dependency-free so the API test contract is visible before Vitest is
 * selected in an approved CI image. Local P3 tests use Node's built-in runner
 * through tsx and do not download a test framework at runtime.
 */
export default {
  test: {
    include: ["src/test/**/*.test.ts"],
    environment: "node",
    coverage: { provider: "v8" },
  },
};
