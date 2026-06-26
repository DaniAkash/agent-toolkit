import { defineConfig } from 'bunup'

export default defineConfig([
  {
    name: 'host',
    entry: ['src/index.ts'],
    outDir: 'dist',
    format: ['esm'],
    target: 'node',
    // inferTypes uses the traditional tsc declaration emit instead of
    // bunup's isolated-declarations path. Required here because we
    // re-export several zod schemas (built-in tool descriptors, bridge
    // protocol, lifecycle state) whose inferred types are too complex
    // for the isolated-declarations rule to express without per-export
    // explicit annotations. Documented bunup workaround for zod-heavy
    // libraries: https://bunup.dev/docs/guide/typescript-declarations
    dts: { inferTypes: true },
    clean: true,
    external: [
      'ai',
      'acpx',
      '@ai-sdk/harness',
      '@ai-sdk/provider',
      '@ai-sdk/provider-utils',
      '@modelcontextprotocol/sdk',
      'ws',
      'zod',
    ],
  },
  {
    name: 'bridge',
    entry: ['src/bridge/index.ts'],
    outDir: 'dist/bridge',
    format: ['esm'],
    target: 'node',
    dts: false,
    clean: false,
    external: ['acpx', '@modelcontextprotocol/sdk', 'ws', 'zod'],
  },
])
