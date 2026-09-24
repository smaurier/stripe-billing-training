// Même oracle, pointé sur solution/ : `npm run solution:02` doit être GREEN.
// Sert à prouver que l'oracle est juste, pas à apprendre. Ne l'ouvre pas avant ton GREEN.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@lab": fileURLToPath(new URL("./solution", import.meta.url)) } },
  test: {
    include: ["test/**/*.spec.ts", "test/**/*.test.ts"],
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"], tsconfig: "./tsconfig.solution.json" },
  },
});
