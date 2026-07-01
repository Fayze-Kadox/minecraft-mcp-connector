import { defineConfig } from "vitest/config";

/**
 * Le code source utilise des specifiers ESM en ".js" (obligatoire avec NodeNext).
 * Ce petit plugin réécrit, à la résolution, les imports relatifs ".js" → ".ts"
 * pour que Vitest charge bien les sources TypeScript.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  plugins: [
    {
      name: "resolve-js-to-ts",
      enforce: "pre",
      async resolveId(source, importer) {
        if (importer && source.startsWith(".") && source.endsWith(".js")) {
          const tsSource = source.slice(0, -3) + ".ts";
          const resolved = await this.resolve(tsSource, importer, { skipSelf: true });
          if (resolved) return resolved.id;
        }
        return null;
      },
    },
  ],
});
