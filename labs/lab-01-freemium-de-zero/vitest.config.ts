// Oracle du lab : `@lab/*` -> TON code (src/). `LAB_ROOT` pointe le même dossier pour la
// relecture statique (comparaison de signature en temps constant). `npm run lab:01` depuis
// 22-stripe-billing/labs.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@lab": ROOT } },
  test: {
    include: ["test/**/*.spec.ts", "test/**/*.test.ts"],
    env: { LAB_ROOT: ROOT },
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"], tsconfig: "./tsconfig.json" },
  },
});
