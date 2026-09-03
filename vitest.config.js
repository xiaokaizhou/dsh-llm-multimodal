import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{js,ts}'],
    environment: 'node',
    // Each test file brings up its own DSH `defineTool` + `settingsNamespace`
    // registrations; isolate per-file state so they don't bleed.
    isolate: true,
  },
})
