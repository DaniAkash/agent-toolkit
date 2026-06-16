import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reader that resolves a bridge-asset filename to its contents. The default
 * (`defaultReadBridgeAsset`) reads from `dist/bridge/<name>` relative to the
 * compiled module. Tests inject a fake reader to assert the bootstrap recipe
 * shape without building first.
 */
export type ReadBridgeAsset = (name: string) => Promise<string>

const ASSET_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'bridge',
)

/**
 * Production reader. Resolves `./bridge/<name>` relative to the running
 * module. After `bun run build` the module lives in `dist/`, so this points
 * at `dist/bridge/<name>` where `copy-bridge-assets` lays down the manifest
 * and bunup writes the bundle.
 */
export const defaultReadBridgeAsset: ReadBridgeAsset = async (name) => {
  return readFile(path.join(ASSET_DIR, name), 'utf8')
}
