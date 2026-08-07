// Ганяє тракт мікрофона на фейковому пристрої Chromium: дозвіл, завантаження
// воркліта за відносним шляхом і чи доходить сигнал до виходу.
//
// Запуск: npm run check:mic
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = createRequire(import.meta.url)('electron')
const bundlePath = join(root, 'node_modules/.cache/memecam/mic.js')

await build({
  entryPoints: [join(root, 'scripts/probe-mic/entry.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'iife',
  globalName: 'MemeCamMic',
  logLevel: 'warning'
})

const env = { ...process.env, MIC_BUNDLE: bundlePath }
delete env.ELECTRON_RUN_AS_NODE // див. коментар у run-electron.mjs

const code = await new Promise((res) => {
  const child = spawn(electronExe, [join(root, 'scripts/probe-mic/main.cjs')], {
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
