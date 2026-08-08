// Перевіряє, що без ефектів кадр проходить крізь пайплайн незмінним.
//
// Саме тут картинку легко зіпсувати непомітно: тонмап чи грейд тягнуть тони, і
// камера виглядає гірше, ніж у звичайному застосунку, хоча «нічого не ввімкнено».
//
// Запуск: npm run check:color
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = createRequire(import.meta.url)('electron')
const bundlePath = join(root, 'node_modules/.cache/memecam/color.js')

await build({
  entryPoints: [join(root, 'scripts/probe-color/entry.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'iife',
  globalName: 'MemeCamGL',
  logLevel: 'warning'
})

const env = { ...process.env, GL_BUNDLE: bundlePath }
delete env.ELECTRON_RUN_AS_NODE // див. коментар у run-electron.mjs

const code = await new Promise((res) => {
  const child = spawn(electronExe, [join(root, 'scripts/probe-color/main.cjs')], {
    stdio: 'inherit',
    env
  })
  child.on('error', (e) => {
    console.error('Не вдалось запустити electron:', e.message)
    res(1)
  })
  child.on('exit', (c) => res(c ?? 1))
})

if (code !== 0) process.exit(code)

// Друга проба: заміна фону. Найтихіша помилка тут — переворот маски.
const bgCode = await new Promise((res) => {
  const child = spawn(electronExe, [join(root, 'scripts/probe-color/bg-main.cjs')], {
    stdio: 'inherit',
    env
  })
  child.on('error', () => res(1))
  child.on('exit', (c) => res(c ?? 1))
})

if (bgCode !== 0) process.exit(bgCode)
