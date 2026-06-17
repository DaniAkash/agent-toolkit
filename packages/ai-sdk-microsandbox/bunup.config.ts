import { defineConfig } from 'bunup'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node',
  dts: true,
  clean: true,
  external: ['@ai-sdk/harness', '@ai-sdk/provider-utils', 'microsandbox'],
})
