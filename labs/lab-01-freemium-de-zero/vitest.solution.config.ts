// Même oracle, pointé sur solution/ : `npm run solution:01` doit être GREEN.
// Sert à prouver que l'oracle est juste, pas à apprendre. Ne l'ouvre pas avant ton GREEN.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./solution", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@lab": ROOT } },
  test: {
    include: ["test/**/*.spec.ts", "test/**/*.test.ts"],
    env: { LAB_ROOT: ROOT },
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"], tsconfig: "./tsconfig.solution.json" },
  },
});
