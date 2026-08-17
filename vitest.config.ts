import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The `@/` alias, so tests resolve it the way Next.js does.
 *
 * It only started mattering when a render module imported a *value* from the
 * game layer: type-only imports are erased before the resolver ever sees them,
 * so the alias had been quietly unused in tests until then.
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
