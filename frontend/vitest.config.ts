import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/services/api.test.ts",
      "src/services/overview.test.ts",
      "src/pages/ConnectedWorkspace.test.tsx",
      "src/pages/InspectionWorkspace.test.tsx",
      "src/pages/InspectionWorkspace.dom.test.tsx",
      "src/pages/ProductThumbnail.test.tsx",
    ],
  },
});
