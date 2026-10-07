import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['src/services/api.test.ts','src/pages/ConnectedWorkspace.test.tsx']}});
