import { defineConfig } from 'bunup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node',
  dts: true,
  clean: true,
  external: ['@agentclientprotocol/sdk', 'acpx', 'acpx/runtime'],
})
