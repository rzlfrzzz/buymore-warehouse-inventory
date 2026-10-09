import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["inspection.integration.test.tsx"] },
});
