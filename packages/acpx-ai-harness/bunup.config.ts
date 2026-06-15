import { defineConfig } from 'bunup'

export default defineConfig({
  entry: ['src/index.ts'],
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
})
