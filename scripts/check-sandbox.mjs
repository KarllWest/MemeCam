// Перевіряє, що міст у головний процес живий під пісочницею.
//
// Запуск: npm run check:sandbox
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = createRequire(import.meta.url)('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE // див. коментар у run-electron.mjs

const code = await new Promise((res) => {
  const child = spawn(electronExe, [join(root, 'scripts/probe-sandbox/main.cjs')], {
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
