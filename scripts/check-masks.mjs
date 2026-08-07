// Знімає посадку кожної маски на схематичному обличчі з відомими координатами.
// Дає побачити перевороти, промахи зсуву й неправильний масштаб без живої камери.
//
// Запуск: npm run check:masks [тека]
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = createRequire(import.meta.url)('electron')

const outDir = resolve(process.argv[2] ?? join(root, 'node_modules/.cache/memecam/masks'))
await mkdir(outDir, { recursive: true })

const bundlePath = join(root, 'node_modules/.cache/memecam/masks.js')

await build({
  entryPoints: [join(root, 'scripts/probe-masks/entry.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'iife',
  globalName: 'MemeCamGL',
  logLevel: 'warning'
})

const env = { ...process.env, MASK_BUNDLE: bundlePath, MASK_OUT: outDir }
delete env.ELECTRON_RUN_AS_NODE // див. коментар у run-electron.mjs

const code = await new Promise((res) => {
  const child = spawn(electronExe, [join(root, 'scripts/probe-masks/main.cjs')], {
    stdio: 'inherit',
    env
  })
  child.on('error', (e) => {
    console.error('Не вдалось запустити electron:', e.message)
    res(1)
  })
  child.on('exit', (c) => res(c ?? 1))
})

process.exit(code)
