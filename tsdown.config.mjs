/**
 * dsh-llm-multimodal build config.
 *
 * Two entries:
 *   1. HOST entry — lib/index.js (existing hand-written source is preserved;
 *      tsdown only re-emits the new src/client.tsx tree on top of it).
 *      For now we keep the host build unchanged and only emit the client.
 *   2. CLIENT entry — lib/client.js (CJS browser wrapper that registers
 *      the factory closure with window.__ModuleLoader__).
 *
 * Source code stays ESM throughout (import / export); tsdown converts
 * ESM imports into `require()` calls inside the CJS bundle so the
 * dsh-client-modules runtime can hand the factory a real `require` from
 * its frozen module table.
 *
 * See references/dsh-client-wrapper-recipe.md for the protocol details
 * (banner / intro / footer triple + format='cjs' + platform='browser').
 */

import { defineConfig } from 'tsdown'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const PLUGIN_ID = pkg.name

/** Platform modules the DSH host seeds into its frozen module table. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]

/**
 * Other runtime modules that dsh-client-runtime exposes — these MUST be
 * resolved by the loader's `require`, not bundled in (the host keeps
 * a single instance for cross-plugin observability).
 *
 * DSH 0.1.2 split `dsh-client-runtime` into:
 *   - `dsh-client-store`           (React-free observable + snapshot store)
 *   - `dsh-client-ui-slots`        (SlotRegistry)
 *   - `dsh-client-ui-primitives`   (object-layer primitives)
 *   - `dsh-client-ui-settings`     (SettingsScope — type-only import)
 * Only value imports need to be listed; `import type { ... }` is erased
 * at build time and does not require a runtime resolution.
 */
const HOST_RUNTIME_MODULES = [
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-settings',
]

const EXTERNALS = [...PLATFORM_MODULES, ...HOST_RUNTIME_MODULES]

export default [
  // ── 1. Client entry: browser factory wrapper ──────────────────────────
  {
    entry: { client: 'src/client.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: false,
    deps: {
      neverBundle: EXTERNALS,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    esbuild: { jsx: 'automatic' },
    outputOptions: {
      entryFileNames: 'client.js',
      banner:
        `window.__ModuleLoader__.load({ ` +
        `id: ${JSON.stringify(PLUGIN_ID)}, ` +
        `factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
]