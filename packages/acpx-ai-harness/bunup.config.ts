import { defineConfig } from 'bunup'

export default defineConfig([
  {
    name: 'host',
    entry: ['src/index.ts'],
    outDir: 'dist',
    format: ['esm'],
    target: 'node',
    dts: true,
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
